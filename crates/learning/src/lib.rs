//! Public VOA course metadata and on-demand downloads. No audio is bundled.
use anyhow::{bail, Context, Result};
use regex::Regex;
use scraper::{Html, Selector};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

pub fn catalog() -> Value {
    serde_json::from_str(include_str!("../../../resources/english-catalog.json"))
        .expect("bundled catalog")
}

pub async fn fetch_public(address: &str, limit: usize) -> Result<Vec<u8>> {
    use std::net::IpAddr;
    let url = reqwest::Url::parse(address)?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        bail!("RSS 地址需使用公开 HTTPS，不要在地址中填写账号密码");
    }
    let host = url.host_str().context("缺少网站地址")?;
    let addresses = tokio::net::lookup_host((host, url.port_or_known_default().unwrap_or(443)))
        .await?
        .collect::<Vec<_>>();
    if addresses.is_empty()
        || addresses.iter().any(|a| match a.ip() {
            IpAddr::V4(v) => {
                v.is_private()
                    || v.is_loopback()
                    || v.is_link_local()
                    || v.is_unspecified()
                    || v.is_broadcast()
                    || v.is_multicast()
                    || v.octets()[0] == 0
            }
            IpAddr::V6(v) => {
                v.is_loopback()
                    || v.is_unspecified()
                    || v.is_unique_local()
                    || v.is_unicast_link_local()
                    || v.to_ipv4_mapped().is_some()
            }
        })
    {
        bail!("RSS 不能访问本机或私有网络");
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addresses)
        .user_agent("Cetrinw/0.1 personal RSS reader")
        .build()?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("订阅连接失败：{}", e.without_url()))?;
    if !response.status().is_success() {
        bail!(
            "订阅来源返回 HTTP {}；若是跳转，请填写最终 HTTPS 地址",
            response.status()
        );
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > limit {
            bail!("订阅内容超过大小上限");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub async fn discover(address: &str) -> Result<Value> {
    let bytes = fetch_public(address, 4 * 1024 * 1024).await?;
    if let Ok(feed) = feed_rs::parser::parse(bytes.as_slice()) {
        return Ok(
            json!([{"url":address,"title":feed.title.map(|t|t.content).unwrap_or_else(||address.into())}]),
        );
    }
    let html = Html::parse_document(std::str::from_utf8(&bytes)?);
    let selector = Selector::parse("link[rel~='alternate'][href]").unwrap();
    let base = reqwest::Url::parse(address)?;
    let mut found = Vec::new();
    for el in html.select(&selector) {
        if !matches!(
            el.value().attr("type"),
            Some("application/rss+xml" | "application/atom+xml" | "application/feed+json")
        ) {
            continue;
        }
        if let Ok(url) = base.join(el.value().attr("href").unwrap()) {
            if url.scheme() == "https" {
                found.push(json!({"url":url.as_str(),"title":el.value().attr("title").unwrap_or("RSS / Atom")}));
            }
        }
    }
    if found.is_empty() {
        bail!("这个网页没有声明 RSS / Atom。可尝试网站首页、直接填写订阅地址，或从推荐源库选择");
    }
    Ok(json!(found))
}

pub async fn rss(address: &str, id: &str) -> Result<Value> {
    let bytes = fetch_public(address, 8 * 1024 * 1024).await?;
    let feed =
        feed_rs::parser::parse(bytes.as_slice()).context("来源不是有效 RSS / Atom / JSON Feed")?;
    let title = feed
        .title
        .as_ref()
        .map(|t| plain(&t.content))
        .unwrap_or_else(|| address.into());
    let mut articles = Vec::new();
    for entry in feed.entries.iter().take(100) {
        let Some(link) = entry
            .links
            .iter()
            .find(|l| l.rel.as_deref().is_none_or(|r| r == "alternate"))
        else {
            continue;
        };
        let Ok(url) = reqwest::Url::parse(&link.href) else {
            continue;
        };
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let full = entry.content.as_ref().and_then(|c| c.body.as_deref());
        let html = full
            .or(entry.summary.as_ref().map(|s| s.content.as_str()))
            .unwrap_or("");
        let doc = Html::parse_fragment(html);
        let paragraphs = doc
            .select(&Selector::parse("p, h2, h3, li").unwrap())
            .map(|p| plain(&p.inner_html()))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        let text = if paragraphs.is_empty() {
            plain(html)
        } else {
            paragraphs.join("\n\n")
        };
        let hash = format!(
            "{:x}",
            Sha256::digest(format!("{id}:{}", link.href).as_bytes())
        );
        articles.push(json!({"id":format!("rss-{hash}"),"kind":"article","title":entry.title.as_ref().map(|t|plain(&t.content)).unwrap_or_default(),"data":{
            "sourceId":id,"rss":true,"provider":title,"sourceUrl":link.href,"text":text,"read":false,"contentType":if full.is_some(){"feed-full-text"}else{"summary"},
            "publishedAt":entry.published.or(entry.updated).map(|d|d.to_rfc3339()),"fetchedAt":chrono::Utc::now().to_rfc3339(),"tags":entry.categories.iter().map(|c|&c.term).collect::<Vec<_>>()
        }}));
    }
    Ok(json!({"title":title,"url":address,"articles":articles}))
}

fn allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(
            url.host_str(),
            Some(
                "learningenglish.voanews.com"
                    | "voa-audio.voanews.eu"
                    | "voa-audio.voanews.com"
                    | "elllo.org"
                    | "www.nasa.gov"
                    | "www.theguardian.com"
                    | "feeds.bbci.co.uk"
                    | "api.mymemory.translated.net"
            )
        )
}

/// Formats a non-success HTTP status. `source` names the service that actually
/// answered, so a rate-limited translation API is never reported to the user as
/// a course or feed problem.
fn status_message(source: &str, status: reqwest::StatusCode, retry_after: Option<&str>) -> String {
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let wait = retry_after
            .map(|seconds| format!("，服务建议等待 {seconds} 秒"))
            .unwrap_or_default();
        return format!("{source}返回 HTTP 429（请求过于频繁{wait}），请稍后重试");
    }
    format!("{source}返回 HTTP {status}，请稍后重试")
}

async fn fetch(url: &str, limit: usize, source: &str) -> Result<Vec<u8>> {
    let url = reqwest::Url::parse(url)?;
    if !allowed(&url) {
        bail!("资料链接不属于已支持的官方来源");
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("Cetrinw/0.1 personal English learning")
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("无法连接{source}：{}", e.without_url()))?;
    if !response.status().is_success() {
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        bail!(
            "{}",
            status_message(source, response.status(), retry_after.as_deref())
        );
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        bail!("课程文件超过下载上限");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > limit {
            bail!("课程文件超过下载上限");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn parse_conversation(page: &str) -> Result<(String, Vec<String>)> {
    let heading = Regex::new(r"(?is)<h2[^>]*>\s*Conversation\s*</h2>(.*?)(?:<h2|$)")?;
    let section = heading
        .captures(page)
        .context("官方页面没有找到 Conversation，未导入不完整课文")?;
    let document = Html::parse_fragment(&section[1]);
    let audio = Selector::parse("audio source[src], audio[src]").unwrap();
    let url = document
        .select(&audio)
        .filter_map(|node| node.value().attr("src"))
        .find(|src| src.contains(".mp3"))
        .context("官方对话没有提供 MP3 下载")?
        .to_string();
    if !allowed(&reqwest::Url::parse(&url)?) {
        bail!("官方音频域名已变更，请更新资料连接器");
    }
    let blocks = Selector::parse("div, p").unwrap();
    let speaker = Regex::new(r"^[A-Z][A-Za-z .’'\-]{0,30}:")?;
    let mut lines = Vec::new();
    for element in document.select(&blocks) {
        if element.select(&blocks).next().is_some() {
            continue;
        }
        let line = element
            .text()
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if speaker.is_match(&line) {
            lines.push(line);
        }
    }
    if lines.len() < 2 {
        bail!("课文结构已变化，没有识别出完整对话；请打开原文");
    }
    Ok((url, lines))
}

pub async fn download(id: &str) -> Result<(Value, Vec<u8>)> {
    let catalog = catalog();
    let item = catalog["courses"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == id)
        .context("课程不在资料目录中")?;
    let page = fetch(item["sourceUrl"].as_str().unwrap(), 4 * 1024 * 1024, "课程来源").await?;
    let (audio_url, lines) = if item["collection"] == "elllo" {
        parse_elllo(
            std::str::from_utf8(&page)?,
            item["sourceUrl"].as_str().unwrap(),
        )?
    } else {
        parse_conversation(std::str::from_utf8(&page)?)?
    };
    let bytes = fetch(&audio_url, 40 * 1024 * 1024, "课程音频").await?;
    if !(bytes.starts_with(b"ID3")
        || (bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0))
    {
        bail!("下载内容不是有效 MP3，未保存为课程");
    }
    let segments = lines.iter().enumerate().map(|(i,line)| json!({"id":format!("{id}-line-{i}"),"start":i*5,"end":(i+1)*5,"text":line})).collect::<Vec<_>>();
    let record = json!({"id":id,"kind":"lesson","title":item["title"],"data":{
        "segments":segments,"sourceUrl":item["sourceUrl"],"audioSourceUrl":audio_url,
        "license":item["license"],"licenseUrl":item["licenseUrl"],
        "provider":item["provider"],"format":"txt","needsCalibration":true,"completed":false
    }});
    Ok((record, bytes))
}

fn plain(html: &str) -> String {
    Html::parse_fragment(html)
        .root_element()
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
/// Plain-text conversion for other crates that store feed titles or summaries.
pub fn plain_text(html: &str) -> String {
    plain(html)
}
pub fn parse_elllo(page: &str, base: &str) -> Result<(String, Vec<String>)> {
    let document = Html::parse_document(page);
    let source = Selector::parse(".matpack > .audio source[src], audio source[src]").unwrap();
    let src = document
        .select(&source)
        .next()
        .and_then(|e| e.value().attr("src"))
        .context("ELLLO 未提供可下载音频")?;
    let url = reqwest::Url::parse(base)?.join(src)?.to_string();
    let blocks = Selector::parse("#view1 .transcript p").unwrap();
    let line_break = Regex::new(r"(?i)<br\s*/?>")?;
    let speaker = Regex::new(r"^[A-Z][A-Za-z .’'\-]{0,30}\s*:")?;
    let mut lines = Vec::new();
    for block in document.select(&blocks) {
        for line in line_break.split(&block.inner_html()) {
            let text = plain(line);
            if speaker.is_match(&text) {
                lines.push(text);
            }
        }
    }
    if lines.len() < 2 {
        bail!("ELLLO 课文结构发生变化，未导入不完整材料");
    }
    Ok((url, lines))
}

/// The MyMemory free tier is quota-limited per IP, so a long article's
/// paragraph-by-paragraph requests exhaust it within seconds. Spacing the calls
/// keeps a translation run going instead of failing at the first 429. Sentences
/// already in the cache never reach here, so re-runs stay fast.
const TRANSLATE_MIN_INTERVAL: Duration = Duration::from_millis(1100);
static TRANSLATE_GATE: tokio::sync::Mutex<Option<std::time::Instant>> =
    tokio::sync::Mutex::const_new(None);

async fn wait_for_translate_slot() {
    let mut last = TRANSLATE_GATE.lock().await;
    if let Some(previous) = *last {
        let elapsed = previous.elapsed();
        if elapsed < TRANSLATE_MIN_INTERVAL {
            tokio::time::sleep(TRANSLATE_MIN_INTERVAL - elapsed).await;
        }
    }
    *last = Some(std::time::Instant::now());
}

/// What a MyMemory reply means for the caller.
enum Verdict {
    /// Usable Chinese.
    Keep(String),
    /// Nothing to translate: the service echoed the source back unchanged.
    Untranslated(String),
    /// A real failure, carrying the message to show.
    Failed(String),
}

/// Decides what to do with a MyMemory reply. Split out from `translate` so the
/// rules can be tested without the network.
fn interpret(source: &str, translated: &str) -> Verdict {
    let cleaned = plain(translated);
    // Numbers, tickers and figure captions come back verbatim. That is correct
    // behaviour, and treating it as a failure aborts the whole article.
    if cleaned.trim() == source.trim() {
        return Verdict::Untranslated(source.to_string());
    }
    // An exhausted quota arrives as an English warning inside the translated
    // text rather than as an error status.
    if cleaned.contains("MYMEMORY WARNING") {
        return Verdict::Failed("免费翻译额度已用完，请稍后重试或配置离线模型".into());
    }
    if !cleaned.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c)) {
        return Verdict::Failed("服务未返回有效中文，可手工填写或稍后重试".into());
    }
    Verdict::Keep(cleaned)
}

pub async fn translate(text: &str) -> Result<Value> {
    if text.trim().is_empty() || text.len() > 500 {
        bail!("每次翻译限 500 个 UTF-8 字节，请分句");
    }
    // Figures, page numbers and punctuation carry no letters to translate.
    // Asking anyway spends the shared quota and comes back as an echo we would
    // have to reject, so skip the network and keep the text as it is.
    if !text.chars().any(char::is_alphabetic) {
        return Ok(json!({"text": text, "provider": "无需翻译 · 原样保留"}));
    }
    let mut url = reqwest::Url::parse("https://api.mymemory.translated.net/get")?;
    url.query_pairs_mut()
        .append_pair("q", text)
        .append_pair("langpair", "en|zh-CN");
    wait_for_translate_slot().await;
    let result: Value =
        serde_json::from_slice(&fetch(url.as_str(), 200_000, "翻译服务").await?)?;
    if result["quotaFinished"] == true || result["responseStatus"] != 200 {
        bail!(
            "免费翻译暂不可用或额度已用完：{}",
            result["responseDetails"].as_str().unwrap_or("请稍后重试")
        );
    }
    let translated = result["responseData"]["translatedText"]
        .as_str()
        .context("翻译服务未返回中文")?;
    match interpret(text, translated) {
        Verdict::Keep(value) => {
            Ok(json!({"text": value, "provider": "MyMemory · 机器辅助翻译"}))
        }
        Verdict::Untranslated(value) => {
            Ok(json!({"text": value, "provider": "无需翻译 · 原样保留"}))
        }
        Verdict::Failed(message) => bail!("{message}"),
    }
}

pub fn news_sources() -> Value {
    json!([
        {"id":"nasa","name":"NASA · 科技与太空","url":"https://www.nasa.gov/news-release/feed/","fullText":true},
        {"id":"guardian","name":"The Guardian · 全球新闻","url":"https://www.theguardian.com/world/rss","fullText":false},
        {"id":"bbc","name":"BBC · 全球新闻","url":"https://feeds.bbci.co.uk/news/world/rss.xml","fullText":false},
        {"id":"voa-news","name":"VOA · 慢速英语新闻","url":"https://learningenglish.voanews.com/api/zkm-ql-vomx-tpej-rqi","fullText":false}
    ])
}

pub async fn news(id: &str) -> Result<Value> {
    let sources = news_sources();
    let source = sources
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .context("未知新闻来源")?;
    let bytes = fetch(source["url"].as_str().unwrap(), 8 * 1024 * 1024, "订阅来源").await?;
    let feed = feed_rs::parser::parse(bytes.as_slice())?;
    let mut articles = Vec::new();
    for entry in feed.entries.iter().take(30) {
        let Some(link) = entry
            .links
            .iter()
            .find(|l| l.rel.as_deref().is_none_or(|r| r == "alternate"))
        else {
            continue;
        };
        let Ok(url) = reqwest::Url::parse(&link.href) else {
            continue;
        };
        if !matches!(url.scheme(), "https" | "http") {
            continue;
        }
        let body = if source["fullText"] == true {
            entry
                .content
                .as_ref()
                .and_then(|c| c.body.as_deref())
                .or(entry.summary.as_ref().map(|s| s.content.as_str()))
        } else {
            entry.summary.as_ref().map(|s| s.content.as_str())
        };
        let html = body.unwrap_or("");
        let document = Html::parse_fragment(html);
        let paragraphs = document
            .select(&Selector::parse("p").unwrap())
            .map(|p| plain(&p.inner_html()))
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>();
        let text = if paragraphs.is_empty() {
            plain(html)
        } else {
            paragraphs.join("\n\n")
        };
        let title = entry
            .title
            .as_ref()
            .map(|t| plain(&t.content))
            .unwrap_or_default();
        let hash = format!("{:x}", Sha256::digest(link.href.as_bytes()));
        articles.push(json!({"id":format!("news-{hash}"),"kind":"article","title":title,"data":{
            "sourceId":id,"provider":source["name"],"sourceUrl":link.href,"text":text,
            "publishedAt":entry.published.or(entry.updated).map(|d|d.to_rfc3339()),"fetchedAt":chrono::Utc::now().to_rfc3339(),
            "contentType":if source["fullText"]==true {"feed-full-text"} else {"summary"},"read":false
        }}));
    }
    if articles.is_empty() {
        bail!("来源没有返回有效新闻，保留已有内容");
    }
    Ok(json!(articles))
}

/// Reading mode: fetch a public article page and extract its main text.
pub async fn extract_article(address: &str) -> Result<Value> {
    let bytes = fetch_public(address, 4 * 1024 * 1024).await?;
    let html = String::from_utf8_lossy(&bytes);
    let page = extract_page(&html);
    let chars = page["chars"].as_u64().unwrap_or(0);
    if chars < 200 {
        bail!("没有从页面中提取到足够的正文，请打开原文阅读");
    }
    Ok(page)
}

fn in_boilerplate(element: &scraper::ElementRef<'_>) -> bool {
    for ancestor in element.ancestors() {
        if let Some(el) = scraper::ElementRef::wrap(ancestor) {
            let tag = el.value().name();
            if matches!(tag, "nav" | "footer" | "aside" | "header") {
                return true;
            }
            let marker = format!(
                "{} {}",
                el.value().attr("class").unwrap_or(""),
                el.value().attr("id").unwrap_or("")
            )
            .to_lowercase();
            if [
                "comment", "share", "related", "sidebar", "footer", "nav-", "menu", "promo",
                "advert", "breadcrumb", "subscribe", "paywall",
            ]
            .iter()
            .any(|word| marker.contains(word))
            {
                return true;
            }
        }
    }
    false
}

fn container_paragraphs(document: &Html, selector: &str) -> Vec<String> {
    let Ok(sel) = Selector::parse(selector) else {
        return vec![];
    };
    document
        .select(&sel)
        .filter(|p| !in_boilerplate(p))
        .map(|p| plain(&p.inner_html()))
        .filter(|t| t.chars().count() >= 20)
        .collect()
}

/// Container scoring: pick the semantic container whose paragraphs carry the
/// most text (boilerplate branches are dropped); fall back to a paragraph
/// scan. Short navigation lines never pass the length thresholds.
pub fn extract_text(html: &str) -> String {
    let document = Html::parse_document(html);
    let mut best: Vec<String> = Vec::new();
    let mut best_score = 0usize;
    for selector in [
        "article p",
        "main p",
        "[role=main] p",
        ".post-content p",
        ".entry-content p",
        ".article-content p",
        ".article-body p",
        ".post p",
    ] {
        let paragraphs = container_paragraphs(&document, selector);
        let score = paragraphs.join("\n\n").chars().count();
        if score > best_score {
            best_score = score;
            best = paragraphs;
        }
    }
    if best.len() >= 3 && best_score >= 250 {
        return truncate_chars(best.join("\n\n"), 40_000);
    }
    let fallback = container_paragraphs(&document, "p")
        .into_iter()
        .filter(|t| t.chars().count() >= 60)
        .collect::<Vec<_>>();
    truncate_chars(fallback.join("\n\n"), 40_000)
}

/// Full extraction result for the reading mode: body text plus page metadata
/// so a summary-only article can be completed offline.
pub fn extract_page(html: &str) -> Value {
    let document = Html::parse_document(html);
    let text = extract_text(html);
    let meta = |selector: &str, attr: &str| -> Option<String> {
        let sel = Selector::parse(selector).ok()?;
        document
            .select(&sel)
            .next()
            .and_then(|el| el.value().attr(attr))
            .map(str::to_string)
    };
    let title = meta("meta[property='og:title']", "content")
        .or_else(|| {
            document
                .select(&Selector::parse("title").unwrap())
                .next()
                .map(|t| plain(&t.inner_html()))
        })
        .or_else(|| {
            document
                .select(&Selector::parse("h1").unwrap())
                .next()
                .map(|h| plain(&h.inner_html()))
        });
    let published =
        meta("meta[property='article:published_time']", "content").or_else(|| {
            meta("time[datetime]", "datetime")
        });
    json!({
        "text": text,
        "title": title,
        "publishedAt": published,
        "chars": text.chars().count(),
        "provider": "阅读模式 · 自动提取",
    })
}

fn truncate_chars(text: String, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text;
    }
    let mut out = text.chars().take(limit).collect::<String>();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpret_separates_untranslated_text_from_real_failures() {
        // A caption, ticker or figure echoed back is not a service failure.
        assert!(matches!(
            interpret("12,345.67 (2026)", "12,345.67 (2026)"),
            Verdict::Untranslated(_)
        ));
        assert!(matches!(interpret("AAPL", "AAPL"), Verdict::Untranslated(_)));
        // An exhausted quota arrives as English text inside a 200 response.
        assert!(matches!(
            interpret(
                "Inventories fell.",
                "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY"
            ),
            Verdict::Failed(_)
        ));
        // Different text with no Chinese is still a real failure.
        assert!(matches!(
            interpret("Inventories fell.", "Inventories fell again."),
            Verdict::Failed(_)
        ));
        match interpret("Inventories fell.", "库存下降。") {
            Verdict::Keep(text) => assert_eq!(text, "库存下降。"),
            _ => panic!("expected a usable translation"),
        }
    }

    #[test]
    fn status_message_attributes_the_service_that_answered() {
        let limited = status_message("翻译服务", reqwest::StatusCode::TOO_MANY_REQUESTS, Some("60"));
        assert!(limited.contains("翻译服务"), "{limited}");
        assert!(limited.contains("429"), "{limited}");
        assert!(limited.contains("60"), "{limited}");
        // A rate-limited translation must never be blamed on the course source.
        assert!(!limited.contains("课程来源"), "{limited}");
        let missing = status_message("课程来源", reqwest::StatusCode::NOT_FOUND, None);
        assert!(missing.contains("课程来源"), "{missing}");
        assert!(missing.contains("404"), "{missing}");
        assert!(!missing.contains("429"), "{missing}");
    }

    #[test]
    fn parse_conversation_extracts_audio_and_dialogue() -> Result<()> {
        let page = r#"<html><body>
        <h2>Conversation</h2>
        <div class="audio"><audio controls><source src="https://learningenglish.voanews.com/a/lesson1.mp3" type="audio/mpeg"></audio></div>
        <p>Pete: Hi! Are you Anna?</p>
        <p>Anna: Yes! Hi there! Are you Pete?</p>
        <p>Pete: I am Pete.</p>
        <h2>Quiz</h2>
        </body></html>"#;
        let (url, lines) = parse_conversation(page)?;
        assert_eq!(url, "https://learningenglish.voanews.com/a/lesson1.mp3");
        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with("Pete:"));
        Ok(())
    }

    #[test]
    fn parse_conversation_rejects_incomplete_pages() {
        let page = "<html><body><h2>Conversation</h2><p>No audio here.</p></body></html>";
        assert!(parse_conversation(page).is_err());
    }

    #[test]
    fn parse_elllo_extracts_relative_audio_and_lines() -> Result<()> {
        let page = r#"<html><body>
        <div class="matpack"><div class="audio"><audio><source src="audio/lesson.mp3"></audio></div></div>
        <div id="view1"><div class="transcript">
          <p>Tom: Hello there.<br>Anna: Nice to meet you.</p>
          <p>Tom: See you later.</p>
        </div></div>
        </body></html>"#;
        let (url, lines) = parse_elllo(page, "https://elllo.org/book/A1/index.html")?;
        assert_eq!(url, "https://elllo.org/book/A1/audio/lesson.mp3");
        assert_eq!(lines.len(), 3);
        Ok(())
    }

    #[test]
    fn extract_text_prefers_article_markup_and_ignores_navigation() {
        let html = r#"<html><body>
        <nav><p>首页</p><p>订阅</p><p>关于我们</p></nav>
        <article>
          <p>Paragraph one is a reasonably long piece of body text that should be kept by the extractor.</p>
          <p>Paragraph two continues the story with another sentence of meaningful length for readers.</p>
          <p>Paragraph three closes the article with enough characters to pass the quality threshold.</p>
        </article>
        </body></html>"#;
        let text = extract_text(html);
        assert!(text.contains("Paragraph one"));
        assert!(text.contains("Paragraph three"));
        assert!(!text.contains("首页"));
    }

    #[test]
    fn extract_text_falls_back_to_paragraph_scan() {
        let html = "<html><body><div><p>This standalone paragraph is long enough to be kept by the fallback scan of the extractor.</p></div></body></html>";
        let text = extract_text(html);
        assert!(text.contains("standalone paragraph"));
    }

    #[test]
    fn extract_text_skips_boilerplate_inside_article() {
        let html = r#"<html><body><article>
          <p>This opening paragraph is real article content and long enough to be kept by the extractor.</p>
          <div class="comments"><p>This comment text is long enough to pass the length filter but must be dropped.</p></div>
          <aside><p>Related sidebar text that is also long enough to pass the plain length filter here.</p></aside>
          <p>The closing paragraph of the article is also long enough and must be kept in the result text.</p>
        </article></body></html>"#;
        let text = extract_text(html);
        assert!(text.contains("opening paragraph"));
        assert!(text.contains("closing paragraph"));
        assert!(!text.contains("comment text"));
        assert!(!text.contains("Related sidebar"));
    }

    #[test]
    fn extract_page_collects_metadata() {
        let html = r#"<html><head>
          <meta property="og:title" content="Supply chain update">
          <meta property="article:published_time" content="2026-10-09T08:00:00Z">
        </head><body><article>
          <p>The company will expand production next year, according to the filing reviewed here.</p>
          <p>Analysts expect the expansion to reach full capacity within two quarters of operation.</p>
          <p>Additional detail about the project timeline is included in the same regulatory filing.</p>
        </article></body></html>"#;
        let page = extract_page(html);
        assert_eq!(page["title"], "Supply chain update");
        assert_eq!(page["publishedAt"], "2026-10-09T08:00:00Z");
        assert!(page["chars"].as_u64().unwrap() > 0);
    }
}
