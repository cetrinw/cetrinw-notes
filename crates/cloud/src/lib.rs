use anyhow::{bail, Context, Result};
use reqwest::{Client, Method, Url};
use serde_json::{json, Value};
use std::time::Duration;

pub struct WebDav {
    client: Client,
    root: Url,
    username: String,
    password: String,
}
impl WebDav {
    pub fn new(address: &str, username: &str, password: &str) -> Result<Self> {
        let mut root = Url::parse(address)?;
        if root.scheme() != "https"
            && !(root.scheme() == "http"
                && matches!(root.host_str(), Some("127.0.0.1" | "localhost" | "::1")))
        {
            bail!("WebDAV 需使用 HTTPS，本机协议测试允许 HTTP");
        }
        if !root.username().is_empty()
            || root.password().is_some()
            || root.query().is_some()
            || root.fragment().is_some()
        {
            bail!("WebDAV 地址中不能包含账号、密码、查询参数或片段");
        }
        if !root.path().ends_with('/') {
            root.set_path(&format!("{}/", root.path()));
        }
        if username.trim().is_empty() || password.is_empty() {
            bail!("请填写 WebDAV 账号与应用授权密码");
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            client,
            root,
            username: username.into(),
            password: password.into(),
        })
    }
    fn request(&self, method: &str, url: Url) -> Result<reqwest::RequestBuilder> {
        Ok(self
            .client
            .request(Method::from_bytes(method.as_bytes())?, url)
            .basic_auth(&self.username, Some(&self.password)))
    }
    fn directory(&self) -> Result<Url> {
        Ok(self.root.join("Cetrinw/")?)
    }
    async fn check(response: reqwest::Response) -> Result<reqwest::Response> {
        let status = response.status();
        if !status.is_success() {
            bail!("WebDAV 返回 HTTP {status}，请检查应用密码、目录权限或云盘额度");
        }
        Ok(response)
    }
    pub async fn test(&self) -> Result<Value> {
        let r=self.request("PROPFIND",self.root.clone())?.header("Depth","0").header("Content-Type","application/xml").body("<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>").send().await.map_err(|e|anyhow::anyhow!("WebDAV 连接失败：{}",e.without_url()))?;
        let status = Self::check(r).await?.status();
        Ok(
            json!({"status":status.as_u16(),"message":"WebDAV 认证与目录读取成功；上传需单独执行备份验证"}),
        )
    }
    pub async fn backup(&self, bytes: Vec<u8>) -> Result<Value> {
        if bytes.len() > 250 * 1024 * 1024 {
            bail!("当前完整备份上限 250 MB，请先导出到本地云盘目录");
        }
        let r = self
            .request("MKCOL", self.directory()?)?
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("创建备份目录失败：{}", e.without_url()))?;
        if !r.status().is_success() && r.status().as_u16() != 405 {
            Self::check(r).await?;
        }
        let filename = format!(
            "Cetrinw-{}-{}.json",
            chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
            &uuid::Uuid::new_v4().to_string()[..8]
        );
        let size = bytes.len();
        let r = self
            .request("PUT", self.directory()?.join(&filename)?)?
            .header("Content-Type", "application/json")
            .header("If-None-Match", "*")
            .body(bytes)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("备份上传失败：{}", e.without_url()))?;
        Self::check(r).await?;
        Ok(json!({"name":filename,"size":size,"uploadedAt":chrono::Utc::now().to_rfc3339()}))
    }
    pub async fn list(&self) -> Result<Value> {
        let r=self.request("PROPFIND",self.directory()?)?.header("Depth","1").header("Content-Type","application/xml").body("<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:displayname/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>").send().await.map_err(|e|anyhow::anyhow!("读取备份列表失败：{}",e.without_url()))?;
        if r.status().as_u16() == 404 {
            return Ok(json!([]));
        }
        let text = Self::check(r).await?.text().await?;
        let doc = roxmltree::Document::parse(&text).context("WebDAV 列表不是有效 XML")?;
        let mut files = Vec::new();
        for node in doc
            .descendants()
            .filter(|n| n.tag_name().name() == "response")
        {
            let value = |tag: &str| {
                node.descendants()
                    .find(|n| n.tag_name().name() == tag)
                    .and_then(|n| n.text())
                    .unwrap_or("")
            };
            let href = value("href");
            let name = href.trim_end_matches('/').rsplit('/').next().unwrap_or("");
            if valid_name(name) {
                files.push(json!({"name":name,"size":value("getcontentlength").parse::<u64>().unwrap_or(0),"modified":value("getlastmodified")}));
            }
        }
        files.sort_by(|a, b| b["name"].as_str().cmp(&a["name"].as_str()));
        Ok(json!(files))
    }
    pub async fn read(&self, name: &str) -> Result<Value> {
        if !valid_name(name) {
            bail!("不是 Cetrinw 备份文件名");
        }
        let r = self
            .request("GET", self.directory()?.join(name)?)?
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("下载备份失败：{}", e.without_url()))?;
        let mut r = Self::check(r).await?;
        let mut bytes = Vec::new();
        while let Some(chunk) = r.chunk().await? {
            if bytes.len() + chunk.len() > 250 * 1024 * 1024 {
                bail!("备份超过 250 MB，请从云盘下载后导入");
            }
            bytes.extend_from_slice(&chunk);
        }
        let bundle: Value = serde_json::from_slice(&bytes)?;
        if bundle["format"] != "cetrinw-backup" || bundle["version"] != 1 {
            bail!("不是支持的完整备份");
        }
        Ok(bundle)
    }
}
fn valid_name(name: &str) -> bool {
    name.starts_with("Cetrinw-")
        && name.ends_with(".json")
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-._".contains(&c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_file_names_are_restricted() {
        assert!(valid_name("Cetrinw-20261010T090000Z-abcdef12.json"));
        assert!(!valid_name("../Cetrinw-x.json"));
        assert!(!valid_name("Cetrinw-x.json/../../etc/passwd"));
        assert!(!valid_name("Other-x.json"));
        assert!(!valid_name("Cetrinw-x.txt"));
        assert!(!valid_name("Cetrinw-带中文.json"));
    }

    #[test]
    fn webdav_requires_https_except_localhost_and_rejects_credentials_in_url() {
        assert!(WebDav::new("https://dav.jianguoyun.com/dav/", "u", "p").is_ok());
        assert!(WebDav::new("http://dav.jianguoyun.com/dav/", "u", "p").is_err());
        assert!(WebDav::new("http://127.0.0.1:8080/dav/", "u", "p").is_ok());
        assert!(WebDav::new("https://u:p@dav.jianguoyun.com/dav/", "u", "p").is_err());
        assert!(WebDav::new("https://dav.jianguoyun.com/dav/?x=1", "u", "p").is_err());
        assert!(WebDav::new("https://dav.jianguoyun.com/dav/", "  ", "p").is_err());
        assert!(WebDav::new("https://dav.jianguoyun.com/dav/", "u", "").is_err());
    }

    #[test]
    fn webdav_normalizes_missing_trailing_slash() -> Result<()> {
        let dav = WebDav::new("https://dav.jianguoyun.com/dav", "u", "p")?;
        assert_eq!(dav.root.path(), "/dav/");
        Ok(())
    }
}
