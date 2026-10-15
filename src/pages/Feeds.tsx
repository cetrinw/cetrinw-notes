import { useRef, useState } from "react";
import {
  Rss,
  Plus,
  Search,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  Check,
} from "lucide-react";
import { useDebounce, useEntries } from "../lib/hooks";
import {
  save,
  remove,
  learningCommand,
  download,
  get,
  command,
  changed,
} from "../lib/db";
import { feedDirectory, refreshFeed } from "../lib/rss";
import { NewsArticle } from "./News";
import { Modal, Field, ErrorBox, Empty } from "../components/ui";
import type { Entry } from "../types";

export default function Feeds() {
  const feeds = useEntries("feed", "", 200);
  const [source, setSource] = useState(""),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [adding, setAdding] = useState(false),
    [managing, setManaging] = useState<Entry | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [limit, setLimit] = useState(300);
  const articles = useEntries("article", useDebounce(query), limit),
    file = useRef<HTMLInputElement>(null);
  const rows = articles.rows
    .filter(
      (r) =>
        r.data.rss &&
        (!source || r.data.sourceId === source) &&
        (filter !== "unread" || !r.data.read) &&
        (filter !== "starred" || r.data.bookmarked),
    )
    .sort((a, b) =>
      String(b.data.publishedAt || b.updated_at).localeCompare(
        String(a.data.publishedAt || a.updated_at),
      ),
    );
  const active = rows.find((r) => r.id === selected) || rows[0];
  async function subscribe(title: string, url: string, folder = "收件箱") {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("请输入 HTTPS 订阅地址");
    const existing = feeds.rows.find((f) => f.data.url === url);
    if (existing) {
      setSource(existing.id);
      return;
    }
    const feed = await save({
      kind: "feed",
      title: title || parsed.hostname,
      data: { url, folder, enabled: true, intervalMinutes: 60 },
    });
    setSource(feed.id);
    await refreshFeed(feed);
  }
  async function refreshAll() {
    setBusy(true);
    setError("");
    let failures: string[] = [];
    for (const f of feeds.rows.filter((f) => !source || f.id === source)) {
      try {
        await refreshFeed(f);
      } catch (e) {
        failures.push(`${f.title}：${String(e)}`);
      }
    }
    setError(failures.join("；"));
    setBusy(false);
  }
  const xml = (s: string) =>
    s.replace(
      /[<>&"']/g,
      (c) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );
  return (
    <div className="page feeds-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR KNOWLEDGE INBOX</div>
          <h1>
            让值得读的内容，自己来找你<span className="title-dot">.</span>
          </h1>
          <p>订阅、阅读、收藏，再把证据与想法整理进笔记。</p>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          <Plus size={16} />
          添加订阅
        </button>
      </div>
      <ErrorBox message={error || feeds.error || articles.error} />
      <div className="feed-actions">
        <div className="search-field">
          <Search size={16} />
          <input
            placeholder="搜索已收藏文章…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="文章状态"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部文章</option>
          <option value="unread">未读</option>
          <option value="starred">已收藏</option>
        </select>
        <button
          className="soft-button"
          disabled={busy}
          onClick={() => void refreshAll()}
        >
          <RefreshCw size={15} />
          {busy ? "更新中…" : "刷新订阅"}
        </button>
        <button
          className="soft-button"
          disabled={busy || !rows.some((r) => !r.data.read)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              for (const r of rows.filter((r) => !r.data.read)) {
                // Re-read so a stale revision cannot produce a conflict copy.
                const latest = await get(r.id);
                if (latest && !latest.deleted)
                  await command({
                    op: "save",
                    record: { ...latest, data: { ...latest.data, read: true } },
                  });
              }
              changed("article");
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check size={14} />
          全部标为已读
        </button>
        <button className="soft-button" onClick={() => file.current?.click()}>
          <Upload size={14} />
          导入 OPML
        </button>
        <button
          className="soft-button"
          onClick={async () => {
            try {
              await download(
                "Cetrinw-subscriptions.opml",
                `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>Cetrinw subscriptions</title></head><body>${[
                  ...new Set(feeds.rows.map((f) => f.data.folder || "收件箱")),
                ]
                  .map(
                    (folder) =>
                      `<outline text="${xml(folder)}">${feeds.rows
                        .filter((f) => (f.data.folder || "收件箱") === folder)
                        .map(
                          (f) =>
                            `<outline type="rss" text="${xml(f.title)}" title="${xml(f.title)}" xmlUrl="${xml(f.data.url)}"/>`,
                        )
                        .join("")}</outline>`,
                  )
                  .join("")}</body></opml>`,
                "application/xml",
              );
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <Download size={14} />
          导出 OPML
        </button>
      </div>
      <div className="feed-layout">
        <aside className="feed-sidebar surface">
          <button
            className={!source ? "selected" : ""}
            onClick={() => setSource("")}
          >
            <Rss size={16} />
            全部订阅 <small>{feeds.rows.length}</small>
          </button>
          {[...new Set(feeds.rows.map((f) => f.data.folder || "收件箱"))].map(
            (folder) => (
              <div key={folder}>
                <h4>{folder}</h4>
                {feeds.rows
                  .filter((f) => (f.data.folder || "收件箱") === folder)
                  .map((f) => (
                    <div className="feed-source" key={f.id}>
                      <button
                        className={source === f.id ? "selected" : ""}
                        onClick={() => setSource(f.id)}
                      >
                        <span
                          className={
                            f.data.status === "failed" ? "dot amber" : "dot"
                          }
                        />
                        {f.title}
                      </button>
                      <button
                        aria-label={`管理${f.title}`}
                        onClick={() => setManaging(f)}
                      >
                        ···
                      </button>
                      {f.data.status === "failed" && (
                        <small className="feed-error">{f.data.error}</small>
                      )}
                    </div>
                  ))}
              </div>
            ),
          )}
          <p className="muted small">
            应用打开时按订阅间隔检查。暂停订阅保留已读内容。RSS 可能只提供摘要。
          </p>
        </aside>
        <section>
          {active ? (
            <div className="news-layout">
              <aside className="news-list">
                {rows.map((r) => (
                  <button
                    key={r.id}
                    className={r.id === active.id ? "selected" : ""}
                    onClick={() => setSelected(r.id)}
                  >
                    <span>
                      {r.data.provider} · {r.data.read ? "已读" : "未读"}
                    </span>
                    <b>{r.title}</b>
                    <small>
                      {r.data.publishedAt
                        ? new Date(r.data.publishedAt).toLocaleDateString(
                            "zh-CN",
                          )
                        : "来源未提供日期"}
                      {r.data.bookmarked ? " · 已收藏" : ""}
                    </small>
                  </button>
                ))}
                {rows.length >= limit && (
                  <button
                    className="text-button"
                    onClick={() => setLimit(limit + 300)}
                  >
                    加载更多文章
                  </button>
                )}
              </aside>
              <NewsArticle
                article={active}
                key={active.id}
                onNavigate={(delta) => {
                  const index = rows.findIndex((r) => r.id === active.id);
                  const next = rows[index + delta];
                  if (next) setSelected(next.id);
                }}
              />
            </div>
          ) : (
            <Empty
              icon={<Rss />}
              title="从你感兴趣的来源开始"
              description="从推荐源库订阅，或输入网站地址发现 RSS。文章可以查词、做中文对照、收藏和保存成笔记。"
              action={
                <button className="primary" onClick={() => setAdding(true)}>
                  浏览推荐来源
                </button>
              }
            />
          )}
        </section>
      </div>
      <input
        hidden
        ref={file}
        type="file"
        accept=".opml,.xml"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          setError("");
          try {
            const doc = new DOMParser().parseFromString(
              await f.text(),
              "application/xml",
            );
            if (doc.querySelector("parsererror"))
              throw new Error("OPML 文件格式有误");
            let errors: string[] = [];
            const seen = new Set(feeds.rows.map((f) => f.data.url));
            for (const node of Array.from(
              doc.querySelectorAll("outline[xmlUrl]"),
            )) {
              const url = node.getAttribute("xmlUrl")!;
              if (seen.has(url)) continue;
              seen.add(url);
              try {
                await subscribe(
                  node.getAttribute("title") ||
                    node.getAttribute("text") ||
                    url,
                  url,
                  node.parentElement?.getAttribute("text") || "收件箱",
                );
              } catch (err) {
                errors.push(`${url}：${String(err)}`);
              }
            }
            setError(errors.join("；"));
          } catch (err) {
            setError(String(err));
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
      {adding && (
        <AddFeed onClose={() => setAdding(false)} onSubscribe={subscribe} />
      )}
      {managing && (
        <Modal
          title={`管理订阅 · ${managing.title}`}
          onClose={() => setManaging(null)}
        >
          <Field label="名称">
            <input
              value={managing.title}
              onChange={(e) =>
                setManaging({ ...managing, title: e.target.value })
              }
            />
          </Field>
          <Field label="分类">
            <input
              value={managing.data.folder || ""}
              onChange={(e) =>
                setManaging({
                  ...managing,
                  data: { ...managing.data, folder: e.target.value },
                })
              }
            />
          </Field>
          <Field label="检查间隔">
            <select
              value={managing.data.intervalMinutes}
              onChange={(e) =>
                setManaging({
                  ...managing,
                  data: {
                    ...managing.data,
                    intervalMinutes: Number(e.target.value),
                  },
                })
              }
            >
              {[15, 30, 60, 360, 1440].map((n) => (
                <option key={n} value={n}>
                  {n < 60 ? `${n} 分钟` : `${n / 60} 小时`}
                </option>
              ))}
            </select>
          </Field>
          <label className="inline">
            <input
              type="checkbox"
              checked={managing.data.enabled !== false}
              onChange={(e) =>
                setManaging({
                  ...managing,
                  data: { ...managing.data, enabled: e.target.checked },
                })
              }
            />
            自动更新
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={managing.data.autoFullText !== false}
              onChange={(e) =>
                setManaging({
                  ...managing,
                  data: { ...managing.data, autoFullText: e.target.checked },
                })
              }
            />
            自动抓取摘要文章的正文全文
          </label>
          <p className="muted small">
            最近成功：
            {managing.data.lastSuccess
              ? new Date(managing.data.lastSuccess).toLocaleString("zh-CN")
              : "尚未成功"}
          </p>
          <div className="modal-actions">
            <button
              className="text-button danger"
              onClick={async () => {
                await remove(managing.id);
                setManaging(null);
                setSource("");
              }}
            >
              <Trash2 size={14} />
              取消订阅
            </button>
            <button
              className="primary"
              onClick={async () => {
                try {
                  await save(managing);
                  setManaging(null);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              保存
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AddFeed({
  onClose,
  onSubscribe,
}: {
  onClose: () => void;
  onSubscribe: (title: string, url: string, folder?: string) => Promise<void>;
}) {
  const [query, setQuery] = useState(""),
    [url, setUrl] = useState(""),
    [found, setFound] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [category, setCategory] = useState("");
  const add = async (title: string, url: string, category?: string) => {
    setBusy(true);
    setError("");
    try {
      await onSubscribe(title, url, category);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="发现与添加 RSS" wide onClose={onClose}>
      <Field
        label="输入网站或 RSS 地址"
        hint="从网页声明的 RSS / Atom 中发现来源；不需要你手工查看网页代码。"
      >
        <div className="inline">
          <input
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || !url}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setFound(await learningCommand({ op: "rss_discover", url }));
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            发现订阅
          </button>
        </div>
      </Field>
      <ErrorBox message={error} />
      {found.map((f) => (
        <div className="source-discovery" key={f.url}>
          <span>
            {f.title}
            <small>{f.url}</small>
          </span>
          <button
            className="soft-button"
            disabled={busy}
            onClick={() => void add(f.title, f.url)}
          >
            订阅
          </button>
        </div>
      ))}
      <h3>推荐公开源库</h3>
      <div className="inline wrap">
        <input
          aria-label="搜索推荐 RSS"
          placeholder="搜索科技、商业、英文、效率…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="按分类筛选"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">全部分类</option>
          {[...new Set(feedDirectory.map((f) => f.category))].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="resource-grid">
        {feedDirectory
          .filter(
            (f) =>
              (!category || f.category === category) &&
              `${f.title} ${f.category} ${f.description}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .map((f) => (
            <article className="resource-card surface" key={f.url}>
              <span className="badge">{f.category}</span>
              <h3>{f.title}</h3>
              <p>{f.description}</p>
              <button
                className="soft-button"
                disabled={busy}
                onClick={() => void add(f.title, f.url, f.category)}
              >
                {busy ? "处理中…" : "订阅并获取文章"}
              </button>
            </article>
          ))}
      </div>
      <p className="muted small">
        源库搜索覆盖当前整理的公开来源；网站发现支持任意公开 HTTPS
        网站声明的订阅。不是全网搜索引擎，来源可用性以实际刷新结果为准。
      </p>
    </Modal>
  );
}
