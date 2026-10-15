use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use cetrinw_core::{Record, Store};
use chrono::{Datelike, Timelike, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tower_http::{cors::CorsLayer, services::ServeDir};
mod sources;

#[derive(Clone)]
pub struct App {
    pub db: Arc<Mutex<Store>>,
    pub client: reqwest::Client,
    pub token: String,
    pub worker: PathBuf,
    pub jobs: Arc<tokio::sync::Semaphore>,
}
type ApiError = (StatusCode, Json<Value>);
fn error(e: impl ToString) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":e.to_string()})),
    )
}
fn authorized(headers: &HeaderMap, app: &App) -> bool {
    if app.token.is_empty() {
        return true;
    }
    let supplied = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let a = Sha256::digest(supplied.as_bytes());
    let b = Sha256::digest(app.token.as_bytes());
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}
pub fn db(app: &App, request: Value) -> anyhow::Result<Value> {
    app.db
        .lock()
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .command(request)
}
async fn command(
    State(app): State<App>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if !authorized(&headers, &app) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"需要有效的设备令牌"})),
        ));
    }
    match request["op"].as_str().unwrap_or("") {
        "rss_discover" => Ok(Json(
            cetrinw_learning::discover(request["url"].as_str().unwrap_or(""))
                .await
                .map_err(error)?,
        )),
        "rss_fetch" => Ok(Json(
            cetrinw_learning::rss(
                request["url"].as_str().unwrap_or(""),
                request["id"].as_str().unwrap_or(""),
            )
            .await
            .map_err(error)?,
        )),
        "learning_translate" => {
            // Pipeline: local cache → offline model (if a model dir is
            // configured) → MyMemory fallback; fresh results are cached.
            let text = request["text"].as_str().unwrap_or("").to_string();
            let cached =
                db(&app, json!({"op":"translate_cache_get","text":text})).map_err(error)?;
            if !cached.is_null() {
                return Ok(Json(json!({
                    "text": cached["text"],
                    "provider": format!("{} · 缓存", cached["provider"].as_str().unwrap_or("翻译")),
                })));
            }
            let model_dir = std::env::var("CETRINW_TRANSLATE_MODEL_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| {
                    cetrinw_translate::model_dir(&PathBuf::from(
                        std::env::var("CETRINW_DATA_DIR").unwrap_or(".data/server".into()),
                    ))
                });
            let offline = {
                let text = text.clone();
                tokio::task::spawn_blocking(move || {
                    if cetrinw_translate::engine_ready(&model_dir) {
                        cetrinw_translate::engine_translate(&model_dir, &text).ok()
                    } else {
                        None
                    }
                })
                .await
                .map_err(error)?
            };
            let result = match offline {
                Some(translated) => {
                    json!({"text": translated, "provider": "离线模型 · opus-mt-en-zh"})
                }
                None => cetrinw_learning::translate(&text).await.map_err(error)?,
            };
            let _ = db(
                &app,
                json!({"op":"translate_cache_put","text":text,"result":result["text"],"provider":result["provider"]}),
            );
            Ok(Json(result))
        }
        "article_extract" => Ok(Json(
            cetrinw_learning::extract_article(request["url"].as_str().unwrap_or(""))
                .await
                .map_err(error)?,
        )),
        "news_sources" => Ok(Json(cetrinw_learning::news_sources())),
        "news_refresh" => {
            let articles = cetrinw_learning::news(request["id"].as_str().unwrap_or(""))
                .await
                .map_err(error)?;
            let result = tokio::task::spawn_blocking(move || {
                db(&app, json!({"op":"news_import","articles":articles}))
            })
            .await
            .map_err(error)?
            .map_err(error)?;
            Ok(Json(result))
        }
        "learning_catalog" => Ok(Json(cetrinw_learning::catalog())),
        "learning_download" => {
            let id = request["id"].as_str().ok_or_else(|| error("缺少课程 ID"))?;
            let (mut record, bytes) = cetrinw_learning::download(id).await.map_err(error)?;
            let result = tokio::task::spawn_blocking(move || -> anyhow::Result<Value> {
                let mut store = app.db.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
                let existing = store.command(json!({"op":"get","id":record["id"]}))?;
                if !existing.is_null() && existing["deleted"] != true {
                    return Ok(existing);
                }
                let name = format!("{}.mp3", record["id"].as_str().unwrap());
                record["data"]["audio"] = store.asset_put(&name, "audio/mpeg", &bytes)?;
                if !existing.is_null() {
                    record["revision"] = existing["revision"].clone();
                }
                store.command(json!({"op":"save","record":record}))
            })
            .await
            .map_err(error)?
            .map_err(error)?;
            Ok(Json(result))
        }
        "refresh" => {
            let id = request["id"]
                .as_str()
                .ok_or_else(|| error("缺少数据源 ID"))?
                .to_string();
            let source = db(&app, json!({"op":"get","id":id})).map_err(error)?;
            if source["kind"] != "source" {
                return Err(error("数据源不存在"));
            }
            let job=db(&app,json!({"op":"save","record":{"kind":"job","title":source["title"],"data":{"sourceId":id,"status":"queued","startedAt":Utc::now().to_rfc3339()}}})).map_err(error)?;
            let source: Record = serde_json::from_value(source).map_err(error)?;
            let job: Record = serde_json::from_value(job.clone()).map_err(error)?;
            let response = json!({"jobId":job.id});
            tokio::spawn(run_job(app, source, job));
            Ok(Json(response))
        }
        "dictionary" => {
            let word = request["word"].as_str().unwrap_or("");
            if word.is_empty()
                || word.len() > 80
                || !word
                    .chars()
                    .all(|c| c.is_ascii_alphabetic() || c == '-' || c == '\'')
            {
                return Err(error("请输入英文单词"));
            }
            let local = db(&app, json!({"op":"dictionary","word":word})).map_err(error)?;
            if !local.is_null() {
                return Ok(Json(local));
            }
            let res = app
                .client
                .get(format!(
                    "https://api.dictionaryapi.dev/api/v2/entries/en/{word}"
                ))
                .send()
                .await
                .map_err(error)?;
            if !res.status().is_success() {
                return Err(error("词典未找到该词或暂时不可用，可手动添加释义"));
            }
            Ok(Json(res.json::<Value>().await.map_err(error)?))
        }
        "download" => {
            let url = request["url"]
                .as_str()
                .ok_or_else(|| error("缺少下载链接"))?;
            let res = sources::get(&app, url).await.map_err(error)?;
            let mime = res
                .headers()
                .get("content-type")
                .and_then(|h| h.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            let bytes = sources::read_limited(res, 80 * 1024 * 1024)
                .await
                .map_err(error)?;
            let name = request["name"].as_str().unwrap_or("download").to_string();
            let app2 = app.clone();
            let a = tokio::task::spawn_blocking(move || {
                app2.db
                    .lock()
                    .map_err(|e| anyhow::anyhow!(e.to_string()))?
                    .asset_put(&name, &mime, &bytes)
            })
            .await
            .map_err(error)?
            .map_err(error)?;
            Ok(Json(a))
        }
        _ => {
            let result = tokio::task::spawn_blocking(move || db(&app, request))
                .await
                .map_err(error)?
                .map_err(error)?;
            Ok(Json(result))
        }
    }
}
async fn asset(
    State(app): State<App>,
    headers: HeaderMap,
    axum::extract::Path(hash): axum::extract::Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    if !authorized(&headers, &app) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"需要设备令牌"})),
        ));
    }
    let (path, mime) = {
        let store = app.db.lock().map_err(error)?;
        let path = store.asset_path(&hash).map_err(error)?;
        let mime = store
            .asset_manifest()
            .map_err(error)?
            .iter()
            .find(|a| a["hash"] == hash)
            .and_then(|a| a["mime"].as_str())
            .unwrap_or("application/octet-stream")
            .to_string();
        (path, mime)
    };
    let data = tokio::fs::read(path).await.map_err(error)?;
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, mime),
            (
                axum::http::header::CONTENT_DISPOSITION,
                "attachment".to_string(),
            ),
            (
                axum::http::header::X_CONTENT_TYPE_OPTIONS,
                "nosniff".to_string(),
            ),
        ],
        data,
    ))
}
async fn run_job(app: App, mut source: Record, mut job: Record) {
    let _permit = app.jobs.acquire().await;
    job.data["status"] = json!("running");
    if let Ok(v) = db(&app, json!({"op":"save","record":job})) {
        if let Ok(r) = serde_json::from_value(v) {
            job = r;
        }
    }
    let result = sources::collect(&app, &source).await;
    // Reload config so a long-running fetch cannot overwrite edits made in the settings UI.
    if let Ok(v) = db(&app, json!({"op":"get","id":source.id})) {
        if let Ok(r) = serde_json::from_value(v) {
            source = r;
        }
    }
    source.data["lastAttempt"] = json!(Utc::now().to_rfc3339());
    match result {
        Ok(count) => {
            job.data["status"] = json!("success");
            job.data["count"] = json!(count);
            source.data["lastSuccess"] = json!(Utc::now().to_rfc3339());
            source.data["status"] = json!("success");
            source.data["error"] = Value::Null;
        }
        Err(e) => {
            job.data["status"] = json!("failed");
            job.data["error"] = json!(e.to_string());
            source.data["status"] = json!("failed");
            source.data["error"] = json!(e.to_string());
        }
    }
    job.data["finishedAt"] = json!(Utc::now().to_rfc3339());
    if let Err(e) = db(&app, json!({"op":"save","record":job})) {
        eprintln!("任务状态保存失败: {e}");
    }
    if let Err(e) = db(&app, json!({"op":"save","record":source})) {
        eprintln!("数据源状态保存失败: {e}");
    }
}
async fn scheduler(app: App) {
    let mut timer = tokio::time::interval(Duration::from_secs(60));
    loop {
        timer.tick().await;
        let all = db(&app, json!({"op":"list","kind":"source","limit":1000}));
        if let Ok(Value::Array(rows)) = all {
            for row in rows {
                let source: Record = match serde_json::from_value(row) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if source.data["enabled"] != true {
                    continue;
                }
                let market = source.data["config"]["market"].as_str().unwrap_or("");
                let zone = if market == "US" {
                    chrono_tz::America::New_York
                } else {
                    chrono_tz::Asia::Shanghai
                };
                let now = Utc::now().with_timezone(&zone);
                let hour = if source.data["adapter"] == "akshare" {
                    18
                } else {
                    8
                };
                let last = source.data["lastAttempt"]
                    .as_str()
                    .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                    .map(|t| t.with_timezone(&zone).date_naive());
                if now.hour() < hour
                    || last == Some(now.date_naive())
                    || (!market.is_empty() && now.weekday().number_from_monday() > 5)
                {
                    continue;
                }
                let job = db(
                    &app,
                    json!({"op":"save","record":{"kind":"job","title":source.title,"data":{"sourceId":source.id,"status":"queued","startedAt":Utc::now().to_rfc3339()}}}),
                );
                if let Ok(v) = job {
                    if let Ok(j) = serde_json::from_value(v) {
                        run_job(app.clone(), source, j).await;
                    }
                }
            }
        }
        let copy = app.clone();
        let _ =
            tokio::task::spawn_blocking(move || copy.db.lock().ok().and_then(|s| s.backup().ok()))
                .await;
    }
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let root = PathBuf::from(std::env::var("CETRINW_DATA_DIR").unwrap_or(".data/server".into()));
    let bind = std::env::var("CETRINW_BIND").unwrap_or("127.0.0.1:4318".into());
    let token = std::env::var("CETRINW_TOKEN").unwrap_or_default();
    if !bind.starts_with("127.0.0.1:") && !bind.starts_with("[::1]:") && token.len() < 32 {
        anyhow::bail!("对外监听必须配置至少 32 字符的 CETRINW_TOKEN，并在反向代理启用 HTTPS");
    }
    let app = App {
        db: Arc::new(Mutex::new(Store::open(root)?)),
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(35))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Cetrinw/0.1 personal research")
            .build()?,
        token,
        worker: PathBuf::from(
            std::env::var("CETRINW_WORKER").unwrap_or("workers/market.py".into()),
        ),
        jobs: Arc::new(tokio::sync::Semaphore::new(1)),
    };
    tokio::spawn(scheduler(app.clone()));
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:1420".parse().unwrap(),
            "http://127.0.0.1:1420".parse().unwrap(),
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
        ])
        .allow_methods([axum::http::Method::POST, axum::http::Method::GET]);
    let router = Router::new()
        .route(
            "/health",
            get(|| async { Json(json!({"status":"ok","version":"0.1.0"})) }),
        )
        .route("/v1/command", post(command))
        .route("/v1/assets/{hash}", get(asset))
        .fallback_service(
            ServeDir::new(std::env::var("CETRINW_DIST").unwrap_or("dist".into()))
                .append_index_html_on_directories(true),
        )
        .layer(DefaultBodyLimit::max(350 * 1024 * 1024))
        .layer(cors)
        .with_state(app);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    eprintln!("Cetrinw server listening at http://{bind}");
    axum::serve(listener, router).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn app(token: &str) -> (App, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let app = App {
            db: Arc::new(Mutex::new(Store::open(dir.path()).unwrap())),
            client: reqwest::Client::new(),
            token: token.into(),
            worker: PathBuf::from("workers/market.py"),
            jobs: Arc::new(tokio::sync::Semaphore::new(1)),
        };
        (app, dir)
    }

    #[test]
    fn token_authorization_matrix() {
        let (server, _dir) = app("secret-token-value-1234567890");
        let mut headers = HeaderMap::new();
        assert!(
            !authorized(&headers, &server),
            "missing token must be rejected"
        );
        headers.insert("authorization", HeaderValue::from_static("Bearer wrong"));
        assert!(!authorized(&headers, &server));
        headers.insert("authorization", HeaderValue::from_static("Bearer"));
        assert!(!authorized(&headers, &server));
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer secret-token-value-1234567890"),
        );
        assert!(authorized(&headers, &server));
        let (open, _dir2) = app("");
        assert!(
            authorized(&HeaderMap::new(), &open),
            "loopback-only servers without a token stay open"
        );
    }

    #[tokio::test]
    async fn sources_reject_non_https_and_private_hosts() {
        let (app, _dir) = app("");
        assert!(sources::get(&app, "http://example.com/feed").await.is_err());
        assert!(
            sources::get(&app, "https://user:pass@example.com/feed")
                .await
                .is_err()
        );
        assert!(sources::get(&app, "https://127.0.0.1/feed").await.is_err());
        assert!(sources::get(&app, "https://[::1]/feed").await.is_err());
    }
}
