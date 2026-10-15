import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  EditorContent,
  useEditor,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import UniqueID from "@tiptap/extension-unique-id";
import { Mathematics } from "@tiptap/extension-mathematics";
import {
  Details,
  DetailsContent,
  DetailsSummary,
} from "@tiptap/extension-details";
import { Markdown } from "@tiptap/markdown";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Table2,
  ImagePlus,
  Link2,
  Undo2,
  Redo2,
  Paperclip,
  Download,
  History,
  Hash,
  Sigma,
  ChevronDown,
  FileText,
  ExternalLink,
  Trash2,
  Check,
  Link,
  Strikethrough,
  Code,
} from "lucide-react";
import {
  save,
  command,
  upload,
  assetUrl,
  markdownBundle,
  registerFlush,
  registerDirty,
  get,
  list,
} from "../lib/db";
import { useLinks, dateLabel } from "../lib/hooks";
import { Modal, ErrorBox, Busy, ConfirmModal, PromptModal } from "./ui";
import type { Asset, Entry } from "../types";
import "katex/dist/katex.min.css";
const PdfReader = lazy(() => import("./PdfReader"));

function AssetImage({ node }: NodeViewProps) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (node.attrs.assetHash)
      void assetUrl({ hash: node.attrs.assetHash, mime: "image/png" }).then(
        setUrl,
      );
    else setUrl(node.attrs.src);
  }, [node.attrs.assetHash, node.attrs.src]);
  return (
    <NodeViewWrapper className="asset-image">
      <img src={url} alt={node.attrs.alt || "笔记图片"} />
    </NodeViewWrapper>
  );
}
const LocalImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), assetHash: { default: null } };
  },
  addNodeView() {
    return ReactNodeViewRenderer(AssetImage);
  },
});
function RefView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper
      as="span"
      className="note-reference"
      contentEditable={false}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("cetrinw-open-note", { detail: node.attrs.noteId }),
        )
      }
    >
      ↗ {node.attrs.label}
    </NodeViewWrapper>
  );
}
const NoteReference = Node.create({
  name: "noteReference",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      noteId: { default: "" },
      label: { default: "" },
      blockId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-note-reference]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-note-reference": "" }),
      HTMLAttributes.label,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RefView);
  },
  renderMarkdown(node) {
    return `[${node.attrs?.label}](cetrinw://note/${node.attrs?.noteId})`;
  },
});
function MetricView({ node }: NodeViewProps) {
  const [record, setRecord] = useState<Entry | null>(null);
  useEffect(() => {
    const refresh = () => void get(node.attrs.seriesId).then(setRecord);
    refresh();
    window.addEventListener("cetrinw-change", refresh);
    return () => window.removeEventListener("cetrinw-change", refresh);
  }, [node.attrs.seriesId]);
  const points = record?.data.points || [];
  const last = [...points]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .at(-1);
  return (
    <NodeViewWrapper className="metric-block" contentEditable={false}>
      <small>动态指标 · {record?.title || "未找到指标"}</small>
      <strong>
        {last
          ? Number(last.close ?? last.value).toLocaleString("zh-CN", {
              maximumFractionDigits: 3,
            })
          : "暂无观测值"}{" "}
        <em>{record?.data.unit}</em>
      </strong>
      <span>
        {last?.date || "尚未更新"} · {record?.data.sourceUrl || "请连接数据源"}
      </span>
    </NodeViewWrapper>
  );
}
const Metric = Node.create({
  name: "metricBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { seriesId: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-metric]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-metric": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MetricView);
  },
  renderMarkdown(node) {
    return `\n[动态指标](cetrinw://series/${node.attrs?.seriesId})\n`;
  },
});

export function extensions() {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer" },
      },
    }),
    TableKit.configure({ table: { resizable: true } }),
    LocalImage,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: "开始书写，或用 Markdown 快捷输入…" }),
    UniqueID.configure({
      types: [
        "paragraph",
        "heading",
        "table",
        "blockquote",
        "codeBlock",
        "image",
        "metricBlock",
      ],
    }),
    Mathematics,
    Details,
    DetailsContent,
    DetailsSummary,
    Markdown,
    NoteReference,
    Metric,
  ];
}

export default function NoteEditor({
  record,
  onSaved,
  onDeleted,
}: {
  record: Entry;
  onSaved: (r: Entry) => void;
  onDeleted: () => void;
}) {
  const draft = useRef<Entry>(structuredClone(record)),
    dirty = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    queue = useRef(Promise.resolve());
  const [title, setTitle] = useState(record.title),
    [status, setStatus] = useState("已保存到本地"),
    [error, setError] = useState(""),
    [attachments, setAttachments] = useState<Asset[]>(
      record.data.attachments || [],
    ),
    [history, setHistory] = useState<Entry[] | null>(null),
    [chooser, setChooser] = useState<"note" | "series" | null>(null),
    [choices, setChoices] = useState<Entry[]>([]),
    [pdf, setPdf] = useState<Asset | null>(null),
    [characters, setCharacters] = useState(0),
    [showMeta, setShowMeta] = useState(false),
    [linkPrompt, setLinkPrompt] = useState<string | null>(null),
    [formulaPrompt, setFormulaPrompt] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [confirmAdopt, setConfirmAdopt] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    imageRef = useRef<HTMLInputElement>(null),
    mdRef = useRef<HTMLInputElement>(null);
  const linkedNotes = useLinks(record.id, "reference");
  const persist = () => {
    clearTimeout(timer.current);
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (!dirty.current) return;
        dirty.current = false;
        setStatus("正在保存…");
        const snapshot = structuredClone(draft.current);
        try {
          const r = await save(snapshot);
          draft.current.id = r.id;
          draft.current.revision = r.revision;
          draft.current.conflict_of = r.conflict_of;
          setStatus(r.conflict_of ? "已保存冲突副本" : "已保存到本地");
          onSaved(r);
          setError("");
        } catch (e) {
          dirty.current = true;
          setStatus("保存失败");
          setError(String(e));
        }
      });
    return queue.current;
  };
  const update = (patch: Partial<Entry["data"]>) => {
    draft.current.data = { ...draft.current.data, ...patch };
    dirty.current = true;
    setStatus("未保存");
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 650);
  };
  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: true,
      extensions: extensions(),
      content: record.data.content || record.data.markdown || "",
      contentType: record.data.content ? "json" : "markdown",
      editorProps: {
        attributes: { class: "prose-editor", "aria-label": "笔记正文" },
      },
      onUpdate: ({ editor }) => {
        setCharacters(editor.getText().length);
        update({ content: editor.getJSON(), markdown: undefined });
      },
      onCreate: ({ editor }) => setCharacters(editor.getText().length),
    },
    [],
  );
  useEffect(() => {
    const unregister = registerFlush(async () => {
      await persist();
      if (dirty.current) throw new Error("笔记尚未保存，请重试保存后关闭窗口");
    });
    const unregisterDirty = registerDirty(() => dirty.current);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void persist();
      }
    };
    window.addEventListener("keydown", key);
    const blur = () => void persist();
    window.addEventListener("blur", blur);
    return () => {
      unregister();
      unregisterDirty();
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
      void persist();
    };
  }, []);
  async function attach(file: File, image = false) {
    try {
      setError("");
      const a = await upload(file);
      const next = [...(draft.current.data.attachments || []), a];
      setAttachments(next);
      update({ attachments: next });
      if (image)
        editor
          ?.chain()
          .focus()
          .insertContent({
            type: "image",
            attrs: { src: `assets/${a.hash}`, assetHash: a.hash, alt: a.name },
          })
          .run();
      await persist();
    } catch (e) {
      setError(String(e));
    }
  }
  async function choose(kind: "note" | "series") {
    setChooser(kind);
    setChoices(await list(kind, "", 200));
  }
  const tool = (
    label: string,
    icon: React.ReactNode,
    fn: () => void,
    active = false,
  ) => (
    <button
      title={label}
      aria-label={label}
      className={`editor-tool ${active ? "active" : ""}`}
      onClick={fn}
    >
      {icon}
    </button>
  );
  if (!editor) return <Busy />;
  return (
    <div className="note-workspace">
      <div className="note-document">
        <div className="document-top">
          <span className="breadcrumb">
            <FileText size={14} />
            {draft.current.data.folder || "收件箱"}
          </span>
          <div className="inline">
            <span className="save-state">
              <span className={dirty.current ? "dot amber" : "dot"} />
              {status}
            </span>
            <button
              className="icon-button"
              title="版本历史"
              aria-label="版本历史"
              onClick={async () => {
                await persist();
                setHistory(
                  await command({ op: "history", id: draft.current.id }),
                );
              }}
            >
              <History size={17} />
            </button>
            <button
              className="icon-button"
              title="Markdown 导出"
              aria-label="Markdown 导出"
              onClick={async () => {
                try {
                  await persist();
                  await markdownBundle(draft.current, editor.getMarkdown());
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <Download size={17} />
            </button>
          </div>
        </div>
        <div className="editor-toolbar">
          <select
            aria-label="段落格式"
            value={
              editor.isActive("heading", { level: 1 })
                ? "1"
                : editor.isActive("heading", { level: 2 })
                  ? "2"
                  : editor.isActive("heading", { level: 3 })
                    ? "3"
                    : "0"
            }
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n)
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: n as 1 | 2 | 3 })
                  .run();
              else editor.chain().focus().setParagraph().run();
            }}
          >
            <option value="0">正文</option>
            <option value="1">标题一</option>
            <option value="2">标题二</option>
            <option value="3">标题三</option>
          </select>
          <span className="toolbar-divider" />
          {tool(
            "粗体",
            <Bold size={16} />,
            () => editor.chain().focus().toggleBold().run(),
            editor.isActive("bold"),
          )}
          {tool(
            "斜体",
            <Italic size={16} />,
            () => editor.chain().focus().toggleItalic().run(),
            editor.isActive("italic"),
          )}
          {tool(
            "删除线",
            <Strikethrough size={16} />,
            () => editor.chain().focus().toggleStrike().run(),
            editor.isActive("strike"),
          )}
          {tool(
            "行内代码",
            <Code size={16} />,
            () => editor.chain().focus().toggleCode().run(),
            editor.isActive("code"),
          )}
          {tool(
            "插入链接",
            <Link size={16} />,
            () =>
              setLinkPrompt(
                (editor.getAttributes("link").href as string | undefined) ||
                  "https://",
              ),
            editor.isActive("link"),
          )}
          {tool("无序列表", <List size={17} />, () =>
            editor.chain().focus().toggleBulletList().run(),
          )}
          {tool("有序列表", <ListOrdered size={17} />, () =>
            editor.chain().focus().toggleOrderedList().run(),
          )}
          {tool("任务列表", <ListTodo size={17} />, () =>
            editor.chain().focus().toggleTaskList().run(),
          )}
          {tool("引用", <Quote size={16} />, () =>
            editor.chain().focus().toggleBlockquote().run(),
          )}
          {tool("代码块", <Code2 size={17} />, () =>
            editor.chain().focus().toggleCodeBlock().run(),
          )}
          <span className="toolbar-divider" />
          {tool("插入表格", <Table2 size={17} />, () =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run(),
          )}
          {tool("插入图片", <ImagePlus size={17} />, () =>
            imageRef.current?.click(),
          )}
          {tool("引用笔记", <Link2 size={17} />, () => void choose("note"))}
          {tool(
            "插入动态指标",
            <Hash size={17} />,
            () => void choose("series"),
          )}
          {tool("插入公式", <Sigma size={17} />, () => setFormulaPrompt(true))}
          {tool("折叠内容", <ChevronDown size={17} />, () =>
            editor
              .chain()
              .focus()
              .insertContent({
                type: "details",
                content: [
                  {
                    type: "detailsSummary",
                    content: [{ type: "text", text: "展开详细内容" }],
                  },
                  { type: "detailsContent", content: [{ type: "paragraph" }] },
                ],
              })
              .run(),
          )}
          <span className="toolbar-divider" />
          {tool("撤销", <Undo2 size={16} />, () =>
            editor.chain().focus().undo().run(),
          )}
          {tool("重做", <Redo2 size={16} />, () =>
            editor.chain().focus().redo().run(),
          )}
          {editor.isActive("table") && (
            <div className="table-actions">
              <button
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                加行
              </button>
              <button
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                加列
              </button>
              <button onClick={() => editor.chain().focus().mergeCells().run()}>
                合并
              </button>
              <button onClick={() => editor.chain().focus().splitCell().run()}>
                拆分
              </button>
              <button
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                删除表格
              </button>
            </div>
          )}
        </div>
        <ErrorBox message={error} />
        <div className="document-scroll">
          <div className="document-paper">
            <input
              aria-label="笔记标题"
              className="note-title-input"
              placeholder="未命名笔记"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                draft.current.title = e.target.value;
                update({});
              }}
            />
            <div className="note-meta">
              <span>{dateLabel(record.updated_at)}</span>
              <span>·</span>
              <button onClick={() => setShowMeta(!showMeta)}>
                添加标签与文件夹
              </button>
            </div>
            {showMeta && (
              <div className="metadata-fields">
                <input
                  aria-label="文件夹"
                  placeholder="文件夹"
                  defaultValue={record.data.folder || "收件箱"}
                  onChange={(e) => update({ folder: e.target.value })}
                />
                <input
                  aria-label="标签"
                  placeholder="标签，用逗号分隔"
                  defaultValue={(record.data.tags || []).join(", ")}
                  onChange={(e) =>
                    update({
                      tags: e.target.value
                        .split(/[,，]/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            )}
            <EditorContent editor={editor} />
            <div className="attachment-section">
              <div className="section-heading">
                <h4>附件与资料</h4>
                <button
                  className="text-button"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip size={14} />
                  添加附件
                </button>
              </div>
              {attachments.map((a) => (
                <button
                  className="attachment"
                  key={a.hash}
                  onClick={async () => {
                    if (a.mime === "application/pdf" || a.name.endsWith(".pdf"))
                      setPdf(a);
                    else window.open(await assetUrl(a), "_blank", "noopener");
                  }}
                >
                  <FileText size={20} />
                  <span>
                    {a.name}
                    <small>{(a.size / 1024).toFixed(0)} KB</small>
                  </span>
                  <ExternalLink size={14} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <footer className="document-footer">
          <span>{characters.toLocaleString()} 字 · 富文本笔记</span>
          <div className="inline">
            <button onClick={() => mdRef.current?.click()}>
              导入 Markdown
            </button>
            <button onClick={() => void persist()}>⌘ S 保存</button>
          </div>
        </footer>
        <input
          hidden
          ref={fileRef}
          type="file"
          onChange={(e) => {
            if (e.target.files?.[0]) void attach(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <input
          hidden
          ref={imageRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            if (e.target.files?.[0]) void attach(e.target.files[0], true);
            e.target.value = "";
          }}
        />
        <input
          hidden
          ref={mdRef}
          type="file"
          accept=".md,.markdown,.txt"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              editor.commands.setContent(await f.text(), {
                contentType: "markdown",
              });
              update({ content: editor.getJSON() });
            }
            e.target.value = "";
          }}
        />
      </div>
      <aside className="context-panel">
        <div className="eyebrow">笔记脉络</div>
        <h3>让想法彼此连接</h3>
        <p className="muted">
          在正文中引用其他笔记，或嵌入持续更新的研究指标。
        </p>
        <button
          className="soft-button full"
          onClick={() => void choose("note")}
        >
          <Link2 size={16} />
          引用一篇笔记
        </button>
        <div className="side-section">
          <h4>
            反向链接 <span>{linkedNotes.length}</span>
          </h4>
          {linkedNotes.map((r) => (
            <button
              className="backlink"
              key={r.id}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("cetrinw-open-note", { detail: r.id }),
                )
              }
            >
              <FileText size={15} />
              {r.title}
            </button>
          ))}
          {linkedNotes.length === 0 && (
            <small className="muted">其他笔记引用这里后，会显示在此处。</small>
          )}
        </div>
        {draft.current.conflict_of && (
          <div className="side-section conflict-note">
            <h4>冲突副本</h4>
            <p className="muted small">
              这篇笔记保存时检测到与原笔记的并发修改，因此单独保留。选择保留哪一份内容。
            </p>
            <button
              className="soft-button full"
              onClick={() => setConfirmAdopt(true)}
            >
              以此版本覆盖原笔记
            </button>
          </div>
        )}
        <div className="side-section">
          <h4>保存与恢复</h4>
          <p className="muted small">
            每次保存保留一个版本。离线修改发生冲突时，双方内容都会保留。
          </p>
          <button
            className="text-button danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} />
            删除笔记
          </button>
        </div>
      </aside>
      {history && (
        <Modal title="版本历史" onClose={() => setHistory(null)}>
          {history.map((h, i) => (
            <div className="history-row" key={i}>
              <div>
                <b>{h.title}</b>
                <small>
                  版本 {h.revision} ·{" "}
                  {new Date(h.updated_at).toLocaleString("zh-CN")}
                </small>
              </div>
              <button
                className="soft-button"
                onClick={async () => {
                  editor.commands.setContent(
                    h.data.content || h.data.markdown || "",
                    { contentType: h.data.content ? "json" : "markdown" },
                  );
                  draft.current.data = structuredClone(h.data);
                  draft.current.title = h.title;
                  setTitle(h.title);
                  setAttachments(h.data.attachments || []);
                  update({ content: editor.getJSON() });
                  await persist();
                  setHistory(null);
                }}
              >
                恢复
              </button>
            </div>
          ))}
        </Modal>
      )}
      {chooser && (
        <Modal
          title={chooser === "note" ? "引用笔记" : "嵌入动态指标"}
          onClose={() => setChooser(null)}
        >
          <div className="choice-list">
            {choices
              .filter((r) => r.id !== record.id)
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .insertContent(
                        chooser === "note"
                          ? {
                              type: "noteReference",
                              attrs: { noteId: r.id, label: r.title },
                            }
                          : { type: "metricBlock", attrs: { seriesId: r.id } },
                      )
                      .run();
                    setChooser(null);
                  }}
                >
                  <FileText size={17} />
                  {r.title}
                  <Check size={15} />
                </button>
              ))}
            {choices.length === 0 && (
              <p className="muted">
                还没有可以引用的内容。先创建笔记或连接研究数据源。
              </p>
            )}
          </div>
        </Modal>
      )}
      {pdf && (
        <Modal title={pdf.name} wide onClose={() => setPdf(null)}>
          <Suspense fallback={<Busy />}>
            <PdfReader
              asset={pdf}
              noteId={draft.current.id}
              onQuote={(quote) => {
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "blockquote",
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          { type: "text", text: `${quote}（${pdf.name}）` },
                        ],
                      },
                    ],
                  })
                  .run();
              }}
            />
          </Suspense>
        </Modal>
      )}
      {linkPrompt !== null && (
        <PromptModal
          title="插入链接"
          label="链接地址"
          defaultValue={linkPrompt}
          hint="留空并确定可移除选中文本上的链接；支持 http(s):// 与 mailto:。"
          validate={(value) =>
            !value.trim() || /^(https?:\/\/|mailto:)/i.test(value.trim())
              ? undefined
              : "链接需以 http(s):// 或 mailto: 开头"
          }
          onSubmit={(value) => {
            const href = value.trim();
            if (!href) {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              return;
            }
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href })
              .run();
          }}
          onClose={() => setLinkPrompt(null)}
        />
      )}
      {formulaPrompt && (
        <PromptModal
          title="插入公式"
          label="LaTeX 公式"
          defaultValue={"E = \\frac{1}{2}CV^2"}
          multiline
          onSubmit={(value) => {
            if (value.trim())
              editor.chain().focus().insertInlineMath({ latex: value }).run();
          }}
          onClose={() => setFormulaPrompt(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="删除笔记"
          message="将这篇笔记移入已删除记录？版本历史仍保留，可在设置页的回收站恢复。"
          confirmLabel="移入回收站"
          danger
          onConfirm={async () => {
            await persist();
            await command({ op: "delete", id: draft.current.id });
            onDeleted();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {confirmAdopt && (
        <ConfirmModal
          title="采纳冲突副本"
          message="用当前编辑的内容覆盖原笔记，并把这个副本移入回收站？"
          confirmLabel="覆盖原笔记"
          danger
          onConfirm={async () => {
            await persist();
            const targetId = draft.current.conflict_of;
            if (!targetId) return;
            const target = await get(targetId);
            if (!target) throw new Error("原笔记不存在或已被删除");
            await save({
              ...target,
              title: draft.current.title.replace(/ · 冲突副本$/, ""),
              data: structuredClone(draft.current.data),
            });
            await command({ op: "delete", id: draft.current.id });
            onDeleted();
            window.dispatchEvent(
              new CustomEvent("cetrinw-open-note", { detail: targetId }),
            );
          }}
          onClose={() => setConfirmAdopt(false)}
        />
      )}
    </div>
  );
}
