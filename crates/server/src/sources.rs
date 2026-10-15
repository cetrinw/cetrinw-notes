use super::{db, App};
use anyhow::{bail, Context, Result};
use cetrinw_core::Record;
use chrono::Utc;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{net::IpAddr, time::Duration};

pub async fn get(app: &App, url: &str) -> Result<reqwest::Response> {
    let url = url::Url::parse(url)?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        bail!("数据源和下载链接必须使用公开 HTTPS 地址");
    }
    let host = url.host_str().context("地址缺少主机")?;
    let ips = tokio::net::lookup_host((host, url.port_or_known_default().unwrap_or(443)))
        .await?
        .map(|s| s.ip())
        .collect::<Vec<_>>();
    if ips.is_empty()
        || ips.iter().any(|ip| match ip {
            IpAddr::V4(v) => {
                v.is_private()
                    || v.is_loopback()
                    || v.is_link_local()
                    || v.is_unspecified()
                    || v.is_broadcast()
                    || v.is_multicast()
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
        bail!("数据源不能访问本机或私有网络");
    }
    // Pin validated DNS addresses for this request and never follow unchecked redirects.
    let addrs = ips
        .iter()
        .map(|ip| std::net::SocketAddr::new(*ip, url.port_or_known_default().unwrap_or(443)))
        .collect::<Vec<_>>();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(35))
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addrs)
        .user_agent(std::env::var("CETRINW_USER_AGENT").unwrap_or("Cetrinw/0.1 research".into()))
        .build()?;
    let mut last = String::new();
    for attempt in 0..3 {
        let res = client
            .get(url.clone())
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("来源连接失败：{}", e.without_url()))?;
        let status = res.status();
        if status.is_success() {
            return Ok(res);
        }
        last = format!("来源返回 HTTP {status}");
        if status.as_u16() != 429 && !status.is_server_error() {
            bail!("{last}");
        }
        let delay = res
            .headers()
            .get("retry-after")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(2u64.pow(attempt));
        if delay > 60 {
            bail!("来源限流，要求等待 {delay} 秒；本次刷新未完成");
        }
        tokio::time::sleep(Duration::from_secs(delay)).await;
    }
    let _ = app;
    bail!("{last}")
}
pub async fn read_limited(mut r: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    if r.content_length().is_some_and(|n| n > limit as u64) {
        bail!("来源内容超出下载上限");
    }
    let mut bytes = vec![];
    while let Some(chunk) = r.chunk().await? {
        if bytes.len() + chunk.len() > limit {
            bail!("来源内容超出下载上限");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn json_get(app: &App, url: &str) -> Result<Value> {
    Ok(serde_json::from_slice(
        &read_limited(get(app, url).await?, 25 * 1024 * 1024).await?,
    )?)
}
pub async fn collect(app: &App, source: &Record) -> Result<usize> {
    let c = &source.data["config"];
    let adapter = source.data["adapter"].as_str().context("缺少适配器类型")?;
    let data = match adapter {
        "worldbank" => {
            let country = c["country"].as_str().unwrap_or("CHN");
            let indicator = c["indicator"].as_str().unwrap_or("NY.GDP.MKTP.CD");
            if !country
                .chars()
                .all(|x| x.is_ascii_alphanumeric() || x == ';')
                || !indicator
                    .chars()
                    .all(|x| x.is_ascii_alphanumeric() || x == '.' || x == '_')
            {
                bail!("国家或指标代码格式不正确");
            }
            let url=format!("https://api.worldbank.org/v2/country/{country}/indicator/{indicator}?format=json&per_page=100&date=2000:2030");
            let raw = json_get(app, &url).await?;
            let rows = raw[1]
                .as_array()
                .context("世界银行返回内容不符合指标接口格式")?;
            let points=rows.iter().filter_map(|v|v["value"].as_f64().map(|value|json!({"date":format!("{}-12-31",v["date"].as_str().unwrap_or("")),"value":value}))).collect::<Vec<_>>();
            json!({"points":points,"unit":c["unit"].as_str().unwrap_or("请核对指标定义"),"currency":c["currency"],"sourceUrl":url,"frequency":"annual","indicator":indicator})
        }
        "fred" => {
            let key = std::env::var("FRED_API_KEY").context("未配置服务器 FRED_API_KEY")?;
            let id = c["series_id"].as_str().context("缺少 series_id")?;
            let mut url = url::Url::parse("https://api.stlouisfed.org/fred/series/observations")?;
            url.query_pairs_mut()
                .append_pair("series_id", id)
                .append_pair("api_key", &key)
                .append_pair("file_type", "json");
            let raw = json_get(app, url.as_str()).await?;
            let points =
                raw["observations"]
                    .as_array()
                    .context("FRED 未返回 observations")?
                    .iter()
                    .filter_map(|v| {
                        v["value"].as_str()?.parse::<f64>().ok().map(
                            |n| json!({"date":v["date"],"value":n,"vintage":v["realtime_start"]}),
                        )
                    })
                    .collect::<Vec<_>>();
            json!({"points":points,"unit":c["unit"],"sourceUrl":format!("https://fred.stlouisfed.org/series/{id}"),"indicator":id})
        }
        "akshare" | "tushare" => {
            let python = std::env::var("CETRINW_PYTHON").unwrap_or("python3".into());
            let mut config = c.clone();
            config["adapter"] = json!(adapter);
            let child = tokio::process::Command::new(python)
                .arg(&app.worker)
                .arg(config.to_string())
                .kill_on_drop(true)
                .output();
            let result = tokio::time::timeout(Duration::from_secs(100), child)
                .await
                .context("行情采集超时")??;
            if !result.status.success() {
                let e = String::from_utf8_lossy(&result.stderr);
                bail!("行情采集失败：{}", e.chars().take(500).collect::<String>());
            }
            serde_json::from_slice::<Value>(&result.stdout).context("行情 worker 返回格式错误")?
        }
        "rss" => {
            let url = c["url"].as_str().context("缺少 RSS URL")?;
            let bytes = read_limited(get(app, url).await?, 10 * 1024 * 1024).await?;
            let feed = feed_rs::parser::parse(bytes.as_slice())?;
            let mut count = 0;
            for item in feed.entries.into_iter().take(100) {
                let link = item
                    .links
                    .first()
                    .map(|l| l.href.clone())
                    .unwrap_or_default();
                let id = format!(
                    "event:{:x}",
                    Sha256::digest(format!("{}:{}", source.id, item.id))
                );
                if !db(app, json!({"op":"get","id":id}))?.is_null() {
                    continue;
                }
                // Titles can carry raw HTML from some feeds; store plain text only.
                let title = cetrinw_learning::plain_text(
                    &item
                        .title
                        .map(|t| t.content)
                        .unwrap_or_else(|| "未命名资讯".into()),
                );
                let summary = item
                    .summary
                    .map(|s| ammonia::clean(&s.content))
                    .unwrap_or_default();
                db(
                    app,
                    json!({"op":"save","record":{"id":id,"kind":"event","title":title,"data":{"topicId":c["topicId"],"date":item.published.or(item.updated).map(|t|t.to_rfc3339()),"sourceUrl":link,"evidence":summary,"status":"待确认","sourceId":source.id,"ingestedAt":Utc::now().to_rfc3339()}}}),
                )?;
                count += 1;
            }
            return Ok(count);
        }
        "json" => {
            let url = c["url"].as_str().context("缺少 JSON URL")?;
            let mut data = json_get(app, url).await?;
            data["sourceUrl"] = json!(url);
            data
        }
        "sec" => {
            if std::env::var("CETRINW_USER_AGENT").is_err() {
                bail!("SEC 要求包含联系信息的 User-Agent，请配置 CETRINW_USER_AGENT");
            }
            let cik = c["cik"].as_str().context("缺少公司 CIK")?;
            if !cik.bytes().all(|b| b.is_ascii_digit()) || cik.len() > 10 {
                bail!("CIK 格式错误");
            }
            let url = format!(
                "https://data.sec.gov/api/xbrl/companyfacts/CIK{:0>10}.json",
                cik
            );
            let raw = json_get(app, &url).await?;
            let tag = c["tag"].as_str().unwrap_or("Revenues");
            let unit = c["unit"].as_str().unwrap_or("USD");
            let rows = raw["facts"]["us-gaap"][tag]["units"][unit]
                .as_array()
                .context("该公司没有所选 XBRL 指标或单位")?;
            let points=rows.iter().filter(|r|r["form"]=="10-K"||r["form"]=="10-Q").map(|r|json!({"date":r["end"],"value":r["val"],"publishedAt":r["filed"],"periodStart":r["start"],"accession":r["accn"]})).collect::<Vec<_>>();
            json!({"points":points,"unit":unit,"sourceUrl":url,"indicator":tag})
        }
        _ => bail!("未支持的数据源适配器：{adapter}"),
    };
    let points = data["points"]
        .as_array()
        .context("数据源未返回 points 数组")?;
    if points.is_empty() {
        bail!("来源没有有效观测值，本次刷新未更新数据");
    }
    for p in points {
        if p["date"]
            .as_str()
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .is_none()
        {
            bail!("观测日期格式错误");
        }
        if !p["value"]
            .as_f64()
            .or_else(|| p["close"].as_f64())
            .is_some_and(f64::is_finite)
        {
            bail!("来源存在无效数值");
        }
    }
    let count = points.len();
    let id = format!("series:{}", source.id);
    let current = db(app, json!({"op":"get","id":id}))?;
    let mut data = data;
    data["sourceId"] = json!(source.id);
    data["fetchedAt"] = json!(Utc::now().to_rfc3339());
    data["topicId"] = c["topicId"].clone();
    db(
        app,
        json!({"op":"save","record":{"id":id,"kind":"series","title":source.title,"revision":current["revision"].as_i64().unwrap_or(0),"data":data}}),
    )?;
    Ok(count)
}
