use cetrinw_cloud::WebDav;
use cetrinw_core::Store;
use serde_json::json;
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let a = tempfile::tempdir()?;
    let b = tempfile::tempdir()?;
    let mut source = Store::open(a.path())?;
    let mut restored = Store::open(b.path())?;
    let audio = std::fs::read("output/fixtures/original-dialogue.aiff")?;
    let asset = source.asset_put("original-dialogue.aiff", "audio/aiff", &audio)?;
    source.save(&json!({"kind":"note","title":"产业研究的 WebDAV 恢复夹具","data":{"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"核对订单来源与收入确认时间，保留证据与后续验证条件。"}]}]}}}))?;
    source.save(&json!({"kind":"lesson","title":"Original research conversation","data":{"audio":asset,"segments":[{"text":"Could you explain the supply chain?","translation":"你能解释一下供应链吗？","start":0,"end":5}]}}))?;
    source.save(&json!({"kind":"session","title":"跟读进度","data":{"seconds":240,"startedAt":"2026-10-10T03:00:00Z"}}))?;
    let bundle = source.export()?;
    let dav = WebDav::new("http://127.0.0.1:14324/", "fixture", "local-protocol-test")?;
    dav.test().await?;
    let upload = dav.backup(serde_json::to_vec(&bundle)?).await?;
    let files = dav.list().await?;
    assert!(files
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["name"] == upload["name"]));
    let received = dav.read(upload["name"].as_str().unwrap()).await?;
    assert_eq!(bundle, received);
    restored.import(&received)?;
    assert_eq!(
        source.list("", "", 100, 0)?.len(),
        restored.list("", "", 100, 0)?.len()
    );
    assert_eq!(
        audio,
        std::fs::read(restored.asset_path(asset["hash"].as_str().unwrap())?)?
    );
    let wrong = WebDav::new("http://127.0.0.1:14324/", "fixture", "wrong")?;
    assert!(wrong.test().await.is_err());
    println!(
        "{}",
        json!({"level":"L2","check":"real HTTP WebDAV PROPFIND/MKCOL/PUT/GET with file-backed fixture; restored notes, bilingual lesson, real audio and progress through Store","records":3,"audio_bytes":audio.len(),"result":"pass","limitation":"Not a Nutstore account / external L4 verification"})
    );
    Ok(())
}
