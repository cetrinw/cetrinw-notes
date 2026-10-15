import { useState, lazy, Suspense, useRef, useEffect } from "react";
import {
  FileText,
  Plus,
  Search,
  Upload,
  FolderOpen,
  Tag,
} from "lucide-react";
import { useEntries, useDebounce, dateLabel } from "../lib/hooks";
import { get, changed, flushPending } from "../lib/db";
import { createNote } from "../lib/notes";
import { Empty, Busy, ErrorBox } from "../components/ui";
import type { Entry } from "../types";
const NoteEditor = lazy(() => import("../components/Editor"));
export default function Notes({ initialId }: { initialId?: string }) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Entry | null>(null),
    [error, setError] = useState(""),
    [folder, setFolder] = useState("全部笔记"),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState("updated");
  const {
    rows,
    error: loadError,
    loading,
    refresh,
  } = useEntries("note", useDebounce(query), 500);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (initialId) void get(initialId).then(setSelected);
  }, [initialId]);
  async function add() {
    try {
      await flushPending();
      setSelected(await createNote());
    } catch (e) {
      setError(String(e));
    }
  }
  const folders = [...new Set(rows.map((r) => r.data.folder || "收件箱"))];
  const tags = [...new Set(rows.flatMap((r: Entry) => r.data.tags || []))].sort();
  const visible = rows
    .filter(
      (r) =>
        (folder === "全部笔记" || (r.data.folder || "收件箱") === folder) &&
        (!tag || (r.data.tags || []).includes(tag)),
    )
    .sort((a, b) =>
      sort === "title"
        ? String(a.title).localeCompare(String(b.title), "zh-CN")
        : sort === "oldest"
          ? a.updated_at.localeCompare(b.updated_at)
          : b.updated_at.localeCompare(a.updated_at),
    );
  return (
    <div className="notes-layout">
      <aside className="notes-list">
        <div className="panel-title">
          <h2>
            我的笔记 <small>{rows.length}</small>
          </h2>
          <button
            className="icon-button"
            aria-label="新建笔记"
            title="新建笔记"
            onClick={() => void add()}
          >
            <Plus size={20} />
          </button>
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="搜索笔记"
            placeholder="搜索内容、标签…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="folder-filter">
          <FolderOpen size={14} />
          <select
            aria-label="筛选文件夹"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            <option>全部笔记</option>
            {folders.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label="导入笔记"
            title="导入 Markdown"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={15} />
          </button>
        </div>
        <div className="folder-filter">
          <Tag size={14} />
          <select
            aria-label="筛选标签"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="">全部标签</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
          <select
            aria-label="排序方式"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="updated">最近更新</option>
            <option value="oldest">最早更新</option>
            <option value="title">按标题</option>
          </select>
        </div>
        <ErrorBox message={loadError || error} />
        <div className="note-cards">
          {loading ? (
            <Busy />
          ) : (
            visible.map((r) => (
              <button
                key={r.id}
                className={`note-card ${selected?.id === r.id ? "selected" : ""}`}
                onClick={async () => {
                  try {
                    await flushPending();
                    setSelected(await get(r.id));
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                <div>
                  <FileText size={15} />
                  <b>{r.title || "未命名笔记"}</b>
                  {r.conflict_of && <span className="badge amber">冲突</span>}
                </div>
                <p>{plainPreview(r)}</p>
                <footer>
                  <span>{dateLabel(r.updated_at)}</span>
                  <span>
                    {(r.data.tags || [])
                      .slice(0, 2)
                      .map((t: string) => `#${t}`)
                      .join(" ")}
                  </span>
                </footer>
              </button>
            ))
          )}
        </div>
        <button className="list-new" onClick={() => void add()}>
          <Plus size={16} />
          新建笔记
        </button>
        <input
          hidden
          type="file"
          accept=".md,.markdown,.txt"
          ref={fileRef}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f)
              setSelected(
                await createNote(
                  f.name.replace(/\.(md|markdown|txt)$/, ""),
                  await f.text(),
                ),
              );
            e.target.value = "";
          }}
        />
      </aside>
      <main className="note-main">
        {selected ? (
          <Suspense fallback={<Busy text="正在打开编辑器" />}>
            <NoteEditor
              key={selected.id}
              record={selected}
              onSaved={(r) =>
                setSelected((previous) =>
                  previous?.id === selected.id ? r : previous,
                )
              }
              onDeleted={() => {
                setSelected(null);
                changed("note");
                void refresh();
              }}
            />
          </Suspense>
        ) : (
          <Empty
            icon={<FileText size={30} />}
            title="给想法一个落脚的地方"
            description="写一篇笔记，收集一份报告，或把散落的线索连接起来。所有内容都保存在本地。"
            action={
              <button className="primary" onClick={() => void add()}>
                <Plus size={17} />
                写下第一篇笔记
              </button>
            }
          />
        )}
      </main>
    </div>
  );
}
function plainPreview(r: Entry) {
  if (r.data.markdown)
    return String(r.data.markdown)
      .replace(/[#*`>]/g, "")
      .slice(0, 90);
  const out: string[] = [];
  function walk(n: any) {
    if (n?.text) out.push(n.text);
    if (Array.isArray(n?.content)) n.content.forEach(walk);
  }
  walk(r.data.content);
  return out.join(" ").slice(0, 90) || "还没有正文，开始写下你的想法…";
}
