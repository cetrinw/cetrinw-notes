import { useEffect, useRef, useState } from "react";
import WebDavSettings from "../components/WebDavSettings";
import TranslateSettings from "../components/TranslateSettings";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Check,
  Settings2,
  Unplug,
} from "lucide-react";
import {
  command,
  download,
  list,
  setSetting,
  setting,
  setToken,
  synchronize,
  save,
  remove,
  remote,
  native,
  changed,
} from "../lib/db";
import { zipSync, strToU8 } from "fflate";
import { noteToMarkdown } from "../lib/markdown";
import presets from "../../resources/data-presets.json";
import { useEntries } from "../lib/hooks";
import {
  Modal,
  Field,
  ErrorBox,
  Busy,
  ConfirmModal,
} from "../components/ui";
import { kindNames, type Entry } from "../types";
export default function Settings() {
  const [url, setUrl] = useState(""),
    [token, updateToken] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState<Entry | null | undefined>(undefined),
    [restore, setRestore] = useState<any>(null),
    [root, setRoot] = useState(""),
    [stats, setStats] = useState<any>(null),
    [backupError, setBackupError] = useState(""),
    [confirmSource, setConfirmSource] = useState<Entry | null>(null),
    [confirmReset, setConfirmReset] = useState(false);
  const sources = useEntries("source"),
    jobs = useEntries("job", "", 50),
    topics = useEntries("topic");
  const importFile = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void setting<string>("server_url").then((v) => setUrl(v || ""));
    void command({ op: "stats" })
      .then((s) => {
        setRoot(s.root);
        setStats(s);
      })
      .catch((e) => setError(String(e)));
    void setting<string>("backup_error").then((v) => setBackupError(v || ""));
  }, []);
  async function task(fn: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await fn());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function validateServerUrl(raw: string) {
    const value = raw.trim();
    if (!value) return "";
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("服务器地址格式不正确，例如 https://notes.example.com");
    }
    if (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
      )
    )
      throw new Error(
        "公网服务器地址需使用 HTTPS；本机调试可用 http://127.0.0.1",
      );
    return value;
  }
  async function refresh(r: Entry) {
    await task(async () => {
      if (native) {
        await synchronize();
        const { jobId } = await remote({ op: "refresh", id: r.id });
        for (let i = 0; i < 24; i++) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const job = await remote({ op: "get", id: jobId });
          if (["success", "failed"].includes(job.data.status)) {
            await synchronize();
            if (job.data.status === "failed") throw new Error(job.data.error);
            return `已采集 ${job.data.count} 条数据。`;
          }
        }
        return "任务仍在服务器运行，请稍后同步查看结果。";
      }
      const { jobId } = await command({ op: "refresh", id: r.id });
      for (let i = 0; i < 24; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const job = await command({ op: "get", id: jobId });
        if (["success", "failed"].includes(job.data.status)) {
          changed();
          if (job.data.status === "failed") throw new Error(job.data.error);
          return `已采集 ${job.data.count} 条数据。`;
        }
      }
      return "任务仍在运行。";
    });
  }
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR OWN WORKSPACE</div>
          <h1>
            数据由你掌握<span className="title-dot">.</span>
          </h1>
          <p>本地保存，按需连接。让工具适应你的节奏。</p>
        </div>
      </div>
      <ErrorBox message={error} />
      {message && (
        <div className="success-box">
          <Check size={16} />
          {message}
        </div>
      )}
      {busy && <Busy text="正在处理，请稍候" />}
      <WebDavSettings />
      <TranslateSettings />
      <section className="surface settings-section">
        <div className="settings-icon">
          <Server size={22} />
        </div>
        <div className="settings-body">
          <h3>个人服务器与同步</h3>
          <p className="muted">
            服务器负责每日采集与备份；笔记编辑和已下载课程可离线使用。
          </p>
          <div className="two-col compact">
            <Field label="服务器地址">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://notes.example.com"
              />
            </Field>
            <Field
              label="设备令牌"
              hint={
                native
                  ? "保存在 macOS 钥匙串，不进入笔记或备份。"
                  : "浏览器调试时仅保留在当前会话。"
              }
            >
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => updateToken(e.target.value)}
                placeholder="服务器 CETRINW_TOKEN"
              />
            </Field>
          </div>
          <div className="inline">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  await setSetting("server_url", validateServerUrl(url));
                  if (token) await setToken(token);
                  const result = await synchronize();
                  return `同步完成：上传 ${result.pushed} 条，接收 ${result.pulled} 次变更。`;
                })
              }
            >
              <RefreshCw size={16} />
              保存并同步
            </button>
            <button
              className="soft-button"
              onClick={() =>
                void task(async () => {
                  await setSetting("server_url", validateServerUrl(url));
                  if (token) await setToken(token);
                  return native
                    ? "服务器地址已保存，令牌使用 macOS 钥匙串保护。"
                    : "服务器地址已保存。";
                })
              }
            >
              保存设置
            </button>
            <button
              className="soft-button"
              onClick={() => setConfirmReset(true)}
            >
              <Unplug size={15} />
              清除同步状态
            </button>
          </div>
          <p className="form-hint">
            同步冲突会保留副本。服务器作为个人可信节点，请在公网使用 HTTPS。更换服务器前先清除同步状态，再填写新地址配对。
          </p>
        </div>
      </section>
      <section className="surface">
        <div className="section-heading">
          <div>
            <h3>数据源</h3>
            <p className="muted">
              按日更新；展示来源日期、最近成功时间和错误原因。
            </p>
          </div>
          <button className="primary" onClick={() => setSource(null)}>
            <Plus size={16} />
            添加数据源
          </button>
        </div>
        <div className="sources-list">
          {sources.rows.map((r) => (
            <div className="source-row" key={r.id}>
              <span
                className={`source-indicator ${r.data.status === "success" ? "ok" : r.data.status === "failed" ? "failed" : ""}`}
              />
              <div>
                <b>{r.title}</b>
                <small>
                  {r.data.adapter} · {r.data.enabled ? "每日自动" : "手动更新"}{" "}
                  ·{" "}
                  {r.data.lastSuccess
                    ? `最近成功 ${new Date(r.data.lastSuccess).toLocaleString("zh-CN")}`
                    : "尚未成功采集"}
                </small>
                {r.data.error && <p className="source-error">{r.data.error}</p>}
              </div>
              <button
                className="icon-button"
                disabled={busy}
                title="立即更新"
                aria-label={`更新 ${r.title}`}
                onClick={() => void refresh(r)}
              >
                <RefreshCw size={16} />
              </button>
              <button
                className="icon-button"
                title="编辑数据源"
                onClick={() => setSource(r)}
              >
                <Settings2 size={16} />
              </button>
              <button
                className="icon-button"
                title="删除数据源"
                onClick={() => setConfirmSource(r)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {sources.rows.length === 0 && (
            <div className="quiet-empty">
              连接第一个数据源，例如世界银行宏观指标、股票日线或行业 RSS。
            </div>
          )}
        </div>
      </section>
      <section className="surface settings-section">
        <div className="settings-icon">
          <Database size={22} />
        </div>
        <div className="settings-body">
          <h3>备份与恢复</h3>
          <p className="muted">
            完整备份包含富文本、附件、历史版本、研究资料与学习记录。
          </p>
          <div className="inline wrap">
            <button
              className="soft-button"
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  const bundle = await command({ op: "export" });
                  const saved = await download(
                    `Cetrinw-${new Date().toISOString().slice(0, 10)}.json`,
                    JSON.stringify(bundle),
                  );
                  return saved ? "完整备份已保存。" : "已取消导出。";
                })
              }
            >
              <ArrowDownToLine size={16} />
              导出完整备份
            </button>
            <button
              className="soft-button"
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  const notes = await list("note", "", 1000);
                  if (!notes.length) throw new Error("还没有可导出的笔记");
                  const entries: Record<string, Uint8Array> = {};
                  const used = new Set<string>();
                  for (const note of notes) {
                    const folder = String(note.data.folder || "收件箱").replace(
                      /[\\/:*?"<>|]/g,
                      "_",
                    );
                    const base = (note.title || "未命名笔记").replace(
                      /[\\/:*?"<>|]/g,
                      "_",
                    );
                    let name = `${folder}/${base}.md`;
                    let n = 2;
                    while (used.has(name)) name = `${folder}/${base}-${n++}.md`;
                    used.add(name);
                    entries[name] = strToU8(
                      `# ${note.title || "未命名笔记"}\n\n${noteToMarkdown(note)}\n`,
                    );
                  }
                  entries["README.txt"] = strToU8(
                    "全部笔记的 Markdown 导出：子文件夹对应笔记文件夹。图片等附件未包含，请在单篇导出或完整备份中获取。",
                  );
                  const bytes = zipSync(entries, { level: 1 });
                  const saved = await download(
                    `Cetrinw-notes-${new Date().toISOString().slice(0, 10)}.zip`,
                    bytes.buffer as ArrayBuffer,
                    "application/zip",
                  );
                  return saved
                    ? `已导出 ${notes.length} 篇笔记。`
                    : "已取消导出。";
                })
              }
            >
              <ArrowDownToLine size={16} />
              导出全部笔记（Markdown）
            </button>
            <button
              className="soft-button"
              onClick={() => importFile.current?.click()}
            >
              <ArrowUpFromLine size={16} />
              从备份导入
            </button>
            <button
              className="soft-button"
              onClick={() =>
                void task(async () => {
                  const r = await command({ op: "backup" });
                  return `本地快照：${r.path}`;
                })
              }
            >
              创建本地快照
            </button>
          </div>
          <p className="data-path">
            <ShieldCheck size={14} />
            本地数据目录 <code>{root || "正在读取…"}</code>
          </p>
          {stats && (
            <div className="storage-stats">
              <span>
                数据库 {formatBytes(stats.databaseBytes)} · 历史版本{" "}
                {Number(stats.history || 0).toLocaleString("zh-CN")} 条
              </span>
              <span>
                附件 {stats.assets?.count ?? 0} 个 ·{" "}
                {formatBytes(stats.assets?.bytes || 0)}
              </span>
              <span>
                笔记 {stats.counts?.note || 0} · 文章 {stats.counts?.article || 0}{" "}
                · 课程 {stats.counts?.lesson || 0}
              </span>
            </div>
          )}
          {backupError && (
            <ErrorBox message={`最近一次自动备份失败：${backupError}`} />
          )}
          <p className="form-hint">
            同一天的自动快照保留一份，共保留最近 30
            天。导入遇到同名不同内容时保留副本。
          </p>
          <input
            hidden
            ref={importFile}
            type="file"
            accept=".json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                try {
                  const b = JSON.parse(await f.text());
                  if (b.format !== "cetrinw-backup")
                    throw new Error("这不是 Cetrinw 完整备份");
                  setRestore(b);
                } catch (e) {
                  setError(String(e));
                }
              }
              e.target.value = "";
            }}
          />
        </div>
      </section>
      <section className="surface">
        <div className="section-heading">
          <h3>最近采集任务</h3>
          <button className="text-button" onClick={() => void jobs.refresh()}>
            刷新状态
          </button>
        </div>
        {jobs.rows.length ? (
          jobs.rows.map((j) => (
            <div className="job-row" key={j.id}>
              <b>{j.title}</b>
              <span
                className={`badge ${j.data.status === "success" ? "green" : j.data.status === "failed" ? "red" : "amber"}`}
              >
                {(
                  {
                    success: "成功",
                    failed: "失败",
                    queued: "排队中",
                    running: "执行中",
                  } as any
                )[j.data.status] || j.data.status}
              </span>
              <small>
                {j.data.error ||
                  (j.data.count !== undefined && `${j.data.count} 条`)}{" "}
                ·{" "}
                {j.data.startedAt &&
                  new Date(j.data.startedAt).toLocaleString("zh-CN")}
              </small>
            </div>
          ))
        ) : (
          <p className="quiet-empty">
            还没有采集任务。只有真实完成的任务会标记成功。
          </p>
        )}
      </section>
      <TrashBin />
      <footer className="settings-footer">
        Cetrinw 0.1.0 · MIT 开源 · Mac 桌面版
      </footer>
      {source !== undefined && (
        <SourceForm
          source={source}
          topics={topics.rows}
          onClose={() => setSource(undefined)}
        />
      )}
      {restore && (
        <Modal title="导入备份" onClose={() => setRestore(null)}>
          <p>
            此备份包含 {restore.records?.length || 0} 条记录、
            {restore.assets?.length || 0}{" "}
            个附件。现有内容会保留，有差异的记录将作为副本导入。
          </p>
          <div className="modal-actions">
            <button className="soft-button" onClick={() => setRestore(null)}>
              取消
            </button>
            <button
              className="primary"
              onClick={() =>
                void task(async () => {
                  const r = await command({ op: "import", bundle: restore });
                  changed();
                  setRestore(null);
                  return `已导入 ${r.imported} 条记录、${r.assets} 个附件。`;
                })
              }
            >
              导入
            </button>
          </div>
        </Modal>
      )}
      {confirmSource && (
        <ConfirmModal
          title="删除数据源"
          message={`删除数据源「${confirmSource.title}」？已采集的历史数据仍会保留。`}
          confirmLabel="删除"
          danger
          onConfirm={async () => {
            await remove(confirmSource.id);
          }}
          onClose={() => setConfirmSource(null)}
        />
      )}
      {confirmReset && (
        <ConfirmModal
          title="清除同步状态"
          message="清除待上传队列、同步游标和服务器版本记录？本地笔记不受影响。适用于更换个人服务器前的重新配对。"
          confirmLabel="清除并准备重新配对"
          danger
          onConfirm={async () => {
            await command({ op: "sync_reset" });
            setMessage("同步状态已清除。填写新的服务器地址后再执行同步。");
          }}
          onClose={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
function SourceForm({
  source,
  topics,
  onClose,
}: {
  source: Entry | null;
  topics: Entry[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(source?.title || ""),
    [adapter, setAdapter] = useState(source?.data.adapter || "worldbank"),
    [config, setConfig] = useState<any>(
      source?.data.config || {
        country: "CHN",
        indicator: "NY.GDP.MKTP.CD",
        unit: "现价美元",
        currency: "USD",
      },
    ),
    [enabled, setEnabled] = useState(source?.data.enabled ?? true),
    [error, setError] = useState("");
  const input = (key: string, label: string, placeholder = "") => (
    <Field key={key} label={label}>
      <input
        value={config[key] || ""}
        placeholder={placeholder}
        onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Modal title={source ? "编辑数据源" : "添加数据源"} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (!title.trim()) throw new Error("请填写名称");
            await save({
              ...source,
              kind: "source",
              title,
              data: {
                ...source?.data,
                adapter,
                config,
                enabled,
                status: source?.data.status || "never",
              },
            });
            onClose();
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <Field label="名称">
          <input
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：中国 GDP / 关注公司的日线"
          />
        </Field>
        <Field label="数据类型">
          <select
            value={adapter}
            onChange={(e) => {
              setAdapter(e.target.value);
              setConfig({ ...config, market: "CN" });
            }}
          >
            <option value="worldbank">世界银行 · 宏观指标</option>
            <option value="akshare">AKShare · 股票日线</option>
            <option value="tushare">Tushare · A 股日线</option>
            <option value="fred">FRED · 宏观时间序列</option>
            <option value="sec">SEC · 公司财报指标</option>
            <option value="rss">RSS / Atom · 行业资讯</option>
            <option value="json">自定义 JSON 指标接口</option>
          </select>
        </Field>
        {["fred", "worldbank", "akshare"].includes(adapter) && (
          <Field label="常用指标预置">
            <select
              value=""
              onChange={(e) => {
                // akshare's presets are the verified index list, keyed separately.
                const list =
                  (presets as any)[adapter === "akshare" ? "indices" : adapter] ||
                  [];
                const preset = list.find(
                  (p: any) => p.label === e.target.value,
                );
                if (!preset) return;
                const { label, ...fields } = preset;
                setConfig({ ...config, ...fields });
                setTitle(label);
              }}
            >
              <option value="">选择后自动填写配置</option>
              {(
                (presets as any)[adapter === "akshare" ? "indices" : adapter] ||
                []
              ).map((p: any) => (
                <option key={p.label} value={p.label}>
                  {p.symbol ? `${p.label}（${p.symbol}）` : p.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="关联研究专题">
          <select
            value={config.topicId || ""}
            onChange={(e) => setConfig({ ...config, topicId: e.target.value })}
          >
            <option value="">不关联</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </Field>
        {adapter === "worldbank" && (
          <>
            {input("country", "国家代码", "CHN / USA")}
            {input("indicator", "指标代码", "NY.GDP.MKTP.CD")}
            {input("unit", "数值单位", "现价美元")}
          </>
        )}
        {["akshare", "tushare"].includes(adapter) && (
          <>
            <Field label="市场">
              <select
                value={config.market || "CN"}
                onChange={(e) =>
                  setConfig({ ...config, market: e.target.value })
                }
              >
                <option value="CN">A 股</option>
                {adapter === "akshare" && <option value="US">美股</option>}
                {adapter === "akshare" && <option value="HK">港股</option>}
              </select>
            </Field>
            {adapter === "akshare" && (
              <Field label="类型">
                <select
                  value={config.kind || "stock"}
                  onChange={(e) =>
                    setConfig({ ...config, kind: e.target.value })
                  }
                >
                  <option value="stock">个股</option>
                  <option value="index">指数 / 大盘</option>
                </select>
              </Field>
            )}
            {input(
              "symbol",
              config.kind === "index" ? "指数代码" : "股票代码",
              adapter === "tushare"
                ? "600519.SH"
                : config.kind === "index"
                  ? config.market === "US"
                    ? ".INX"
                    : config.market === "HK"
                      ? "HSI"
                      : "sh000300"
                  : config.market === "US"
                    ? "AAPL"
                    : config.market === "HK"
                      ? "00700"
                      : "600519",
            )}
            {adapter === "akshare" && config.market === "CN" && (
              <Field label="行情来源">
                <select
                  value={config.provider || "sina"}
                  onChange={(e) =>
                    setConfig({ ...config, provider: e.target.value })
                  }
                >
                  <option value="sina">新浪财经</option>
                  <option value="eastmoney">东方财富</option>
                </select>
              </Field>
            )}
            <p className="form-hint">
              行情 worker 在服务器中运行。Tushare 需要在服务器配置 TUSHARE_TOKEN
              与相应权限。
            </p>
          </>
        )}
        {adapter === "fred" && (
          <>
            {input("series_id", "序列代码", "FEDFUNDS")}
            {input("unit", "数值单位", "%")}
            <p className="form-hint">
              在服务器配置 FRED_API_KEY。密钥不会写入笔记或备份。
            </p>
          </>
        )}
        {adapter === "sec" && (
          <>
            {input("cik", "公司 CIK", "0000320193")}
            {input("tag", "XBRL 指标", "Revenues")}
            {input("unit", "单位", "USD")}
            <p className="form-hint">
              在服务器配置包含联系信息的
              CETRINW_USER_AGENT。保留各次申报版本与期间。
            </p>
          </>
        )}
        {["rss", "json"].includes(adapter) && (
          <>
            {input("url", "HTTPS 地址", "https://…")}
            {adapter === "json" && (
              <p className="form-hint">
                返回对象包含 points 数组，每项提供 date（YYYY-MM-DD）与
                value；可附 unit 和 currency。
              </p>
            )}
          </>
        )}
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          启用每日自动更新
        </label>
        <ErrorBox message={error} />
        <div className="modal-actions">
          <button type="button" className="soft-button" onClick={onClose}>
            取消
          </button>
          <button className="primary">保存数据源</button>
        </div>
      </form>
    </Modal>
  );
}
function TrashBin() {
  const [rows, setRows] = useState<Entry[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const load = () =>
      void command<Entry[]>({ op: "trash" })
        .then(setRows)
        .catch((e) => setError(String(e)));
    load();
    window.addEventListener("cetrinw-change", load);
    return () => window.removeEventListener("cetrinw-change", load);
  }, []);
  return (
    <section className="surface">
      <div className="section-heading">
        <div>
          <h3>回收站</h3>
          <p className="muted">
            已删除的笔记、课程、订阅等保留版本历史，可随时恢复。
          </p>
        </div>
      </div>
      <ErrorBox message={error} />
      {rows.length ? (
        rows.map((r) => (
          <div className="job-row" key={r.id}>
            <b>{r.title || "未命名"}</b>
            <span className="badge">{kindNames[r.kind]}</span>
            <small>{new Date(r.updated_at).toLocaleString("zh-CN")}</small>
            <button
              className="text-button"
              onClick={() =>
                void command({ op: "restore", id: r.id })
                  .then(() => changed(r.kind))
                  .catch((e) => setError(String(e)))
              }
            >
              恢复
            </button>
          </div>
        ))
      ) : (
        <p className="quiet-empty">回收站是空的。</p>
      )}
    </section>
  );
}
