use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use jieba_rs::Jieba;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Record {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub data: Value,
    pub revision: i64,
    pub updated_at: String,
    pub deleted: bool,
    pub conflict_of: Option<String>,
}

pub struct Store {
    pub root: PathBuf,
    conn: Connection,
}
fn tokens(text: &str) -> String {
    static JIEBA: OnceLock<Jieba> = OnceLock::new();
    JIEBA
        .get_or_init(Jieba::new)
        .cut_for_search(text, true)
        .join(" ")
        .to_lowercase()
}
fn text_of(value: &Value, out: &mut String) {
    match value {
        Value::String(s) => {
            out.push_str(s);
            out.push(' ');
        }
        Value::Array(a) => {
            for v in a {
                text_of(v, out)
            }
        }
        Value::Object(o) => {
            for v in o.values() {
                text_of(v, out)
            }
        }
        _ => (),
    }
}
fn field<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|x| !x.is_empty())
        .ok_or_else(|| anyhow!("缺少字段 {key}"))
}
fn safe_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())
}
/// High-frequency kinds (feed refreshes, learning sessions, jobs) would grow the
/// history table without bound; the newest revisions are always kept. Notes and
/// research records keep their full version history for the restore UI.
fn history_limit(kind: &str) -> Option<i64> {
    match kind {
        "article" | "feed" | "session" | "job" => Some(20),
        "lesson" | "word" | "review" | "annotation" | "watch" | "source" | "series" => Some(60),
        _ => None,
    }
}
/// Extracts (target id, relation) pairs for the backlink index. Targets are record
/// ids, except annotation→asset edges which use `asset:<sha256>`.
fn collect_refs(kind: &str, data: &Value) -> Vec<(String, String)> {
    let mut refs = Vec::new();
    match kind {
        "note" => {
            fn walk(value: &Value, refs: &mut Vec<(String, String)>) {
                match value {
                    Value::Array(items) => items.iter().for_each(|v| walk(v, refs)),
                    Value::Object(map) => {
                        if map.get("type").and_then(Value::as_str) == Some("noteReference") {
                            if let Some(id) = map
                                .get("attrs")
                                .and_then(|a| a.get("noteId"))
                                .and_then(Value::as_str)
                                .filter(|s| !s.is_empty())
                            {
                                refs.push((id.to_string(), "reference".into()));
                            }
                        }
                        map.values().for_each(|v| walk(v, refs));
                    }
                    _ => (),
                }
            }
            walk(data, &mut refs);
            // Markdown imports can keep references as cetrinw://note/<id> links.
            if let Some(markdown) = data.get("markdown").and_then(Value::as_str) {
                let marker = "cetrinw://note/";
                let mut rest = markdown;
                while let Some(pos) = rest.find(marker) {
                    rest = &rest[pos + marker.len()..];
                    let id: String = rest
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                        .collect();
                    if id.len() >= 8 {
                        refs.push((id, "reference".into()));
                    }
                }
            }
        }
        "annotation" => {
            if let Some(note) = data
                .get("noteId")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                refs.push((note.to_string(), "note".into()));
            }
            if let Some(hash) = data
                .get("assetHash")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                refs.push((format!("asset:{hash}"), "asset".into()));
            }
        }
        "article" => {
            if let Some(note) = data
                .get("noteId")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                refs.push((note.to_string(), "note".into()));
            }
        }
        _ => (),
    }
    // Topic membership and cycle tagging are indexed so a topic or cycle can
    // list everything attached to it without scanning records.
    if matches!(
        kind,
        "entity" | "relation" | "event" | "thesis" | "series" | "table" | "cycle" | "watch"
            | "source"
    ) {
        if let Some(topic) = data
            .get("topicId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            refs.push((topic.to_string(), "topic".into()));
        }
    }
    if matches!(kind, "event" | "thesis") {
        if let Some(cycle) = data
            .get("cycleId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            refs.push((cycle.to_string(), "cycle".into()));
        }
    }
    refs
}
/// Case-insensitive substring search that maps the match back to a byte index
/// in the original string (lowercasing can change byte lengths).
fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    let hay_lower = hay.to_lowercase();
    let needle_lower = needle.to_lowercase();
    let pos = hay_lower.find(&needle_lower)?;
    let chars = hay_lower[..pos].chars().count();
    hay.char_indices().nth(chars).map(|(i, _)| i)
}
/// Builds a short context window around the first occurrence of the query in
/// the record's own text, so search results can show where the match is.
fn snippet_of(data: &Value, title: &str, query: &str) -> Option<String> {
    let mut text = String::new();
    text_of(data, &mut text);
    let hay = format!("{title} {text}");
    let query = query.trim();
    if query.is_empty() {
        return None;
    }
    let (pos, match_chars) = if let Some(pos) = find_ci(&hay, query) {
        (pos, query.chars().count())
    } else {
        let mut found = None;
        for token in query.split_whitespace() {
            if token.chars().count() < 2 {
                continue;
            }
            if let Some(pos) = find_ci(&hay, token) {
                found = Some((pos, token.chars().count()));
                break;
            }
        }
        found?
    };
    let start = hay[..pos]
        .char_indices()
        .rev()
        .nth(40)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let tail_from = hay[pos..]
        .char_indices()
        .nth(match_chars)
        .map(|(i, _)| pos + i)
        .unwrap_or(hay.len());
    let end = hay[tail_from..]
        .char_indices()
        .nth(80)
        .map(|(i, _)| tail_from + i)
        .unwrap_or(hay.len());
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.push_str(&hay[start..end]);
    if end < hay.len() {
        out.push('…');
    }
    Some(out.split_whitespace().collect::<Vec<_>>().join(" "))
}

impl Store {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(root.join("assets"))?;
        let conn = Connection::open(root.join("notes.sqlite3"))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,conflict_of TEXT);
          CREATE INDEX IF NOT EXISTS records_kind_date ON records(kind,deleted,updated_at DESC);
          CREATE TABLE IF NOT EXISTS history(seq INTEGER PRIMARY KEY AUTOINCREMENT,record_id TEXT NOT NULL,revision INTEGER NOT NULL,snapshot TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS history_record ON history(record_id,seq DESC);
          CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, content);
          CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,op_id TEXT NOT NULL,base_revision INTEGER NOT NULL,record TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS remote_versions(id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS receipts(op_id TEXT PRIMARY KEY,result TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS assets(hash TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS translation_cache(hash TEXT PRIMARY KEY,source TEXT NOT NULL,target TEXT NOT NULL,result TEXT NOT NULL,provider TEXT NOT NULL,created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS links(from_id TEXT NOT NULL,to_id TEXT NOT NULL,rel TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS links_to ON links(to_id,rel);
          CREATE INDEX IF NOT EXISTS links_from ON links(from_id);")?;
        if version < 3 {
            // One-time rebuild so libraries created before newer link kinds keep
            // backlinks, annotations, topic and cycle references in sync.
            let tx = conn.unchecked_transaction()?;
            conn.execute("DELETE FROM links", [])?;
            let rows = {
                let mut st = conn.prepare("SELECT id,kind,data FROM records WHERE deleted=0")?;
                let rows = st
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                rows
            };
            for (id, kind, raw) in rows {
                let data: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
                for (to, rel) in collect_refs(&kind, &data) {
                    if to != id {
                        conn.execute(
                            "INSERT INTO links VALUES(?1,?2,?3)",
                            params![id, to, rel],
                        )?;
                    }
                }
            }
            tx.commit()?;
        }
        conn.execute_batch("PRAGMA user_version=3;")?;
        Ok(Self { root, conn })
    }
    fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<Record> {
        let raw: String = row.get(3)?;
        let data = serde_json::from_str(&raw).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
        })?;
        Ok(Record {
            id: row.get(0)?,
            kind: row.get(1)?,
            title: row.get(2)?,
            data,
            revision: row.get(4)?,
            updated_at: row.get(5)?,
            deleted: row.get(6)?,
            conflict_of: row.get(7)?,
        })
    }
    pub fn get(&self, id: &str) -> Result<Option<Record>> {
        Ok(self.conn.query_row("SELECT id,kind,title,data,revision,updated_at,deleted,conflict_of FROM records WHERE id=?1", [id], Self::decode).optional()?)
    }
    pub fn list(&self, kind: &str, query: &str, limit: i64, offset: i64) -> Result<Vec<Record>> {
        let limit = limit.clamp(1, 1000);
        let base = "SELECT r.id,r.kind,r.title,r.data,r.revision,r.updated_at,r.deleted,r.conflict_of FROM records r";
        if query.trim().is_empty() {
            let mut st = self.conn.prepare(&format!("{base} WHERE r.deleted=0 AND (?1='' OR r.kind=?1) ORDER BY r.updated_at DESC LIMIT ?2 OFFSET ?3"))?;
            let rows = st
                .query_map(params![kind, limit, offset.max(0)], Self::decode)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        } else {
            let q = tokens(query)
                .split_whitespace()
                .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(" OR ");
            if q.is_empty() {
                return Ok(vec![]);
            }
            let mut st = self.conn.prepare(&format!("{base} JOIN search s ON s.id=r.id WHERE search MATCH ?1 AND r.deleted=0 AND (?2='' OR r.kind=?2) ORDER BY rank LIMIT ?3 OFFSET ?4"))?;
            let rows = st
                .query_map(params![q, kind, limit, offset.max(0)], Self::decode)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        }
    }
    fn write(&self, r: &Record, dirty: bool) -> Result<()> {
        self.conn.execute("INSERT INTO records VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at,deleted=excluded.deleted,conflict_of=excluded.conflict_of",
            params![r.id,r.kind,r.title,r.data.to_string(),r.revision,r.updated_at,r.deleted,r.conflict_of])?;
        self.conn
            .execute("DELETE FROM search WHERE id=?1", [&r.id])?;
        if !r.deleted {
            let mut text = format!("{} ", r.title);
            text_of(&r.data, &mut text);
            self.conn.execute(
                "INSERT INTO search(id,content) VALUES(?1,?2)",
                params![r.id, tokens(&text)],
            )?;
        }
        let serialized = serde_json::to_string(r)?;
        self.conn.execute(
            "INSERT INTO history(record_id,revision,snapshot) VALUES(?1,?2,?3)",
            params![r.id, r.revision, serialized],
        )?;
        if let Some(limit) = history_limit(&r.kind) {
            self.conn.execute(
                "DELETE FROM history WHERE record_id=?1 AND seq NOT IN (SELECT seq FROM history WHERE record_id=?1 ORDER BY seq DESC LIMIT ?2)",
                params![r.id, limit],
            )?;
        }
        self.conn
            .execute("DELETE FROM links WHERE from_id=?1", [&r.id])?;
        if !r.deleted {
            for (to, rel) in collect_refs(&r.kind, &r.data) {
                if to != r.id {
                    self.conn.execute(
                        "INSERT INTO links VALUES(?1,?2,?3)",
                        params![r.id, to, rel],
                    )?;
                }
            }
        }
        if dirty {
            let remote: i64 = self
                .conn
                .query_row(
                    "SELECT revision FROM remote_versions WHERE id=?1",
                    [&r.id],
                    |row| row.get(0),
                )
                .optional()?
                .unwrap_or(0);
            self.conn.execute("INSERT INTO outbox VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET op_id=excluded.op_id,record=excluded.record", params![r.id,Uuid::new_v4().to_string(),remote,serialized])?;
        }
        Ok(())
    }
    fn write_remote(&self, incoming: &Record) -> Result<()> {
        // Local edit revisions and server revisions are different clocks.
        let mut local = incoming.clone();
        local.revision = self.get(&incoming.id)?.map_or(1, |r| r.revision + 1);
        self.write(&local, false)?;
        self.conn.execute("INSERT INTO remote_versions VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision", params![incoming.id,incoming.revision])?;
        Ok(())
    }
    pub fn save(&mut self, input: &Value) -> Result<Record> {
        let kind = field(input, "kind")?;
        if ![
            "note",
            "topic",
            "entity",
            "relation",
            "event",
            "thesis",
            "cycle",
            "series",
            "watch",
            "source",
            "lesson",
            "word",
            "review",
            "session",
            "annotation",
            "table",
            "job",
            "article",
            "feed",
        ]
        .contains(&kind)
        {
            bail!("未知记录类型");
        }
        let id = input
            .get("id")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let existing = self.get(&id)?;
        let base = input.get("revision").and_then(Value::as_i64).unwrap_or(0);
        let conflict = existing.as_ref().is_some_and(|r| r.revision != base);
        if existing.as_ref().is_some_and(|r| r.kind != kind) {
            bail!("不允许改变记录类型");
        }
        let title = input
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .unwrap_or("未命名");
        let r = Record {
            id: if conflict {
                Uuid::new_v4().to_string()
            } else {
                id.clone()
            },
            kind: kind.into(),
            title: if conflict {
                format!("{title} · 冲突副本")
            } else {
                title.into()
            },
            data: input.get("data").cloned().unwrap_or(json!({})),
            revision: if conflict {
                1
            } else {
                existing.as_ref().map_or(1, |r| r.revision + 1)
            },
            updated_at: Utc::now().to_rfc3339(),
            deleted: input
                .get("deleted")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            conflict_of: if conflict {
                Some(id)
            } else {
                existing.and_then(|r| r.conflict_of)
            },
        };
        let tx = self.conn.unchecked_transaction()?;
        self.write(&r, true)?;
        tx.commit()?;
        Ok(r)
    }
    pub fn asset_put(&mut self, name: &str, mime: &str, bytes: &[u8]) -> Result<Value> {
        if bytes.len() > 250 * 1024 * 1024 {
            bail!("单个附件上限 250 MB");
        }
        let hash = format!("{:x}", Sha256::digest(bytes));
        let path = self.root.join("assets").join(&hash);
        if !path.exists() {
            let temp = path.with_extension(format!("{}.part", Uuid::new_v4()));
            fs::write(&temp, bytes)?;
            fs::rename(temp, &path)?;
        }
        self.conn.execute(
            "INSERT OR IGNORE INTO assets VALUES(?1,?2,?3,?4)",
            params![hash, name, mime, bytes.len() as i64],
        )?;
        // The absolute path stays local: records and backups are synced and must not
        // carry this machine's directory layout.
        Ok(json!({"hash":hash,"name":name,"mime":mime,"size":bytes.len()}))
    }
    pub fn asset_path(&self, hash: &str) -> Result<PathBuf> {
        if !safe_hash(hash) {
            bail!("无效附件标识");
        }
        let p = self.root.join("assets").join(hash);
        if !p.is_file() {
            bail!("附件尚未下载");
        }
        Ok(p)
    }
    pub fn asset_manifest(&self) -> Result<Vec<Value>> {
        let mut st = self
            .conn
            .prepare("SELECT hash,name,mime,size FROM assets")?;
        let rows = st.query_map([], |r| Ok(json!({"hash":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"mime":r.get::<_,String>(2)?,"size":r.get::<_,i64>(3)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
    pub fn export(&self) -> Result<Value> {
        let mut st = self.conn.prepare(
            "SELECT id,kind,title,data,revision,updated_at,deleted,conflict_of FROM records",
        )?;
        let records = st
            .query_map([], Self::decode)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let assets = self
            .asset_manifest()?
            .into_iter()
            .map(|mut a| -> Result<Value> {
                a["base64"] =
                    json!(STANDARD.encode(fs::read(self.asset_path(field(&a, "hash")?)?)?));
                Ok(a)
            })
            .collect::<Result<Vec<_>>>()?;
        let mut st = self
            .conn
            .prepare("SELECT snapshot FROM history ORDER BY seq")?;
        let history = st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(
            json!({"format":"cetrinw-backup","version":1,"created_at":Utc::now().to_rfc3339(),"records":records,"assets":assets,"history":history}),
        )
    }
    pub fn import(&mut self, bundle: &Value) -> Result<Value> {
        if bundle["format"] != "cetrinw-backup" || bundle["version"] != 1 {
            bail!("不支持的备份格式");
        }
        let records: Vec<Record> = serde_json::from_value(bundle["records"].clone())?;
        let assets = bundle["assets"].as_array().context("缺少附件列表")?;
        let mut validated = vec![];
        for a in assets {
            let bytes = STANDARD.decode(field(a, "base64")?)?;
            let hash = format!("{:x}", Sha256::digest(&bytes));
            if hash != field(a, "hash")? {
                bail!("附件校验失败，未导入");
            }
            validated.push((a, bytes));
        }
        for (a, bytes) in validated {
            self.asset_put(field(a, "name")?, field(a, "mime")?, &bytes)?;
        }
        let mut count = 0;
        let tx = self.conn.unchecked_transaction()?;
        for mut r in records {
            if let Some(current) = self.get(&r.id)? {
                if current.data == r.data
                    && current.title == r.title
                    && current.deleted == r.deleted
                {
                    continue;
                }
                r.conflict_of = Some(r.id.clone());
                r.id = Uuid::new_v4().to_string();
                r.title.push_str(" · 导入副本");
                r.revision = 1;
            }
            self.write(&r, true)?;
            count += 1;
        }
        if let Some(hs) = bundle["history"].as_array() {
            for h in hs {
                let r: Record = serde_json::from_str(h.as_str().context("历史记录损坏")?)?;
                self.conn.execute(
                    "INSERT INTO history(record_id,revision,snapshot) VALUES(?1,?2,?3)",
                    params![r.id, r.revision, h.as_str()],
                )?;
            }
        }
        tx.commit()?;
        Ok(json!({"imported":count,"assets":assets.len()}))
    }
    pub fn backup(&self) -> Result<PathBuf> {
        let root = self.root.join("backups");
        fs::create_dir_all(&root)?;
        let path = root.join(Utc::now().format("%Y-%m-%d").to_string());
        if path.join("complete").exists() {
            return Ok(path);
        }
        fs::create_dir_all(path.join("assets"))?;
        self.conn.backup(
            rusqlite::DatabaseName::Main,
            path.join("notes.sqlite3"),
            None,
        )?;
        for a in self.asset_manifest()? {
            let hash = field(&a, "hash")?;
            let target = path.join("assets").join(hash);
            // Hard-link when the backup sits on the same filesystem, and fall
            // back to a copy when it does not. Short-circuiting keeps the link
            // attempt from running for an asset already backed up.
            if !target.exists()
                && fs::hard_link(self.asset_path(hash)?, &target).is_err()
            {
                fs::copy(self.asset_path(hash)?, target)?;
            }
        }
        fs::write(path.join("complete"), Utc::now().to_rfc3339())?;
        let mut dirs = fs::read_dir(root)?
            .filter_map(|d| d.ok())
            .filter(|d| d.path().join("complete").exists())
            .map(|d| d.path())
            .collect::<Vec<_>>();
        dirs.sort();
        let excess = dirs.len().saturating_sub(30);
        for dir in dirs.into_iter().take(excess) {
            fs::remove_dir_all(dir)?;
        }
        Ok(path)
    }
    pub fn command(&mut self, request: Value) -> Result<Value> {
        match field(&request, "op")? {
            "news_import" => {
                let mut saved = Vec::new();
                for mut article in
                    serde_json::from_value::<Vec<Value>>(request["articles"].clone())?
                {
                    if article["kind"] != "article" {
                        bail!("不是新闻记录");
                    }
                    if let Some(existing) = self.get(field(&article, "id")?)? {
                        article["revision"] = json!(existing.revision);
                        article["deleted"] = json!(existing.deleted);
                        for key in ["read", "bookmarked", "noteId", "topicId"] {
                            article["data"][key] = existing.data[key].clone();
                        }
                        let same_source = article["data"]["text"] == existing.data["text"]
                            && article["title"] == existing.title;
                        if same_source {
                            article["data"]["translations"] = existing.data["translations"].clone();
                            // An unchanged article must not mint a new revision, history
                            // snapshot and search re-index on every scheduled refresh.
                            if article["data"]["publishedAt"] == existing.data["publishedAt"]
                                && article["data"]["sourceUrl"] == existing.data["sourceUrl"]
                            {
                                saved.push(existing);
                                continue;
                            }
                        }
                    }
                    saved.push(self.save(&article)?);
                }
                Ok(json!(saved))
            }
            "list" => Ok(json!(self.list(
                request["kind"].as_str().unwrap_or(""),
                request["query"].as_str().unwrap_or(""),
                request["limit"].as_i64().unwrap_or(100),
                request["offset"].as_i64().unwrap_or(0)
            )?)),
            "search" => {
                let query = request["query"].as_str().unwrap_or("").trim().to_string();
                if query.is_empty() {
                    return Ok(json!({"records": [], "total": 0}));
                }
                // An exact record id opens directly, even when FTS tokenization
                // would not match a UUID.
                if let Some(record) = self.get(&query)? {
                    return Ok(json!({"records": [{"record": record, "snippet": Value::Null, "titleMatch": true}], "total": 1}));
                }
                let kind = request["kind"].as_str().unwrap_or("");
                let limit = request["limit"].as_i64().unwrap_or(50).clamp(1, 200);
                let offset = request["offset"].as_i64().unwrap_or(0).max(0);
                let from = request["from"].as_str().unwrap_or("");
                let to = request["to"].as_str().unwrap_or("");
                let tag = request["tag"].as_str().unwrap_or("");
                let q = tokens(&query)
                    .split_whitespace()
                    .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(" OR ");
                if q.is_empty() {
                    return Ok(json!({"records": [], "total": 0}));
                }
                let mut st = self.conn.prepare(
                    "SELECT r.id,r.kind,r.title,r.data,r.revision,r.updated_at,r.deleted,r.conflict_of FROM records r JOIN search s ON s.id=r.id WHERE search MATCH ?1 AND r.deleted=0 AND (?2='' OR r.kind=?2) ORDER BY rank LIMIT 200",
                )?;
                let rows = st
                    .query_map(params![q, kind], Self::decode)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let needle = query.to_lowercase();
                let mut hits = Vec::new();
                for r in rows {
                    let updated: String = r.updated_at.chars().take(10).collect();
                    if !from.is_empty() && updated.as_str() < from {
                        continue;
                    }
                    if !to.is_empty() && updated.as_str() > to {
                        continue;
                    }
                    if !tag.is_empty() {
                        let has = r
                            .data
                            .get("tags")
                            .and_then(Value::as_array)
                            .is_some_and(|tags| {
                                tags.iter().any(|t| t.as_str() == Some(tag))
                            });
                        if !has {
                            continue;
                        }
                    }
                    let title_match = r.title.to_lowercase().contains(&needle);
                    let snippet = snippet_of(&r.data, &r.title, &query);
                    hits.push(json!({"record": r, "snippet": snippet, "titleMatch": title_match}));
                }
                let total = hits.len() as i64;
                let page: Vec<Value> = hits
                    .into_iter()
                    .skip(offset as usize)
                    .take(limit as usize)
                    .collect();
                Ok(json!({"records": page, "total": total}))
            }
            "get" => Ok(json!(self.get(field(&request, "id")?)?)),
            "save" => Ok(json!(self.save(&request["record"])?)),
            "delete" => {
                let mut r =
                    serde_json::to_value(self.get(field(&request, "id")?)?.context("记录不存在")?)?;
                r["deleted"] = json!(true);
                Ok(json!(self.save(&r)?))
            }
            "restore" => {
                let mut r =
                    serde_json::to_value(self.get(field(&request, "id")?)?.context("记录不存在")?)?;
                r["deleted"] = json!(false);
                Ok(json!(self.save(&r)?))
            }
            "trash" => {
                let mut st = self.conn.prepare(
                    "SELECT id,kind,title,data,revision,updated_at,deleted,conflict_of FROM records WHERE deleted=1 AND (?1='' OR kind=?1) ORDER BY updated_at DESC LIMIT 200",
                )?;
                let rows = st
                    .query_map([request["kind"].as_str().unwrap_or("")], Self::decode)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(json!(rows))
            }
            "links" => {
                let rel = request["rel"].as_str().unwrap_or("");
                let mut st = self.conn.prepare(
                    "SELECT r.id,r.kind,r.title,r.data,r.revision,r.updated_at,r.deleted,r.conflict_of FROM records r JOIN links l ON l.from_id=r.id WHERE l.to_id=?1 AND (?2='' OR l.rel=?2) AND r.deleted=0 GROUP BY r.id ORDER BY r.updated_at DESC LIMIT 200",
                )?;
                let rows = st
                    .query_map(params![field(&request, "to")?, rel], Self::decode)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(json!(rows))
            }
            "history" => {
                let mut st = self.conn.prepare(
                    "SELECT snapshot FROM history WHERE record_id=?1 ORDER BY seq DESC LIMIT 100",
                )?;
                let hs = st
                    .query_map([field(&request, "id")?], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(json!(hs
                    .iter()
                    .map(|s| serde_json::from_str::<Value>(s))
                    .collect::<serde_json::Result<Vec<_>>>()?))
            }
            "stats" => {
                let mut st = self
                    .conn
                    .prepare("SELECT kind,count(*) FROM records WHERE deleted=0 GROUP BY kind")?;
                let rows = st
                    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let mut counts = serde_json::Map::new();
                for (k, v) in rows {
                    counts.insert(k, json!(v));
                }
                let conflicts: i64 = self.conn.query_row(
                    "SELECT count(*) FROM records WHERE conflict_of IS NOT NULL AND deleted=0",
                    [],
                    |r| r.get(0),
                )?;
                let history_rows: i64 =
                    self.conn
                        .query_row("SELECT count(*) FROM history", [], |r| r.get(0))?;
                let (asset_count, asset_bytes): (i64, i64) = self.conn.query_row(
                    "SELECT count(*), coalesce(sum(size),0) FROM assets",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?;
                let database_bytes = fs::metadata(self.root.join("notes.sqlite3"))
                    .map(|m| m.len())
                    .unwrap_or(0);
                Ok(
                    json!({"counts":counts,"conflicts":conflicts,"history":history_rows,"databaseBytes":database_bytes,"assets":{"count":asset_count,"bytes":asset_bytes},"storage":"SQLite","root":self.root}),
                )
            }
            "dictionary" => {
                let word = field(&request, "word")?.to_lowercase();
                let path = if self.root.join("dictionary.sqlite3").is_file() {
                    self.root.join("dictionary.sqlite3")
                } else {
                    // Development fallback; a server started from another directory can
                    // point at the bundled file explicitly.
                    std::env::var("CETRINW_DICTIONARY")
                        .map(PathBuf::from)
                        .unwrap_or_else(|_| PathBuf::from("resources/dictionary.sqlite3"))
                };
                if !path.is_file() {
                    return Ok(Value::Null);
                }
                let conn =
                    Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
                let entry=conn.query_row("SELECT word,phonetic,definition,translation FROM dictionary WHERE word=?1",[word],|r|Ok(json!({"word":r.get::<_,String>(0)?,"phonetic":r.get::<_,String>(1)?,"definition":r.get::<_,String>(2)?,"translation":r.get::<_,String>(3)?,"source":"ECDICT · MIT · 本地英汉词典"}))).optional()?;
                Ok(entry.unwrap_or(Value::Null))
            }
            "asset_put" => {
                let bytes = STANDARD.decode(field(&request, "base64")?)?;
                self.asset_put(field(&request, "name")?, field(&request, "mime")?, &bytes)
            }
            "asset_list" => Ok(json!(self.asset_manifest()?)),
            "asset_get" => {
                let hash = field(&request, "hash")?;
                Ok(json!({"base64":STANDARD.encode(fs::read(self.asset_path(hash)?)?)}))
            }
            "asset_path" => Ok(json!(self.asset_path(field(&request, "hash")?)?)),
            "export" => self.export(),
            "import" => self.import(&request["bundle"]),
            "backup" => Ok(json!({"path":self.backup()?})),
            "setting_get" => Ok(self
                .conn
                .query_row(
                    "SELECT value FROM settings WHERE key=?1",
                    [field(&request, "key")?],
                    |r| r.get::<_, String>(0),
                )
                .optional()?
                .map(|s| serde_json::from_str(&s))
                .transpose()?
                .unwrap_or(Value::Null)),
            "setting_set" => {
                self.conn.execute("INSERT INTO settings VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![field(&request,"key")?,request["value"].to_string()])?;
                Ok(json!(true))
            }
            "outbox" => {
                let mut st = self
                    .conn
                    .prepare("SELECT op_id,base_revision,record FROM outbox LIMIT 500")?;
                let rows = st
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(json!(rows.into_iter().map(|(op,base,raw)|Ok(json!({"op_id":op,"base_revision":base,"record":serde_json::from_str::<Value>(&raw)?}))).collect::<Result<Vec<_>>>()?))
            }
            "changes" => {
                let cursor = request["cursor"].as_i64().unwrap_or(0);
                let mut st = self.conn.prepare(
                    "SELECT seq,snapshot FROM history WHERE seq>?1 ORDER BY seq LIMIT 500",
                )?;
                let rows = st
                    .query_map([cursor], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let last = rows.last().map_or(cursor, |r| r.0);
                Ok(
                    json!({"cursor":last,"more":rows.len()==500,"records":rows.into_iter().map(|(_,s)|serde_json::from_str::<Value>(&s)).collect::<serde_json::Result<Vec<_>>>()?}),
                )
            }
            "sync_push" => {
                let op_id = field(&request, "op_id")?;
                if let Some(raw) = self
                    .conn
                    .query_row("SELECT result FROM receipts WHERE op_id=?1", [op_id], |r| {
                        r.get::<_, String>(0)
                    })
                    .optional()?
                {
                    return Ok(serde_json::from_str(&raw)?);
                }
                let mut input = request["record"].clone();
                input["revision"] = request["base_revision"].clone();
                let original_id = field(&input, "id")?.to_string();
                let canonical = self.get(&original_id)?;
                // Receipt and save form one transaction: a retry cannot duplicate a conflict copy.
                let tx = self.conn.unchecked_transaction()?;
                let base = input["revision"].as_i64().unwrap_or(0);
                let conflict = canonical.as_ref().is_some_and(|r| r.revision != base);
                let incoming: Record = serde_json::from_value(request["record"].clone())?;
                let mut r = incoming;
                r.id = if conflict {
                    Uuid::new_v4().to_string()
                } else {
                    original_id.clone()
                };
                r.revision = if conflict {
                    1
                } else {
                    canonical.as_ref().map_or(1, |r| r.revision + 1)
                };
                r.updated_at = Utc::now().to_rfc3339();
                if conflict {
                    r.conflict_of = Some(original_id.clone());
                    r.title.push_str(" · 冲突副本");
                }
                self.write(&r, false)?;
                let result = json!({"op_id":op_id,"original_id":original_id,"record":r,"canonical":if conflict {canonical} else {None}});
                self.conn.execute(
                    "INSERT INTO receipts VALUES(?1,?2)",
                    params![op_id, result.to_string()],
                )?;
                tx.commit()?;
                Ok(result)
            }
            "sync_ack" => {
                let ack = &request["ack"];
                let id = field(ack, "original_id")?;
                let current_op = self
                    .conn
                    .query_row("SELECT op_id FROM outbox WHERE id=?1", [id], |r| {
                        r.get::<_, String>(0)
                    })
                    .optional()?;
                let r: Record = serde_json::from_value(ack["record"].clone())?;
                let canonical: Option<Record> = serde_json::from_value(ack["canonical"].clone())?;
                let authoritative = canonical.as_ref().unwrap_or(&r);
                let tx = self.conn.unchecked_transaction()?;
                self.conn.execute("INSERT INTO remote_versions VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision",params![id,authoritative.revision])?;
                if current_op.as_deref() == ack["op_id"].as_str() {
                    self.conn.execute("DELETE FROM outbox WHERE id=?1", [id])?;
                    if let Some(c) = canonical {
                        self.write_remote(&c)?;
                        self.write_remote(&r)?;
                    }
                    // An acknowledgement of our own write does not change local content
                    // or invalidate the editor's current revision.
                } else {
                    self.conn.execute(
                        "UPDATE outbox SET base_revision=?2 WHERE id=?1",
                        params![id, authoritative.revision],
                    )?;
                    if r.id != id {
                        self.write_remote(&r)?;
                    }
                }
                tx.commit()?;
                Ok(json!(true))
            }
            "sync_apply" => {
                let records: Vec<Record> = serde_json::from_value(request["records"].clone())?;
                let tx = self.conn.unchecked_transaction()?;
                for r in records {
                    let dirty: bool = self.conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1)",
                        [&r.id],
                        |x| x.get(0),
                    )?;
                    let known: i64 = self
                        .conn
                        .query_row(
                            "SELECT revision FROM remote_versions WHERE id=?1",
                            [&r.id],
                            |x| x.get(0),
                        )
                        .optional()?
                        .unwrap_or(0);
                    if r.revision <= known {
                        continue;
                    }
                    if !dirty {
                        let unchanged = self.get(&r.id)?.is_some_and(|local| {
                            local.title == r.title
                                && local.data == r.data
                                && local.deleted == r.deleted
                        });
                        if unchanged {
                            // Re-pairing or re-applying an identical record must not bump
                            // local revisions or grow history.
                            self.conn.execute(
                                "INSERT INTO remote_versions VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision",
                                params![r.id, r.revision],
                            )?;
                            continue;
                        }
                        self.write_remote(&r)?;
                    }
                }
                self.conn.execute("INSERT INTO settings VALUES('sync_cursor',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[request["cursor"].to_string()])?;
                tx.commit()?;
                Ok(json!(true))
            }
            "sync_reset" => {
                // Used before pairing with a new server: local content stays, but
                // pending pushes, receipts, cursors and known remote versions are dropped.
                self.conn.execute_batch(
                    "DELETE FROM outbox; DELETE FROM receipts; DELETE FROM remote_versions;
                     DELETE FROM settings WHERE key IN ('sync_cursor','sync_error');",
                )?;
                Ok(json!(true))
            }
            "translate_cache_get" => {
                let text = field(&request, "text")?;
                let target = request["target"].as_str().unwrap_or("zh-CN");
                let hash = format!(
                    "{:x}",
                    Sha256::digest(format!("en|{target}|{text}").as_bytes())
                );
                let entry = self
                    .conn
                    .query_row(
                        "SELECT result,provider FROM translation_cache WHERE hash=?1",
                        [&hash],
                        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                    )
                    .optional()?;
                Ok(entry.map_or(Value::Null, |(text, provider)| {
                    json!({"text":text,"provider":provider})
                }))
            }
            "translate_cache_put" => {
                let text = field(&request, "text")?;
                let target = request["target"].as_str().unwrap_or("zh-CN");
                let result = field(&request, "result")?;
                let provider = request["provider"].as_str().unwrap_or("unknown");
                let hash = format!(
                    "{:x}",
                    Sha256::digest(format!("en|{target}|{text}").as_bytes())
                );
                self.conn.execute(
                    "INSERT INTO translation_cache VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(hash) DO UPDATE SET result=excluded.result,provider=excluded.provider,created_at=excluded.created_at",
                    params![hash, text, target, result, provider, Utc::now().to_rfc3339()],
                )?;
                // Keep the cache bounded; newest entries win.
                self.conn.execute(
                    "DELETE FROM translation_cache WHERE hash NOT IN (SELECT hash FROM translation_cache ORDER BY created_at DESC LIMIT 5000)",
                    [],
                )?;
                Ok(json!(true))
            }
            _ => bail!("未知操作"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note(id: &str, rev: i64, text: &str) -> Value {
        json!({"id":id,"kind":"note","title":"超级电容产业研究","revision":rev,"data":{"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]},"tags":["行业研究"]}})
    }
    #[test]
    fn feed_refresh_preserves_reader_work_and_note_links() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        let mut article = json!({"id":"rss-supply-chain","kind":"article","title":"Supply chain update","data":{"text":"The company will expand production next year.","sourceUrl":"https://example.org/company/update","publishedAt":"2026-10-09T08:00:00Z"}});
        s.command(json!({"op":"news_import","articles":[article.clone()]}))?;
        s.save(&note("analysis", 0, "新增产能仍需核对订单与收入确认时间。"))?;
        let mut edited = serde_json::to_value(s.get("rss-supply-chain")?.unwrap())?;
        edited["data"]["read"] = json!(true);
        edited["data"]["bookmarked"] = json!(true);
        edited["data"]["noteId"] = json!("analysis");
        edited["data"]["topicId"] = json!("supercapacitors");
        edited["data"]["translations"] = json!({"0":"供应链更新","1":"公司计划明年扩产。"});
        s.save(&edited)?;
        for _ in 0..2 {
            s.command(json!({"op":"news_import","articles":[article.clone()]}))?;
            let refreshed = s.get("rss-supply-chain")?.unwrap();
            for key in ["read", "bookmarked", "noteId", "topicId", "translations"] {
                assert_eq!(refreshed.data[key], edited["data"][key]);
            }
        }
        article["data"]["text"] = json!("The expansion is now postponed pending orders.");
        s.command(json!({"op":"news_import","articles":[article.clone()]}))?;
        let updated = s.get("rss-supply-chain")?.unwrap();
        assert_eq!(updated.data["text"], article["data"]["text"]);
        assert!(updated.data["translations"].is_null());
        assert_eq!(updated.data["noteId"], "analysis");
        assert_eq!(s.list("note", "", 20, 0)?.len(), 1);
        s.command(json!({"op":"delete","id":"rss-supply-chain"}))?;
        s.command(json!({"op":"news_import","articles":[article]}))?;
        assert!(s.get("rss-supply-chain")?.unwrap().deleted);
        Ok(())
    }
    #[test]
    fn unchanged_feed_refresh_does_not_grow_history_or_revision() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        let article = json!({"id":"rss-stable","kind":"article","title":"Stable headline","data":{"text":"Body text that does not change.","sourceUrl":"https://example.org/stable","publishedAt":"2026-10-09T08:00:00Z"}});
        for i in 0..3 {
            // fetchedAt differs on every scheduled refresh and must not defeat the check.
            let mut refreshed = article.clone();
            refreshed["data"]["fetchedAt"] = json!(format!("2026-10-10T0{i}:00:00Z"));
            s.command(json!({"op":"news_import","articles":[refreshed]}))?;
        }
        let r = s.get("rss-stable")?.unwrap();
        assert_eq!(r.revision, 1);
        let rows: i64 = s.conn.query_row(
            "SELECT count(*) FROM history WHERE record_id='rss-stable'",
            [],
            |x| x.get(0),
        )?;
        assert_eq!(rows, 1);
        let mut changed = article.clone();
        changed["data"]["text"] = json!("The body was corrected by the publisher.");
        s.command(json!({"op":"news_import","articles":[changed]}))?;
        assert_eq!(s.get("rss-stable")?.unwrap().revision, 2);
        Ok(())
    }
    #[test]
    fn deleted_note_can_be_listed_in_trash_and_restored() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        s.save(&note("n", 0, "误删的研究笔记"))?;
        s.command(json!({"op":"delete","id":"n"}))?;
        assert!(s.list("note", "", 10, 0)?.is_empty());
        let trash = s.command(json!({"op":"trash","kind":"note"}))?;
        assert_eq!(trash.as_array().unwrap().len(), 1);
        s.command(json!({"op":"restore","id":"n"}))?;
        assert_eq!(s.list("note", "", 10, 0)?.len(), 1);
        // Restoring must put the record back into the full-text index.
        assert_eq!(s.list("note", "研究", 10, 0)?.len(), 1);
        assert!(s
            .command(json!({"op":"trash","kind":"note"}))?
            .as_array()
            .unwrap()
            .is_empty());
        Ok(())
    }
    #[test]
    fn sync_ack_does_not_invalidate_open_editor_after_multiple_local_saves() -> Result<()> {
        let local_dir = tempfile::tempdir()?;
        let hub_dir = tempfile::tempdir()?;
        let mut local = Store::open(local_dir.path())?;
        let mut hub = Store::open(hub_dir.path())?;
        for rev in 0..5 {
            local.save(&note(
                "n",
                rev,
                &format!("第 {} 次补充供应商公告证据", rev + 1),
            ))?;
        }
        let mut op = local.command(json!({"op":"outbox"}))?[0].clone();
        op["op"] = json!("sync_push");
        let ack = hub.command(op)?;
        assert_eq!(ack["record"]["revision"], 1);
        local.command(json!({"op":"sync_ack","ack":ack}))?;
        assert_eq!(local.get("n")?.unwrap().revision, 5);
        let next = local.save(&note("n", 5, "同步期间继续补充收入确认时间"))?;
        assert_eq!(next.id, "n");
        assert!(next.conflict_of.is_none());
        Ok(())
    }
    #[test]
    fn persistence_chinese_search_history_and_conflicts() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        s.save(&note(
            "report",
            0,
            "活性炭与电解液是研究对象。订单需核对供应商及收入确认时间。",
        ))?;
        assert_eq!(s.list("note", "电解液", 20, 0)?.len(), 1);
        let r = s.save(&note("report", 1, "补充供应商公告和财报原文证据。"))?;
        let conflict = s.save(&note("report", 1, "另一台电脑离线补充下游订单风险。"))?;
        assert_eq!(conflict.conflict_of.as_deref(), Some("report"));
        drop(s);
        let mut s = Store::open(d.path())?;
        assert_eq!(s.get("report")?.unwrap(), r);
        assert_eq!(
            s.command(json!({"op":"history","id":"report"}))?
                .as_array()
                .unwrap()
                .len(),
            2
        );
        Ok(())
    }
    #[test]
    fn offline_sync_preserves_two_realistic_edits_and_retry_is_idempotent() -> Result<()> {
        let a = tempfile::tempdir()?;
        let b = tempfile::tempdir()?;
        let h = tempfile::tempdir()?;
        let mut a = Store::open(a.path())?;
        let mut b = Store::open(b.path())?;
        let mut hub = Store::open(h.path())?;
        a.save(&note("n", 0, "超级电容：保存供应链报告摘要及来源。"))?;
        fn push(client: &mut Store, hub: &mut Store) -> Result<Value> {
            let mut op = client.command(json!({"op":"outbox"}))?[0].clone();
            op["op"] = json!("sync_push");
            let ack = hub.command(op.clone())?;
            assert_eq!(ack, hub.command(op)?);
            client.command(json!({"op":"sync_ack","ack":ack}))?;
            Ok(ack)
        }
        push(&mut a, &mut hub)?;
        let changes = hub.command(json!({"op":"changes"}))?;
        b.command(
            json!({"op":"sync_apply","records":changes["records"],"cursor":changes["cursor"]}),
        )?;
        a.save(&note("n", 1, "来自桌面：新增电解液成本证据。"))?;
        b.save(&note("n", 1, "来自另一设备：新增下游订单证据。"))?;
        push(&mut a, &mut hub)?;
        let ack = push(&mut b, &mut hub)?;
        assert_eq!(ack["record"]["conflict_of"], "n");
        assert_eq!(hub.list("note", "", 10, 0)?.len(), 2);
        assert!(b.get("n")?.unwrap().data.to_string().contains("电解液"));
        assert!(b
            .get(ack["record"]["id"].as_str().unwrap())?
            .unwrap()
            .data
            .to_string()
            .contains("订单"));
        Ok(())
    }
    #[test]
    fn backup_roundtrip_preserves_rich_table_and_attachment_and_rejects_corruption() -> Result<()> {
        let a = tempfile::tempdir()?;
        let b = tempfile::tempdir()?;
        let mut a = Store::open(a.path())?;
        let mut b = Store::open(b.path())?;
        let asset = a.asset_put(
            "dialogue.srt",
            "text/plain",
            "1\n00:00:00,000 --> 00:00:02,000\nCould you explain the supply chain?".as_bytes(),
        )?;
        let mut n = note("table", 0, "资料引文");
        n["data"]["table"] = json!({"colspan":2,"source":"annual-report","asset":asset["hash"]});
        a.save(&n)?;
        let bundle = a.export()?;
        b.import(&bundle)?;
        assert_eq!(a.get("table")?, b.get("table")?);
        assert_eq!(
            fs::read(a.asset_path(asset["hash"].as_str().unwrap())?)?,
            fs::read(b.asset_path(asset["hash"].as_str().unwrap())?)?
        );
        let mut corrupt = bundle;
        corrupt["assets"][0]["base64"] = json!(STANDARD.encode("wrong content"));
        assert!(b.import(&corrupt).is_err());
        assert!(a.backup()?.join("complete").exists());
        Ok(())
    }
    #[test]
    fn deleted_record_does_not_resurrect_on_stale_edit() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        s.save(&note("n", 0, "供应链研究"))?;
        s.command(json!({"op":"delete","id":"n"}))?;
        let r = s.save(&note("n", 1, "离线补充原文"))?;
        assert!(s.get("n")?.unwrap().deleted);
        assert_ne!(r.id, "n");
        Ok(())
    }
    #[test]
    fn frequent_refreshes_keep_history_bounded_but_notes_keep_full_history() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        let mut article = json!({"id":"rss-busy","kind":"article","title":"Rolling update","data":{"text":"First body.","sourceUrl":"https://example.org/a","publishedAt":"2026-10-09T08:00:00Z"}});
        for i in 0..40 {
            article["data"]["text"] = json!(format!("Body revision {i}."));
            s.command(json!({"op":"news_import","articles":[article.clone()]}))?;
        }
        let rows: i64 = s.conn.query_row(
            "SELECT count(*) FROM history WHERE record_id='rss-busy'",
            [],
            |r| r.get(0),
        )?;
        assert!(rows <= 20, "article history should be trimmed, got {rows}");
        assert_eq!(s.get("rss-busy")?.unwrap().revision, 40);
        for i in 0..40 {
            s.save(&note("n", i, &format!("第 {} 次补充证据", i + 1)))?;
        }
        let rows: i64 = s.conn.query_row(
            "SELECT count(*) FROM history WHERE record_id='n'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(rows, 40, "notes keep their full version history");
        Ok(())
    }
    #[test]
    fn backlinks_index_tracks_references_and_annotations() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        s.save(&note("target", 0, "被引用的研究笔记"))?;
        let mut source = note("source", 0, "引用另一篇笔记");
        source["data"]["content"] = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"noteReference","attrs":{"noteId":"target","label":"目标"}}]}]});
        s.save(&source)?;
        let backlinks = s.command(json!({"op":"links","to":"target","rel":"reference"}))?;
        assert_eq!(backlinks.as_array().unwrap().len(), 1);
        assert_eq!(backlinks[0]["id"], "source");
        s.save(&note("source", 1, "不再引用"))?;
        assert!(s
            .command(json!({"op":"links","to":"target","rel":"reference"}))?
            .as_array()
            .unwrap()
            .is_empty());
        let hash = "a".repeat(64);
        s.save(&json!({"id":"ann","kind":"annotation","title":"第 1 页","data":{"assetHash":hash,"noteId":"target","page":1,"quote":"q","rects":[]}}))?;
        assert_eq!(
            s.command(json!({"op":"links","to":"target","rel":"note"}))?
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            s.command(json!({"op":"links","to":format!("asset:{hash}")}))?
                .as_array()
                .unwrap()
                .len(),
            1
        );
        s.command(json!({"op":"delete","id":"ann"}))?;
        assert!(s
            .command(json!({"op":"links","to":format!("asset:{hash}")}))?
            .as_array()
            .unwrap()
            .is_empty());
        Ok(())
    }
    #[test]
    fn links_are_backfilled_for_existing_libraries() -> Result<()> {
        let d = tempfile::tempdir()?;
        {
            let mut s = Store::open(d.path())?;
            s.save(&note("target", 0, "被引用"))?;
            let mut source = note("source", 0, "引用另一篇笔记");
            source["data"]["content"] = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"noteReference","attrs":{"noteId":"target","label":"目标"}}]}]});
            s.save(&source)?;
            // Simulate a library written before the links table existed.
            s.conn.execute_batch("DELETE FROM links; PRAGMA user_version=1;")?;
        }
        let mut s = Store::open(d.path())?;
        assert_eq!(
            s.command(json!({"op":"links","to":"target","rel":"reference"}))?
                .as_array()
                .unwrap()
                .len(),
            1
        );
        Ok(())
    }
    #[test]
    fn empty_title_falls_back_and_stats_report_storage() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        let r = s.save(&json!({"id":"t","kind":"note","title":"   ","data":{}}))?;
        assert_eq!(r.title, "未命名");
        let stats = s.command(json!({"op":"stats"}))?;
        assert!(stats["history"].as_i64().unwrap() >= 1);
        assert!(stats["databaseBytes"].as_i64().unwrap() > 0);
        assert_eq!(stats["assets"]["count"], 0);
        Ok(())
    }
    #[test]
    fn sync_apply_skips_identical_records_without_history_churn() -> Result<()> {
        let a = tempfile::tempdir()?;
        let b = tempfile::tempdir()?;
        let mut a = Store::open(a.path())?;
        let mut b = Store::open(b.path())?;
        a.save(&note("n", 0, "供应链研究"))?;
        let changes = a.command(json!({"op":"changes"}))?;
        b.command(
            json!({"op":"sync_apply","records":changes["records"],"cursor":changes["cursor"]}),
        )?;
        let revision = b.get("n")?.unwrap().revision;
        let rows: i64 = b.conn.query_row(
            "SELECT count(*) FROM history WHERE record_id='n'",
            [],
            |r| r.get(0),
        )?;
        // Re-pairing with a server: known remote versions are dropped, then the
        // same state arrives again and must not create revisions or history.
        b.command(json!({"op":"sync_reset"}))?;
        b.command(
            json!({"op":"sync_apply","records":changes["records"],"cursor":changes["cursor"]}),
        )?;
        assert_eq!(b.get("n")?.unwrap().revision, revision);
        let after: i64 = b.conn.query_row(
            "SELECT count(*) FROM history WHERE record_id='n'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(after, rows);
        assert!(b.command(json!({"op":"outbox"}))?.as_array().unwrap().is_empty());
        Ok(())
    }
    #[test]
    fn topic_and_cycle_references_are_indexed() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        s.save(&json!({"id":"t","kind":"topic","title":"超级电容","data":{}}))?;
        s.save(&json!({"id":"c","kind":"cycle","title":"库存周期","data":{"topicId":"t","phases":[{"id":"p1","name":"补库","start":"2026-01-01","end":"2026-06-30"}]}}))?;
        s.save(&json!({"id":"e","kind":"event","title":"涨价","data":{"topicId":"t","cycleId":"c","phaseId":"p1","date":"2026-03-01"}}))?;
        let by_topic = s.command(json!({"op":"links","to":"t","rel":"topic"}))?;
        assert_eq!(by_topic.as_array().unwrap().len(), 2);
        let by_cycle = s.command(json!({"op":"links","to":"c","rel":"cycle"}))?;
        assert_eq!(by_cycle.as_array().unwrap().len(), 1);
        assert_eq!(by_cycle[0]["id"], "e");
        Ok(())
    }
    #[test]
    fn search_returns_snippets_and_opens_exact_ids() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        s.save(&note("report", 0, "活性炭与电解液是研究对象，订单需核对供应商。"))?;
        let hits = s.command(json!({"op":"search","query":"电解液"}))?;
        let rows = hits["records"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["record"]["id"], "report");
        assert!(rows[0]["snippet"].as_str().unwrap().contains("电解液"));
        assert_eq!(hits["total"], 1);
        // An exact record id opens directly, bypassing FTS tokenization.
        let by_id = s.command(json!({"op":"search","query":"report"}))?;
        assert_eq!(by_id["records"][0]["record"]["id"], "report");
        // Kind filter excludes other kinds.
        let filtered = s.command(json!({"op":"search","query":"电解液","kind":"lesson"}))?;
        assert_eq!(filtered["records"].as_array().unwrap().len(), 0);
        Ok(())
    }
    #[test]
    fn translation_cache_roundtrip() -> Result<()> {
        let d = tempfile::tempdir()?;
        let mut s = Store::open(d.path())?;
        assert!(s
            .command(json!({"op":"translate_cache_get","text":"Supply chain update"}))?
            .is_null());
        s.command(json!({"op":"translate_cache_put","text":"Supply chain update","result":"供应链更新","provider":"离线模型"}))?;
        let hit = s.command(json!({"op":"translate_cache_get","text":"Supply chain update"}))?;
        assert_eq!(hit["text"], "供应链更新");
        assert_eq!(hit["provider"], "离线模型");
        Ok(())
    }
}
