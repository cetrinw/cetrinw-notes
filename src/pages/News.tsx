import { useEffect, useRef, useState } from "react";
import {
  Newspaper,
  RefreshCw,
  ExternalLink,
  Bookmark,
  Check,
  Languages,
  FileText,
  Volume2,
} from "lucide-react";
import { useEntries } from "../lib/hooks";
import {
  learningCommand,
  setting,
  setSetting,
  save,
  get,
  registerFlush,
  registerDirty,
  changed,
} from "../lib/db";
import { translateText } from "../lib/translation";
import { useSpeechQueue } from "../lib/tts";
import { fetchFullTexts } from "../lib/rss";
import { WordLookup } from "./English";
import { Busy, Empty, ErrorBox } from "../components/ui";
import type { Entry } from "../types";

export default function News() {
  const { rows, error: loadError } = useEntries("article", "", 500);
  const [sources, setSources] = useState<any[]>([]),
    [source, setSource] = useState("nasa"),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [checked, setChecked] = useState("");
  const today = new Date().toLocaleDateString("en-CA");
  const filtered = rows
    .filter((r) => r.data.sourceId === source)
    .sort((a, b) =>
      String(b.data.publishedAt || "").localeCompare(
        String(a.data.publishedAt || ""),
      ),
    );
  const article = filtered.find((r) => r.id === selected) || filtered[0];
  const inflight = useRef(new Set<string>());
  async function refresh(id: string) {
    // Switching sources must not stack a second refresh on the same source.
    if (inflight.current.has(id)) return;
    inflight.current.add(id);
    setBusy(true);
    setError("");
    try {
      const saved = await learningCommand({ op: "news_refresh", id });
      await fetchFullTexts((saved as any[]) || [], 5);
      changed("article");
      const time = new Date().toISOString();
      await setSetting(`news_checked:${id}`, time);
      setChecked(time);
    } catch (e) {
      setError(`新闻更新未完成：${String(e)}。已有离线内容仍可阅读。`);
    } finally {
      inflight.current.delete(id);
      setBusy(false);
    }
  }
  useEffect(() => {
    void learningCommand({ op: "news_sources" })
      .then(setSources)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    setSelected("");
    void setting<string>(`news_checked:${source}`)
      .then((last) => {
        setChecked(last || "");
        if (!last || new Date(last).toLocaleDateString("en-CA") !== today)
          void refresh(source);
      })
      .catch((e) => setError(String(e)));
  }, [source]);
  const newest = filtered[0]?.data.publishedAt;
  const old = newest && Date.now() - new Date(newest).getTime() > 7 * 86400000;
  return (
    <section className="news-page">
      <div className="section-heading">
        <div>
          <h2>每天读一点，连接真实世界</h2>
          <p className="muted">
            科技、全球新闻与慢速英语。点词查询，保存中文对照，离线继续阅读。
          </p>
        </div>
        <button
          className="soft-button"
          disabled={busy}
          onClick={() => void refresh(source)}
        >
          <RefreshCw size={15} />
          {busy ? "正在更新…" : "更新新闻"}
        </button>
      </div>
      <div className="news-source-bar">
        <select
          aria-label="新闻来源"
          disabled={busy}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="muted small">
          {checked
            ? `最近获取：${new Date(checked).toLocaleString("zh-CN")}`
            : "尚未成功获取"}{" "}
          · 每天打开此页时检查更新
        </span>
      </div>
      <ErrorBox message={error || loadError} />
      {old && (
        <p className="translation-status">
          该来源最新报道发表于 {new Date(newest).toLocaleDateString("zh-CN")}
          ，已较久未更新。以下保留原发布日期。
        </p>
      )}
      {article ? (
        <div className="news-layout">
          <aside className="news-list">
            {filtered.map((r) => (
              <button
                className={r.id === article.id ? "selected" : ""}
                key={r.id}
                onClick={() => setSelected(r.id)}
              >
                <span>
                  {r.data.publishedAt
                    ? new Date(r.data.publishedAt).toLocaleDateString("zh-CN")
                    : "发布日期未提供"}
                  {r.data.read ? " · 已读" : ""}
                </span>
                <b>{r.title}</b>
                <small>
                  {r.data.contentType === "feed-full-text"
                    ? "来源提供全文"
                    : "新闻摘要"}
                  {r.data.bookmarked ? " · 已收藏" : ""}
                </small>
              </button>
            ))}
          </aside>
          <NewsArticle
            key={article.id}
            article={article}
            onNavigate={(delta) => {
              const index = filtered.findIndex((r) => r.id === article.id);
              const next = filtered[index + delta];
              if (next) setSelected(next.id);
            }}
          />
        </div>
      ) : busy ? (
        <Busy text="正在获取来源的实际新闻" />
      ) : (
        <Empty
          icon={<Newspaper />}
          title="还没有新闻"
          description="更新来源后即可阅读。接口不可用时会保留错误原因。"
        />
      )}
    </section>
  );
}

export function NewsArticle({
  article,
  onNavigate,
}: {
  article: Entry;
  onNavigate?: (delta: number) => void;
}) {
  const topics = useEntries("topic");
  const [topicId, setTopicId] = useState(article.data.topicId || "");
  const [body, setBody] = useState(String(article.data.text || ""));
  const [extracting, setExtracting] = useState(false);
  const [readerFont, setReaderFont] = useState(17);
  const [translations, setTranslations] = useState<Record<string, string>>(
      article.data.translations || {},
    ),
    [bilingual, setBilingual] = useState(
      !/[\u3400-\u9fff]/.test(article.title),
    ),
    [word, setWord] = useState(""),
    [sentence, setSentence] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [read, setRead] = useState(!!article.data.read),
    [bookmarked, setBookmarked] = useState(!!article.data.bookmarked);
  const stopped = useRef(false),
    current = useRef(article),
    queue = useRef(Promise.resolve()),
    translationDraft = useRef(translations),
    translationDirty = useRef(false),
    translationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  const paragraphs = [article.title, ...body.split(/\n\s*\n/).filter(Boolean)];
  const speech = useSpeechQueue(paragraphs);
  const paragraphRefs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (!speech.reading || speech.index < 0) return;
    paragraphRefs.current[speech.index]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [speech.index, speech.reading]);
  const progressRef = useRef(0);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    void setting<number>("reader_font").then((v) => {
      if (v) setReaderFont(v);
    });
  }, []);
  useEffect(() => {
    const pos = Number(article.data.readingPos || 0);
    if (pos > 0) {
      const timer = setTimeout(() => {
        paragraphRefs.current[pos]?.scrollIntoView({ block: "start" });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [article.id]);
  useEffect(() => {
    const onScroll = () => {
      let last = 0;
      paragraphRefs.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.5)
          last = i;
      });
      if (last !== progressRef.current) {
        progressRef.current = last;
        clearTimeout(progressTimer.current);
        progressTimer.current = setTimeout(() => {
          void patch({ readingPos: progressRef.current }).catch(() => {});
          if (progressRef.current >= paragraphs.length - 1) {
            setRead(true);
            void patch({ read: true }).catch(() => {});
          }
        }, 600);
      }
    };
    window.addEventListener("scroll", onScroll, { capture: true });
    return () =>
      window.removeEventListener("scroll", onScroll, { capture: true });
  }, []);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.("input, textarea, select, [contenteditable='true']")
      )
        return;
      if (e.key === "j") onNavigate?.(1);
      else if (e.key === "k") onNavigate?.(-1);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onNavigate]);
  useEffect(() => {
    const flush = async () => {
      stopped.current = true;
      clearTimeout(translationTimer.current);
      await persistTranslations();
      await queue.current;
    };
    const unregister = registerFlush(flush);
    const unregisterDirty = registerDirty(() => translationDirty.current);
    return () => {
      unregister();
      unregisterDirty();
      void flush().catch((e) => console.error("文章译文保存失败", e));
    };
  }, []);
  async function patch(data: any) {
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        const latest = (await get(article.id)) || current.current;
        current.current = await save({
          ...latest,
          data: { ...latest.data, ...data },
        });
      });
    await queue.current;
  }
  async function persistTranslations() {
    if (!translationDirty.current) return;
    const draft = translationDraft.current;
    await patch({ translations: draft });
    if (translationDraft.current === draft) translationDirty.current = false;
  }
  function editTranslation(index: number, value: string) {
    translationDraft.current = { ...translationDraft.current, [index]: value };
    translationDirty.current = true;
    setTranslations(translationDraft.current);
    clearTimeout(translationTimer.current);
    translationTimer.current = setTimeout(() => {
      void persistTranslations().catch((e) => setError(String(e)));
    }, 350);
  }
  async function translateAll() {
    setBusy(true);
    setError("");
    stopped.current = false;
    try {
      for (let i = 0; i < paragraphs.length; i++) {
        if (stopped.current) break;
        if (translationDraft.current[i]) continue;
        setProgress(`正在翻译 ${i + 1}/${paragraphs.length} 段`);
        const translation = await translateText(paragraphs[i]);
        if (stopped.current) break;
        if (!translationDraft.current[i]) editTranslation(i, translation);
        await persistTranslations();
      }
      setProgress(
        stopped.current ? "已暂停，已完成的中文已保存" : "中文对照已保存到本地",
      );
    } catch (e) {
      setError(`翻译未全部完成：${String(e)}。已完成部分已保存。`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="news-article surface"
      style={{ "--reader-font": `${readerFont}px` } as React.CSSProperties}
    >
      <div className="eyebrow">READ THE WORLD</div>
      <div className="news-meta">
        <span>{article.data.provider}</span>
        <span>
          {article.data.publishedAt
            ? new Date(article.data.publishedAt).toLocaleString("zh-CN")
            : "来源未提供发布日期"}
        </span>
        <span className="badge">
          {article.data.contentType === "feed-full-text"
            ? "来源全文"
            : article.data.contentType === "extracted"
              ? "已抓取全文"
              : "摘要 · 可抓取全文"}
        </span>
      </div>
      {!/[\u3400-\u9fff]/.test(article.title) && (
        <>
          <div className="bilingual-toolbar">
            <label>
              <input
                type="checkbox"
                checked={bilingual}
                onChange={(e) => setBilingual(e.target.checked)}
              />
              中英对照
            </label>
            <button
              className="soft-button"
              onClick={() =>
                busy ? (stopped.current = true) : void translateAll()
              }
            >
              <Languages size={14} />
              {busy ? "暂停翻译" : "生成中文对照"}
            </button>
            <button
              className="soft-button"
              onClick={() => (speech.reading ? speech.stop() : speech.start(0))}
            >
              <Volume2 size={14} />
              {speech.reading ? "停止朗读" : "朗读全文"}
            </button>
            <button
              className="soft-button"
              aria-label="减小字号"
              onClick={() => {
                const next = Math.max(14, readerFont - 1);
                setReaderFont(next);
                void setSetting("reader_font", next);
              }}
            >
              A-
            </button>
            <button
              className="soft-button"
              aria-label="增大字号"
              onClick={() => {
                const next = Math.min(24, readerFont + 1);
                setReaderFont(next);
                void setSetting("reader_font", next);
              }}
            >
              A+
            </button>
          </div>
          <p className="muted small">
            优先使用本地离线模型，未就绪时使用 MyMemory
            公共接口；重复句子走缓存。译文用于学习，可手工校订。
          </p>
        </>
      )}
      <ErrorBox message={error} />
      {progress && (
        <p role="status" className="translation-status">
          {progress}
        </p>
      )}
      {paragraphs.map((p, i) => (
        <section
          ref={(el) => {
            paragraphRefs.current[i] = el;
          }}
          className={`${i === 0 ? "news-title-paragraph" : "news-paragraph"} ${speech.index === i && speech.reading ? "reading" : ""}`}
          key={i}
        >
          <p>
            {p.split(/([a-zA-Z]+(?:['’-][a-zA-Z]+)*)/).map((part, j) =>
              /[a-zA-Z]/.test(part) ? (
                <button
                  className="word"
                  key={j}
                  onClick={() => {
                    setWord(part.toLowerCase());
                    setSentence(p);
                  }}
                >
                  {part}
                </button>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
          </p>
          {bilingual && (
            <textarea
              className="sentence-translation"
              aria-label={`新闻第${i + 1}段中文`}
              rows={i === 0 ? 2 : 3}
              value={translations[i] || ""}
              placeholder="中文对照 · 可生成或自己填写"
              onChange={(e) => editTranslation(i, e.target.value)}
              onBlur={() =>
                void persistTranslations().catch((e) => setError(String(e)))
              }
            />
          )}
        </section>
      ))}
      <footer className="news-actions">
        {article.data.contentType !== "feed-full-text" &&
          article.data.contentType !== "extracted" && (
            <button
              className="soft-button"
              disabled={extracting}
              onClick={async () => {
                setExtracting(true);
                setError("");
                try {
                  const result = await learningCommand({
                    op: "article_extract",
                    url: article.data.sourceUrl,
                  });
                  setBody(result.text);
                  await patch({
                    text: result.text,
                    contentType: "extracted",
                    extractedAt: new Date().toISOString(),
                  });
                } catch (e) {
                  setError(String(e));
                } finally {
                  setExtracting(false);
                }
              }}
            >
              <FileText size={14} />
              {extracting ? "正在抓取…" : "抓取全文"}
            </button>
          )}
        <select
          aria-label="关联研究专题"
          value={topicId}
          onChange={(e) => setTopicId(e.target.value)}
        >
          <option value="">不关联专题</option>
          {topics.rows.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <button
          className="primary"
          onClick={async () => {
            try {
              const existing = current.current.data.noteId;
              if (existing && (await get(existing))) {
                window.dispatchEvent(
                  new CustomEvent("cetrinw-open-note", { detail: existing }),
                );
                return;
              }
              const note = await save({
                kind: "note",
                title: article.title,
                data: {
                  folder: "订阅收藏",
                  tags: [article.data.provider],
                  topicId,
                  sourceUrl: article.data.sourceUrl,
                  articleId: article.id,
                  attachments: [],
                  markdown: `# ${article.title}\n\n来源：[${article.data.provider}](${article.data.sourceUrl})\n\n发布日期：${article.data.publishedAt || "来源未提供"}\n\n${article.data.text || ""}\n\n${Object.keys(translations).length ? `## 中文对照\n\n${Object.values(translations).join("\n\n")}` : ""}\n\n## 我的分析\n\n`,
                },
              });
              await patch({ noteId: note.id, topicId });
              window.dispatchEvent(
                new CustomEvent("cetrinw-open-note", { detail: note.id }),
              );
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          保存到笔记
        </button>
        <a href={article.data.sourceUrl} target="_blank" rel="noreferrer">
          阅读来源原文 <ExternalLink size={14} />
        </a>
        <button
          className="soft-button"
          onClick={async () => {
            try {
              await patch({ bookmarked: !bookmarked });
              setBookmarked(!bookmarked);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <Bookmark size={14} />
          {bookmarked ? "已收藏" : "收藏"}
        </button>
        <button
          className="soft-button"
          onClick={async () => {
            try {
              await patch({ read: !read });
              setRead(!read);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <Check size={14} />
          {read ? "已读" : "标记已读"}
        </button>
      </footer>
      {word && (
        <WordLookup
          word={word}
          sentence={sentence}
          onClose={() => setWord("")}
        />
      )}
    </article>
  );
}
