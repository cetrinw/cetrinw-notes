import { lazy, Suspense, useEffect, useState } from "react";
import {
  Sun,
  FileText,
  GitBranch,
  Headphones,
  Settings,
  Search,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUpRight,
  Command,
  Leaf,
  Rss,
  HelpCircle,
} from "lucide-react";
import Today from "./pages/Today";
import { createNote } from "./lib/notes";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  command,
  native,
  synchronize,
  setting,
  flushPending,
  anyDirty,
} from "./lib/db";
import { useDebounce, dateLabel } from "./lib/hooks";
import { Modal, Busy, ErrorBox } from "./components/ui";
import { kindNames, type Kind, type Screen, type Entry } from "./types";
import { startFeedScheduler } from "./lib/rss";
import { startCloudBackupScheduler } from "./lib/cloud";
const Notes = lazy(() => import("./pages/Notes")),
  Research = lazy(() => import("./pages/Research")),
  English = lazy(() => import("./pages/English")),
  Feeds = lazy(() => import("./pages/Feeds")),
  Preferences = lazy(() => import("./pages/Settings"));
type SearchHit = {
  record: Entry;
  snippet?: string | null;
  titleMatch?: boolean;
};
const navigation: [Screen, string, React.ReactNode][] = [
  ["today", "今天", <Sun size={19} />],
  ["notes", "我的笔记", <FileText size={19} />],
  ["research", "研究工作台", <GitBranch size={19} />],
  ["english", "英语学习", <Headphones size={19} />],
  ["feeds", "订阅收件箱", <Rss size={19} />],
];
export default function App() {
  const [screen, setScreen] = useState<Screen>("today"),
    [noteId, setNoteId] = useState<string>(),
    [collapsed, setCollapsed] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<SearchHit[]>([]),
    [kindFilter, setKindFilter] = useState(""),
    [timeFilter, setTimeFilter] = useState("all"),
    [expandedKind, setExpandedKind] = useState(""),
    [recent, setRecent] = useState<string[]>([]),
    [syncStatus, setSyncStatus] = useState("LOCAL FIRST"),
    [error, setError] = useState(""),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [cursor, setCursor] = useState(0);
  const q = useDebounce(query);
  useEffect(() => startFeedScheduler(), []);
  useEffect(() => startCloudBackupScheduler(), []);
  useEffect(() => {
    if (!native) return;
    let closing = false,
      disposed = false;
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();
      try {
        await flushPending();
        closing = true;
        await getCurrentWindow().close();
      } catch (e) {
        closing = false;
        setError(`内容尚未保存，窗口已保留：${String(e)}`);
      }
    });
    const quitListener = listen("cetrinw-before-quit", async () => {
      try {
        await flushPending();
        await invoke("finish_quit");
      } catch (e) {
        setError(`内容尚未保存，应用已保留：${String(e)}`);
      }
    });
    void unlisten.then((f) => {
      if (disposed) f();
    });
    return () => {
      disposed = true;
      void unlisten.then((f) => f());
      void quitListener.then((f) => f());
    };
  }, []);
  const openNote = async (id: string) => {
    try {
      await flushPending();
      setNoteId(id);
      setScreen("notes");
      setSearchOpen(false);
    } catch (e) {
      setError(String(e));
    }
  };
  const newNote = async () => {
    try {
      openNote((await createNote()).id);
    } catch (e) {
      setError(String(e));
    }
  };
  const openResult = (r: Entry) => {
    rememberSearch(q);
    if (r.kind === "note") void openNote(r.id);
    else {
      setScreen(
        ["article", "feed"].includes(r.kind)
          ? "feeds"
          : ["lesson", "word", "session", "review"].includes(r.kind)
            ? "english"
            : "research",
      );
      setSearchOpen(false);
    }
  };
  useEffect(() => {
    const external = (e: MouseEvent) => {
      const link = (e.target as Element).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (native && link && /^https?:\/\//.test(link.href)) {
        e.preventDefault();
        void openUrl(link.href).catch((err) => setError(String(err)));
      }
    };
    document.addEventListener("click", external);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const sync = async () => {
      try {
        if (await setting("server_url")) {
          setSyncStatus("正在同步");
          await synchronize();
          setSyncStatus("同步完成");
        }
      } catch (e) {
        setSyncStatus("同步未完成");
        void command({
          op: "setting_set",
          key: "sync_error",
          value: String(e),
        });
      }
    };
    const afterEdit = (e: Event) => {
      if ((e as CustomEvent).detail) {
        clearTimeout(timeout);
        timeout = setTimeout(() => void sync(), 2500);
      }
    };
    window.addEventListener("cetrinw-change", afterEdit);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("click", external);
      window.removeEventListener("cetrinw-change", afterEdit);
      window.removeEventListener("focus", sync);
      clearTimeout(timeout);
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      void command({ op: "stats" })
        .then((s) => {
          setCounts(s.counts);
          setError("");
        })
        .catch((e) => setError(`无法连接本地数据库：${String(e)}`));
    };
    refresh();
    window.addEventListener("cetrinw-change", refresh);
    const open = (e: Event) => openNote((e as CustomEvent).detail);
    window.addEventListener("cetrinw-open-note", open);
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        void newNote();
      }
      if (e.key === "Escape") setSearchOpen(false);
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest?.(
        "input, textarea, select, [contenteditable='true']",
      );
      if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("cetrinw-change", refresh);
      window.removeEventListener("cetrinw-open-note", open);
      window.removeEventListener("keydown", keys);
    };
  }, []);
  useEffect(() => {
    if (native) return;
    // Browser preview has no window close interception; warn before leaving
    // with unsaved editor content.
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  useEffect(() => {
    void setting<string[]>("recent_searches").then((v) => setRecent(v || []));
  }, []);
  useEffect(() => {
    let active = true;
    setKindFilter("");
    setExpandedKind("");
    if (q)
      void command<{ records: SearchHit[]; total: number }>({
        op: "search",
        query: q,
        limit: 200,
      })
        .then((r) => {
          if (active) {
            setResults(r.records);
            setCursor(0);
          }
        })
        .catch((e) => setError(String(e)));
    else setResults([]);
    return () => {
      active = false;
    };
  }, [q]);
  const rememberSearch = (value: string) => {
    const next = [value, ...recent.filter((x) => x !== value)].slice(0, 8);
    setRecent(next);
    void command({ op: "setting_set", key: "recent_searches", value: next });
  };
  const since = (days: number) =>
    new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const visible = results.filter(
    (hit) =>
      (!kindFilter || hit.record.kind === kindFilter) &&
      (timeFilter === "all" ||
        (hit.record.updated_at || "") >= since(Number(timeFilter))),
  );
  const grouped = visible.reduce<Record<string, SearchHit[]>>((acc, hit) => {
    (acc[hit.record.kind] ||= []).push(hit);
    return acc;
  }, {});
  const hitIndex = new Map(visible.map((hit, i) => [hit.record.id, i]));
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="app-sidebar">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <span>
            Cetrinw<small>知识与日常</small>
          </span>
        </div>
        <button className="global-search" onClick={() => setSearchOpen(true)}>
          <Search size={17} />
          <span>搜索你的知识</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="workspace-label">
          个人空间 <span>PERSONAL</span>
        </div>
        <nav>
          {navigation.map(([key, label, icon]) => (
            <button
              className={screen === key ? "active" : ""}
              key={key}
              onClick={async () => {
                try {
                  await flushPending();
                  setScreen(key);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {icon}
              <span>{label}</span>
              {key === "notes" && !!counts.note && <small>{counts.note}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Leaf size={20} />
          <p>
            把零散的灵感，
            <br />
            变成自己的理解。
          </p>
          <span>KEEP EXPLORING</span>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => void newNote()}>
            <Plus size={17} />
            <span>新建笔记</span>
            <kbd>⌘ N</kbd>
          </button>
          <button
            className={screen === "settings" ? "active" : ""}
            onClick={() => setScreen("settings")}
          >
            <Settings size={18} />
            <span>设置与数据</span>
          </button>
          <button onClick={() => setHelpOpen(true)}>
            <HelpCircle size={18} />
            <span>键盘快捷键</span>
            <kbd>?</kbd>
          </button>
          <div className="personal-profile">
            <span className="avatar">我</span>
            <div>
              <b>我的个人空间</b>
              <small>
                <span className="dot" />
                本地 SQLite 存储
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="app-content">
        <header className="app-topbar">
          <div className="inline">
            <button
              className="icon-button"
              aria-label="切换侧栏"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
            <span className="topbar-path">
              个人空间 <span>/</span>{" "}
              {screen === "settings"
                ? "设置与数据"
                : navigation.find((n) => n[0] === screen)?.[1]}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="dot" />
              {syncStatus}
            </span>
            <button
              className="icon-button"
              aria-label="全局搜索"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={18} />
            </button>
          </div>
        </header>
        <ErrorBox message={error} />
        <div className="screen">
          <Suspense
            fallback={
              <div className="page">
                <Busy text="正在打开工作空间" />
              </div>
            }
          >
            {screen === "today" ? (
              <Today
                navigate={setScreen}
                newNote={() => void newNote()}
                openNote={openNote}
              />
            ) : screen === "notes" ? (
              <Notes initialId={noteId} />
            ) : screen === "research" ? (
              <Research onNote={openNote} />
            ) : screen === "english" ? (
              <English />
            ) : screen === "feeds" ? (
              <Feeds />
            ) : (
              <Preferences />
            )}
          </Suspense>
        </div>
      </div>
      {searchOpen && (
        <Modal title="搜索你的知识" onClose={() => setSearchOpen(false)}>
          <div className="search-field large">
            <Search size={20} />
            <input
              autoFocus
              placeholder="标题、正文、公司代码、单词…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(visible.length - 1, c + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (e.key === "Enter" && visible[cursor]) {
                  e.preventDefault();
                  openResult(visible[cursor].record);
                }
              }}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="search-results">
            {q && visible.length > 0 && (
              <div className="search-filters">
                <button
                  className={!kindFilter ? "active" : ""}
                  onClick={() => setKindFilter("")}
                >
                  全部 {visible.length}
                </button>
                {Object.keys(grouped).map((kind) => (
                  <button
                    key={kind}
                    className={kindFilter === kind ? "active" : ""}
                    onClick={() => setKindFilter(kind)}
                  >
                    {kindNames[kind as Kind]} {grouped[kind].length}
                  </button>
                ))}
                <select
                  aria-label="时间范围"
                  value={timeFilter}
                  onChange={(e) => setTimeFilter(e.target.value)}
                >
                  <option value="all">全部时间</option>
                  <option value="7">近 7 天</option>
                  <option value="30">近 30 天</option>
                </select>
              </div>
            )}
            {Object.entries(grouped).map(([kind, hits]) => (
              <div className="search-group" key={kind}>
                <div className="search-group-head">
                  <span className="badge">{kindNames[kind as Kind]}</span>
                  <small>{hits.length} 条</small>
                </div>
                {(expandedKind === kind ? hits : hits.slice(0, 5)).map((hit) => (
                  <button
                    key={hit.record.id}
                    className={
                      hitIndex.get(hit.record.id) === cursor ? "active" : ""
                    }
                    onMouseEnter={() =>
                      setCursor(hitIndex.get(hit.record.id) ?? 0)
                    }
                    onClick={() => openResult(hit.record)}
                  >
                    <div className="search-hit">
                      <b>
                        <Highlight
                          text={hit.record.title || "未命名"}
                          query={q}
                        />
                      </b>
                      {hit.snippet && (
                        <span className="search-snippet">
                          <Highlight text={hit.snippet} query={q} />
                        </span>
                      )}
                    </div>
                    <small>{dateLabel(hit.record.updated_at)}</small>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
                {expandedKind !== kind && hits.length > 5 && (
                  <button
                    className="text-button search-more"
                    onClick={() => setExpandedKind(kind)}
                  >
                    查看全部 {hits.length} 条
                  </button>
                )}
              </div>
            ))}
            {q && visible.length === 0 && (
              <p className="quiet-empty">
                没有找到匹配内容，试试更短的关键词。
              </p>
            )}
            {!q && recent.length > 0 && (
              <div className="search-recent">
                <small>最近搜索</small>
                {recent.map((r) => (
                  <button key={r} onClick={() => setQuery(r)}>
                    {r}
                  </button>
                ))}
              </div>
            )}
            {!q && (
              <p className="quiet-empty">搜索只在你的本地资料库中进行。</p>
            )}
          </div>
        </Modal>
      )}
      {helpOpen && (
        <Modal title="键盘快捷键" onClose={() => setHelpOpen(false)}>
          <div className="shortcut-list">
            {[
              ["⌘ K", "全局搜索"],
              ["⌘ N", "新建笔记"],
              ["⌘ S", "在编辑器中立即保存"],
              ["↑ ↓ Enter", "在搜索结果中移动与打开"],
              ["Esc", "关闭当前对话框"],
              ["?", "打开这份快捷键说明"],
            ].map(([key, label]) => (
              <div key={key}>
                <kbd>{key}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2 || /[㐀-鿿]/.test(t))
    .map(escapeRegExp);
  if (!tokens.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${tokens.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  );
}
