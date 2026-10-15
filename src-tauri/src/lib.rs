use cetrinw_core::Store;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

type Database = Arc<Mutex<Store>>;
struct QuitReady(AtomicBool);
#[tauri::command]
fn finish_quit(app: tauri::AppHandle) {
    app.state::<QuitReady>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}
#[tauri::command]
async fn learning_command(
    app: tauri::AppHandle,
    request: Value,
    store: State<'_, Database>,
) -> Result<Value, String> {
    if request["op"] == "rss_discover" {
        return cetrinw_learning::discover(request["url"].as_str().unwrap_or(""))
            .await
            .map_err(|e| e.to_string());
    }
    if request["op"] == "rss_fetch" {
        return cetrinw_learning::rss(
            request["url"].as_str().unwrap_or(""),
            request["id"].as_str().unwrap_or(""),
        )
        .await
        .map_err(|e| e.to_string());
    }
    if request["op"] == "learning_translate" {
        // Pipeline: local cache → offline model (when wired and downloaded) →
        // MyMemory fallback; every fresh result is cached for offline reuse.
        let text = request["text"].as_str().unwrap_or("").to_string();
        let cached = store
            .lock()
            .map_err(|e| e.to_string())?
            .command(serde_json::json!({"op":"translate_cache_get","text":text}))
            .map_err(|e| e.to_string())?;
        if !cached.is_null() {
            return Ok(serde_json::json!({
                "text": cached["text"],
                "provider": format!("{} · 缓存", cached["provider"].as_str().unwrap_or("翻译")),
            }));
        }
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let offline = {
            let text = text.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if cetrinw_translate::engine_ready(&base) {
                    cetrinw_translate::engine_translate(&base, &text).ok()
                } else {
                    None
                }
            })
            .await
            .map_err(|e| e.to_string())?
        };
        let result = match offline {
            Some(translated) => {
                serde_json::json!({"text": translated, "provider": "离线模型 · opus-mt-en-zh"})
            }
            None => cetrinw_learning::translate(&text)
                .await
                .map_err(|e| e.to_string())?,
        };
        let _ = store
            .lock()
            .map_err(|e| e.to_string())?
            .command(serde_json::json!({
                "op": "translate_cache_put",
                "text": text,
                "result": result["text"],
                "provider": result["provider"],
            }));
        return Ok(result);
    }
    if request["op"] == "article_extract" {
        return cetrinw_learning::extract_article(request["url"].as_str().unwrap_or(""))
            .await
            .map_err(|e| e.to_string());
    }
    if request["op"] == "news_sources" {
        return Ok(cetrinw_learning::news_sources());
    }
    if request["op"] == "news_refresh" {
        let articles = cetrinw_learning::news(request["id"].as_str().unwrap_or(""))
            .await
            .map_err(|e| e.to_string())?;
        let store = store.inner().clone();
        return tauri::async_runtime::spawn_blocking(move || {
            store
                .lock()
                .map_err(|e| e.to_string())?
                .command(serde_json::json!({"op":"news_import","articles":articles}))
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    if request["op"] == "learning_catalog" {
        return Ok(cetrinw_learning::catalog());
    }
    if request["op"] != "learning_download" {
        return Err("未知课程操作".into());
    }
    let id = request["id"].as_str().ok_or("缺少课程 ID")?;
    let (mut record, bytes) = cetrinw_learning::download(id)
        .await
        .map_err(|e| e.to_string())?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = store.lock().map_err(|e| e.to_string())?;
        let existing = store
            .command(serde_json::json!({"op":"get","id":record["id"]}))
            .map_err(|e| e.to_string())?;
        if !existing.is_null() && existing["deleted"] != true {
            return Ok(existing);
        }
        let name = format!("{}.mp3", record["id"].as_str().unwrap());
        record["data"]["audio"] = store
            .asset_put(&name, "audio/mpeg", &bytes)
            .map_err(|e| e.to_string())?;
        if !existing.is_null() {
            record["revision"] = existing["revision"].clone();
        }
        store
            .command(serde_json::json!({"op":"save","record":record}))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn db_command(request: Value, store: State<'_, Database>) -> Result<Value, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .lock()
            .map_err(|e| e.to_string())?
            .command(request)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remote_command(url: String, token: String, request: Value) -> Result<Value, String> {
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        && !(url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1")))
    {
        return Err("同步地址需使用 HTTPS，本机调试可使用 HTTP".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let endpoint = format!("{}/v1/command", url.as_str().trim_end_matches('/'));
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(body["error"].as_str().unwrap_or("服务器请求失败").into());
    }
    Ok(body)
}

#[tauri::command]
async fn dictionary_lookup(word: String, store: State<'_, Database>) -> Result<Value, String> {
    if word.len() > 80
        || !word
            .chars()
            .all(|c| c.is_ascii_alphabetic() || c == '-' || c == '\'')
    {
        return Err("请输入英文单词".into());
    }
    let local = store
        .lock()
        .map_err(|e| e.to_string())?
        .command(serde_json::json!({"op":"dictionary","word":word}))
        .map_err(|e| e.to_string())?;
    if !local.is_null() {
        return Ok(local);
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let r = client
        .get(format!(
            "https://api.dictionaryapi.dev/api/v2/entries/en/{word}"
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err("词典暂时无法返回该词，可手动填写释义".into());
    }
    r.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn translate_model_status(app: tauri::AppHandle) -> Result<Value, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(cetrinw_translate::model_status(&base))
}

#[tauri::command]
async fn translate_model_download(app: tauri::AppHandle) -> Result<Value, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    cetrinw_translate::download_model(&base)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(account: Option<String>) -> Result<String, String> {
    let account = account.unwrap_or_else(|| "sync-token".into());
    if !["sync-token", "webdav-password"].contains(&account.as_str()) {
        return Err("未知凭据类型".into());
    }
    #[cfg(target_os = "macos")]
    {
        match security_framework::passwords::get_generic_password("org.cetrinw.notes", &account) {
            Ok(bytes) => String::from_utf8(bytes).map_err(|e| e.to_string()),
            Err(e) if e.code() == -25300 => Ok(String::new()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(String::new())
    }
}
#[tauri::command]
fn secret_set(token: String, account: Option<String>) -> Result<(), String> {
    let account = account.unwrap_or_else(|| "sync-token".into());
    if !["sync-token", "webdav-password"].contains(&account.as_str()) {
        return Err("未知凭据类型".into());
    }
    #[cfg(target_os = "macos")]
    {
        security_framework::passwords::set_generic_password(
            "org.cetrinw.notes",
            &account,
            token.as_bytes(),
        )
        .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = token;
        Err("此平台尚未实现凭据仓".into())
    }
}

/// The save dialog runs in Rust so the webview can never choose an arbitrary
/// filesystem path; it only supplies a suggested file name and the bytes.
#[tauri::command]
async fn write_export(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    let chosen = app
        .dialog()
        .file()
        .set_file_name(&name)
        .blocking_save_file();
    let Some(path) = chosen else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || std::fs::write(&path, bytes).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())??;
    Ok(true)
}

#[tauri::command]
async fn webdav_command(
    action: String,
    name: Option<String>,
    store: State<'_, Database>,
) -> Result<Value, String> {
    let config = store
        .lock()
        .map_err(|e| e.to_string())?
        .command(serde_json::json!({"op":"setting_get","key":"webdav_config"}))
        .map_err(|e| e.to_string())?;
    let password = secret_get(Some("webdav-password".into()))?;
    let dav = cetrinw_cloud::WebDav::new(
        config["url"].as_str().unwrap_or(""),
        config["username"].as_str().unwrap_or(""),
        &password,
    )
    .map_err(|e| e.to_string())?;
    match action.as_str() {
        "test" => dav.test().await.map_err(|e| e.to_string()),
        "list" => dav.list().await.map_err(|e| e.to_string()),
        "backup" => {
            let db = store.inner().clone();
            let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
                let bundle = db
                    .lock()
                    .map_err(|e| e.to_string())?
                    .export()
                    .map_err(|e| e.to_string())?;
                serde_json::to_vec(&bundle).map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())??;
            let result = dav.backup(bytes).await.map_err(|e| e.to_string())?;
            store.lock().map_err(|e|e.to_string())?.command(serde_json::json!({"op":"setting_set","key":"webdav_last_backup","value":result})).map_err(|e|e.to_string())?;
            Ok(result)
        }
        "preview" => {
            let bundle = dav
                .read(name.as_deref().ok_or("缺少备份文件名")?)
                .await
                .map_err(|e| e.to_string())?;
            Ok(
                serde_json::json!({"createdAt":bundle["created_at"],"records":bundle["records"].as_array().map_or(0,|r|r.len()),"assets":bundle["assets"].as_array().map_or(0,|a|a.len()),"titles":bundle["records"].as_array().ok_or("备份缺少记录")?.iter().take(8).map(|r|&r["title"]).collect::<Vec<_>>()}),
            )
        }
        "restore" => {
            let bundle = dav
                .read(name.as_deref().ok_or("缺少备份文件名")?)
                .await
                .map_err(|e| e.to_string())?;
            let db = store.inner().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let mut db = db.lock().map_err(|e| e.to_string())?;
                db.backup().map_err(|e| e.to_string())?;
                db.import(&bundle).map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        }
        _ => Err("未知 WebDAV 操作".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(QuitReady(AtomicBool::new(false)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            std::fs::create_dir_all(&root)?;
            let dictionary = app.path().resource_dir()?.join("dictionary.sqlite3");
            if dictionary.exists() && !root.join("dictionary.sqlite3").exists() {
                std::fs::copy(dictionary, root.join("dictionary.sqlite3"))?;
            }
            let store = Arc::new(Mutex::new(Store::open(root)?));
            app.manage(store.clone());
            std::thread::spawn(move || loop {
                if let Ok(mut s) = store.lock() {
                    match s.backup() {
                        Ok(_) => {
                            let current = s
                                .command(serde_json::json!({"op":"setting_get","key":"backup_error"}))
                                .unwrap_or(Value::Null);
                            if !current.is_null() {
                                let _ = s.command(serde_json::json!({"op":"setting_set","key":"backup_error","value":null}));
                            }
                        }
                        Err(e) => {
                            eprintln!("自动备份失败：{e}");
                            let _ = s.command(serde_json::json!({"op":"setting_set","key":"backup_error","value":e.to_string()}));
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(3600));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_command,
            remote_command,
            dictionary_lookup,
            secret_get,
            secret_set,
            write_export,
            learning_command,
            webdav_command,
            translate_model_status,
            translate_model_download,
            finish_quit
        ])
        .build(tauri::generate_context!())
        .expect("Cetrinw could not start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<QuitReady>().0.load(Ordering::SeqCst) {
                    if let Some(window) = app.get_webview_window("main") {
                        api.prevent_exit();
                        let _ = window.emit("cetrinw-before-quit", ());
                    }
                }
            }
        });
}
