import { lazy, Suspense, useState, useRef, useEffect } from "react";
import {
  Plus,
  ArrowUpRight,
  Layers3,
  GitBranch,
  CalendarDays,
  Lightbulb,
  TrendingUp,
  Table2,
  ExternalLink,
  FileText,
  Trash2,
  ChevronRight,
  RefreshCw,
  Repeat2,
  Check,
} from "lucide-react";
import { useEntries, dateLabel } from "../lib/hooks";
import {
  save,
  remove,
  remote,
  synchronize,
  native,
  command,
  registerFlush,
  get,
  download,
} from "../lib/db";
import {
  Modal,
  Empty,
  Field,
  ErrorBox,
  Busy,
  ConfirmModal,
  PromptModal,
} from "../components/ui";
import { createNote } from "../lib/notes";
import templates from "../../resources/research-templates.json";
import presets from "../../resources/data-presets.json";
import {
  alignSeries,
  eventImpacts,
  phaseProgress,
  phaseStats,
  rebasePoints,
  type SeriesInput,
} from "../lib/cycles";
import type { Entry, Kind } from "../types";
const Chart = lazy(() => import("../components/Chart"));
const PriceChart = lazy(() => import("../components/PriceChart"));
// Type-only: the chart itself stays lazily loaded, so its bundle is not pulled
// in by the research page until a chart actually renders.
import type { ChartExport, ChartLane } from "../components/Chart";
import type { VisibleRange } from "../components/PriceChart";
import { hasOhlc, rangeStats, type RangeStats } from "../lib/price";
/** Indices verified against the installed akshare; see scripts/probe_market_sources.py. */
const indexPresets: { label: string; symbol: string; market: string }[] =
  (presets as any).indices || [];
type Tab =
  | "overview"
  | "chain"
  | "events"
  | "cycles"
  | "theses"
  | "prices"
  | "tables";
const tabs: [Tab, string, React.ReactNode][] = [
  ["overview", "专题概览", <Layers3 size={16} />],
  ["chain", "产业关系", <GitBranch size={16} />],
  ["events", "事件时间轴", <CalendarDays size={16} />],
  ["cycles", "周期", <Repeat2 size={16} />],
  ["theses", "研究判断", <Lightbulb size={16} />],
  ["prices", "标的与指标", <TrendingUp size={16} />],
  ["tables", "数据表", <Table2 size={16} />],
];
export default function Research({ onNote }: { onNote: (id: string) => void }) {
  const topics = useEntries("topic"),
    entities = useEntries("entity"),
    relations = useEntries("relation"),
    events = useEntries("event"),
    theses = useEntries("thesis"),
    cycles = useEntries("cycle"),
    series = useEntries("series"),
    tables = useEntries("table"),
    sources = useEntries("source");
  const [topicId, setTopicId] = useState(""),
    [tab, setTab] = useState<Tab>("overview"),
    [form, setForm] = useState<Kind | null>(null),
    [edit, setEdit] = useState<Entry | null>(null),
    [error, setError] = useState(""),
    [selectedSeries, setSelectedSeries] = useState(""),
    [tablePrompt, setTablePrompt] = useState(false);
  const topic = topics.rows.find((t) => t.id === topicId) || topics.rows[0];
  const id = topic?.id;
  const filter = (rows: Entry[]) => rows.filter((r) => r.data.topicId === id);
  const es = filter(entities.rows),
    rs = filter(relations.rows),
    ev = filter(events.rows),
    ts = filter(theses.rows),
    cs = filter(cycles.rows),
    ss = series.rows.filter((r) => r.data.topicId === id),
    tableRows = filter(tables.rows);
  const currentSeries = ss.find((s) => s.id === selectedSeries) || ss[0];
  async function createFromTemplate(templateId: string) {
    try {
      const template = ((templates as any).templates || []).find(
        (t: any) => t.id === templateId,
      );
      if (!template) return;
      const t = await save({
        kind: "topic",
        title: template.name,
        data: {
          description: template.description,
          stage: "研究中",
        },
      });
      const n = await createNote(`${template.name} · 研究框架`, template.note);
      await save({ ...t, data: { ...t.data, noteId: n.id } });
      if (template.cycle) {
        const palette = ["#7fa76f", "#c9a86b", "#8f8fbf", "#b97567"];
        await save({
          kind: "cycle",
          title: template.cycle.name,
          data: {
            topicId: t.id,
            kind: template.cycle.kind || "自定义",
            description: template.description,
            phases: (template.cycle.phases || []).map(
              (name: string, i: number) => ({
                id: crypto.randomUUID(),
                name,
                start: "",
                end: "",
                color: palette[i % palette.length],
              }),
            ),
          },
        });
      }
      setTopicId(t.id);
    } catch (e) {
      setError(String(e));
    }
  }
  async function refresh(sourceId: string) {
    try {
      setError("");
      if (native) {
        await synchronize();
        await remote({ op: "refresh", id: sourceId });
      } else await command({ op: "refresh", id: sourceId });
      setError("刷新任务已提交，可在设置中查看完成状态。");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="page research-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">RESEARCH WORKSPACE</div>
          <h1>
            研究，让线索形成判断<span className="title-dot">.</span>
          </h1>
          <p>从一份报告开始，连接产业、公司与正在发生的事。</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setEdit(null);
            setForm("topic");
          }}
        >
          <Plus size={17} />
          新建专题
        </button>
      </div>
      <ErrorBox message={error || topics.error} />
      {!topic ? (
        <div className="template-picker">
          <div className="section-heading">
            <div>
              <h3>从模板开始</h3>
              <p className="muted">
                模板只提供研究结构，不包含虚构的行业事实。
              </p>
            </div>
          </div>
          <div className="resource-grid">
            {((templates as any).templates || []).map((t: any) => (
              <article className="resource-card surface" key={t.id}>
                <span className="badge">{t.cycle ? "含周期骨架" : "研究框架"}</span>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <button
                  className="primary"
                  onClick={() => void createFromTemplate(t.id)}
                >
                  创建专题 <ArrowUpRight size={15} />
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="topic-strip">
            {topics.rows.map((t) => (
              <button
                className={t.id === id ? "selected" : ""}
                key={t.id}
                onClick={() => setTopicId(t.id)}
              >
                <span className="topic-symbol">{t.title.slice(0, 1)}</span>
                {t.title}
                <span className="badge">{t.data.stage || "研究中"}</span>
              </button>
            ))}
          </div>
          <div className="research-header">
            <div>
              <span className="eyebrow">当前专题</span>
              <h2>{topic.title}</h2>
              <p>{topic.data.description}</p>
            </div>
            <div className="inline">
              {topic.data.noteId && (
                <button
                  className="soft-button"
                  onClick={() => onNote(topic.data.noteId)}
                >
                  <FileText size={16} />
                  研究笔记
                </button>
              )}
              <button
                className="soft-button"
                onClick={() => {
                  setEdit(topic);
                  setForm("topic");
                }}
              >
                编辑专题
              </button>
            </div>
          </div>
          <div className="tabs">
            {tabs.map(([key, label, icon]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          {tab === "overview" && (
            <>
              <div className="stat-grid">
                {[
                  ["产业对象", es.length],
                  ["跟踪事件", ev.length],
                  [
                    "待验证判断",
                    ts.filter((t) => t.data.status !== "已复盘").length,
                  ],
                  ["数据序列", ss.length],
                ].map(([label, n]) => (
                  <div className="stat-card" key={label}>
                    <small>{label}</small>
                    <strong>
                      {n}
                      <span>项</span>
                    </strong>
                  </div>
                ))}
              </div>
              <div className="two-col">
                <section className="surface">
                  <div className="section-heading">
                    <h3>最近发生了什么</h3>
                    <button
                      className="text-button"
                      onClick={() => setTab("events")}
                    >
                      全部事件 <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {ev.length ? (
                    ev.slice(0, 4).map((e) => (
                      <div className="compact-event" key={e.id}>
                        <span className="event-point" />
                        <div>
                          <small>{e.data.date || "日期待补充"}</small>
                          <b>{e.title}</b>
                          <p>
                            {e.data.mechanism ||
                              e.data.evidence
                                ?.replace(/<[^>]*>/g, "")
                                .slice(0, 100)}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="muted padded">
                      添加第一条有来源的事件，或连接 RSS 数据源。
                    </p>
                  )}
                </section>
                <section className="surface">
                  <div className="section-heading">
                    <h3>下一步验证</h3>
                    <button
                      className="text-button"
                      onClick={() => {
                        setEdit(null);
                        setForm("thesis");
                      }}
                    >
                      <Plus size={15} />
                      添加判断
                    </button>
                  </div>
                  {ts.length ? (
                    ts.slice(0, 4).map((t) => (
                      <div className="thesis-preview" key={t.id}>
                        <Lightbulb size={18} />
                        <div>
                          <b>{t.title}</b>
                          <p>{t.data.verification || "待填写验证条件"}</p>
                          <small>
                            {t.data.reviewAt
                              ? `下次复盘 ${t.data.reviewAt}`
                              : "尚未安排复盘"}
                          </small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="muted padded">
                      写下你的判断、影响机制，以及能支持或推翻它的证据。
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "chain" && (
            <>
              <div className="section-heading">
                <p className="muted">
                  对象可以关联多个环节，每条关系保留独立证据。
                </p>
                <div className="inline">
                  <button
                    className="soft-button"
                    onClick={() => {
                      setEdit(null);
                      setForm("relation");
                    }}
                  >
                    <GitBranch size={16} />
                    添加关系
                  </button>
                  <button
                    className="primary"
                    onClick={() => {
                      setEdit(null);
                      setForm("entity");
                    }}
                  >
                    <Plus size={16} />
                    添加对象
                  </button>
                </div>
              </div>
              <div className="chain-board">
                {["上游材料", "器件与模组", "下游应用", "公司"].map((group) => (
                  <section key={group}>
                    <header>
                      {group}
                      <span>
                        {es.filter((e) => e.data.category === group).length}
                      </span>
                    </header>
                    {es
                      .filter((e) => e.data.category === group)
                      .map((e) => (
                        <button
                          className="entity-card"
                          key={e.id}
                          onClick={() => {
                            setEdit(e);
                            setForm("entity");
                          }}
                        >
                          <b>{e.title}</b>
                          <p>{e.data.role || "待补充产业位置"}</p>
                          <small>
                            {e.data.ticker || e.data.sourceUrl
                              ? "已记录标识或来源"
                              : "待补充来源"}
                          </small>
                        </button>
                      ))}
                  </section>
                ))}
              </div>
              <section className="surface">
                <div className="section-heading">
                  <h3>关系与证据</h3>
                </div>
                {rs.map((r) => (
                  <div className="relation-row" key={r.id}>
                    <b>
                      {es.find((e) => e.id === r.data.from)?.title || "未关联"}
                    </b>
                    <span>— {r.data.relationship} →</span>
                    <b>
                      {es.find((e) => e.id === r.data.to)?.title || "未关联"}
                    </b>
                    <p>{r.data.evidence}</p>
                    <button
                      className="text-button"
                      onClick={() => {
                        setEdit(r);
                        setForm("relation");
                      }}
                    >
                      查看
                    </button>
                  </div>
                ))}
                {!rs.length && (
                  <p className="muted padded">还没有记录产业关系。</p>
                )}
              </section>
            </>
          )}
          {tab === "events" && (
            <>
              <div className="section-heading">
                <h3>事件时间轴</h3>
                <button
                  className="primary"
                  onClick={() => {
                    setEdit(null);
                    setForm("event");
                  }}
                >
                  <Plus size={16} />
                  记录事件
                </button>
              </div>
              <EventTimeline
                events={ev}
                cycles={cs}
                entities={es}
                series={ss}
                onEdit={(e) => {
                  setEdit(e);
                  setForm("event");
                }}
                onError={setError}
              />
            </>
          )}
          {tab === "cycles" && (
            <>
              <div className="section-heading">
                <h3>周期跟踪</h3>
                <button
                  className="primary"
                  onClick={() => {
                    setEdit(null);
                    setForm("cycle");
                  }}
                >
                  <Plus size={16} />
                  新建周期
                </button>
              </div>
              {cs.length ? (
                cs.map((c) => (
                  <CycleBoard
                    key={c.id}
                    cycle={c}
                    events={ev.filter((e) => e.data.cycleId === c.id)}
                    theses={ts.filter((t) => t.data.cycleId === c.id)}
                    series={ss}
                    onEdit={() => {
                      setEdit(c);
                      setForm("cycle");
                    }}
                  />
                ))
              ) : (
                <Empty
                  icon={<Repeat2 size={28} />}
                  title="把事件放进周期里"
                  description="定义周期（如库存周期）和阶段，事件与判断挂到阶段上；指标图会叠加阶段色带，复盘日期到期会在这里提醒。"
                />
              )}
            </>
          )}
          {tab === "theses" && (
            <>
              <div className="section-heading">
                <h3>研究判断与验证</h3>
                <button
                  className="primary"
                  onClick={() => {
                    setEdit(null);
                    setForm("thesis");
                  }}
                >
                  <Plus size={16} />
                  添加判断
                </button>
              </div>
              <div className="thesis-grid">
                {ts.map((t) => (
                  <article className="surface thesis-card" key={t.id}>
                    <div className="section-heading">
                      <span className="badge green">
                        {t.data.status || "待验证"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => {
                          setEdit(t);
                          setForm("thesis");
                        }}
                      >
                        编辑 <ChevronRight size={14} />
                      </button>
                    </div>
                    <h3>{t.title}</h3>
                    <dl>
                      {[
                        ["mechanism", "影响机制"],
                        ["verification", "验证条件"],
                        ["counterEvidence", "反向证据"],
                        ["outcome", "复盘结论"],
                      ].map(([key, label]) => (
                        <div key={key}>
                          <dt>{label}</dt>
                          <dd>{t.data[key] || "待补充"}</dd>
                        </div>
                      ))}
                    </dl>
                    <footer>下次复盘：{t.data.reviewAt || "未安排"}</footer>
                  </article>
                ))}
              </div>
              {!ts.length && (
                <Empty
                  icon={<Lightbulb size={28} />}
                  title="把判断写成可以验证的问题"
                  description="记录预期、条件和反向证据。以后可以回到当时的信息，检查判断如何演变。"
                />
              )}
            </>
          )}
          {tab === "prices" && (
            <>
              <div className="section-heading">
                <h3>关注标的与数据指标</h3>
                <button
                  className="primary"
                  onClick={() => {
                    setEdit(null);
                    setForm("watch");
                  }}
                >
                  <Plus size={16} />
                  关注标的
                </button>
              </div>
              <div className="series-chips">
                {ss.map((s) => (
                  <button
                    key={s.id}
                    className={s.id === currentSeries?.id ? "selected" : ""}
                    onClick={() => setSelectedSeries(s.id)}
                  >
                    {s.title}
                    <small>{s.data.currency || s.data.unit}</small>
                  </button>
                ))}
              </div>
              {currentSeries ? (
                <section className="surface price-surface">
                  <div className="section-heading">
                    <div>
                      <h3>{currentSeries.title}</h3>
                      <p className="muted">
                        {currentSeries.data.priceBasis === "unadjusted"
                          ? "未复权日线 · 拆股与分红可能产生价格跳变"
                          : currentSeries.data.unit}{" "}
                        · 数据采集于{" "}
                        {new Date(currentSeries.data.fetchedAt).toLocaleString(
                          "zh-CN",
                        )}
                      </p>
                    </div>
                    <button
                      className="soft-button"
                      onClick={() => void refresh(currentSeries.data.sourceId)}
                    >
                      <RefreshCw size={15} />
                      更新
                    </button>
                  </div>
                  <Suspense fallback={<Busy />}>
                    <Chart
                      points={currentSeries.data.points || []}
                      events={ev.map((e) => ({ ...e.data, title: e.title }))}
                    />
                  </Suspense>
                  <a
                    className="source-link"
                    href={currentSeries.data.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    数据来源 <ExternalLink size={13} />
                  </a>
                </section>
              ) : (
                <Empty
                  icon={<TrendingUp size={28} />}
                  title="让股价与研究时间轴连接起来"
                  description="添加 A 股或美股标的，配置个人服务器后获取每日行情。没有成功采集前，这里会保留明确的未更新状态。"
                />
              )}
              <div className="source-mini-list">
                {sources.rows
                  .filter((s) => s.data.config?.topicId === id)
                  .map((s) => (
                    <div key={s.id}>
                      <b>{s.title}</b>
                      <span
                        className={`badge ${s.data.status === "success" ? "green" : "amber"}`}
                      >
                        {s.data.status === "success"
                          ? "已采集"
                          : s.data.status === "failed"
                            ? "采集失败"
                            : "未更新"}
                      </span>
                      <small>
                        {s.data.error ||
                          (s.data.lastSuccess &&
                            `上次成功 ${dateLabel(s.data.lastSuccess)}`)}
                      </small>
                      <button
                        className="text-button"
                        onClick={() => void refresh(s.id)}
                      >
                        刷新
                      </button>
                    </div>
                  ))}
              </div>
            </>
          )}
          {tab === "tables" && (
            <>
              <div className="section-heading">
                <h3>结构化数据表</h3>
                <button
                  className="primary"
                  onClick={() => setTablePrompt(true)}
                >
                  <Plus size={16} />
                  新建数据表
                </button>
              </div>
              {tableRows.map((r) => (
                <DataTable key={r.id} initial={r} entities={es} />
              ))}
              {!tableRows.length && (
                <Empty
                  icon={<Table2 size={26} />}
                  title="把资料整理成可比较的数据"
                  description="自定义文字、数字、日期、勾选与关联字段，筛选、排序，并查看数值汇总。"
                />
              )}
            </>
          )}
        </>
      )}
      {form && (
        <RecordForm
          kind={form}
          entry={edit}
          topicId={id}
          entities={es}
          cycles={cs}
          onClose={() => setForm(null)}
          onDone={(r) => {
            if (r.kind === "topic") setTopicId(r.id);
            setForm(null);
          }}
        />
      )}
      {tablePrompt && (
        <PromptModal
          title="新建数据表"
          label="数据表名称"
          defaultValue="公司对比"
          onSubmit={async (value) => {
            const title = value.trim();
            if (!title) throw new Error("请填写数据表名称");
            await save({
              kind: "table",
              title,
              data: {
                topicId: id,
                columns: [
                  { id: "name", name: "名称", type: "text" },
                  { id: "value", name: "指标", type: "number" },
                  { id: "source", name: "来源", type: "text" },
                ],
                rows: [],
              },
            });
          }}
          onClose={() => setTablePrompt(false)}
        />
      )}
    </div>
  );
}

function RecordForm({
  kind,
  entry,
  topicId,
  entities,
  cycles,
  onClose,
  onDone,
}: {
  kind: Kind;
  entry: Entry | null;
  topicId?: string;
  entities: Entry[];
  cycles: Entry[];
  onClose: () => void;
  onDone: (e: Entry) => void;
}) {
  const [title, setTitle] = useState(entry?.title || ""),
    [d, setD] = useState<any>(
      entry?.data ||
        (kind === "cycle"
          ? { topicId, kind: "库存周期", phases: [] }
          : {
              topicId,
              category: "公司",
              status: kind === "event" ? "待确认" : "待验证",
              market: "CN",
              ...(kind === "watch" ? { kind: "stock" } : {}),
            }),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const field = (key: string, label: string, type = "text") => (
    <Field key={key} label={label}>
      {type === "textarea" ? (
        <textarea
          value={d[key] || ""}
          onChange={(e) => setD({ ...d, [key]: e.target.value })}
        />
      ) : (
        <input
          type={type}
          value={d[key] || ""}
          onChange={(e) => setD({ ...d, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  const select = (key: string, label: string, options: [string, string][]) => (
    <Field key={key} label={label}>
      <select
        value={d[key] || ""}
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
      >
        <option value="">请选择</option>
        {options.map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
  const labels: any = {
    topic: "研究专题",
    entity: "产业对象",
    relation: "产业关系",
    event: "事件",
    thesis: "研究判断",
    cycle: "周期",
    watch: "关注标的",
  };
  return (
    <Modal
      title={`${entry ? "编辑" : "添加"}${labels[kind]}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (!title.trim()) throw new Error("请填写名称");
            if (kind === "watch" && !d.symbol?.trim())
              throw new Error("请输入代码");
            if (kind === "relation" && (!d.from || !d.to || d.from === d.to))
              throw new Error("请选择两个不同的产业对象");
            const result = await save({
              ...entry,
              kind,
              title: title.trim(),
              data: d,
            });
            if (kind === "watch") {
              await save({
                kind: "source",
                title: title.trim(),
                data: {
                  adapter: "akshare",
                  enabled: true,
                  status: "never",
                  config: {
                    symbol: d.symbol,
                    market: d.market,
                    kind: d.kind || "stock",
                    topicId,
                  },
                },
              });
            }
            onDone(result);
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={kind === "relation" ? "关系名称" : "名称 / 标题"}>
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {kind === "topic" && (
          <>
            {field("description", "研究范围与目标", "textarea")}
            {select("stage", "进展", [
              ["研究中", "研究中"],
              ["持续跟踪", "持续跟踪"],
              ["已归档", "已归档"],
            ])}
          </>
        )}
        {kind === "entity" && (
          <>
            {select(
              "category",
              "所在环节",
              ["上游材料", "器件与模组", "下游应用", "公司"].map((x) => [x, x]),
            )}
            {field("ticker", "股票代码（可选）")}
            {field("role", "业务位置与相关收入", "textarea")}
            {field("sourceUrl", "证据链接", "url")}
            {field("evidence", "证据原文 / 页码", "textarea")}
          </>
        )}
        {kind === "relation" && (
          <>
            {select(
              "from",
              "起点",
              entities.map((e) => [e.id, e.title]),
            )}
            {select(
              "to",
              "终点",
              entities.map((e) => [e.id, e.title]),
            )}
            {field("relationship", "关系类型，例如供应、应用、竞争")}
            {field("validFrom", "适用时间", "date")}
            {field("evidence", "证据与适用条件", "textarea")}
            {field("sourceUrl", "来源链接", "url")}
          </>
        )}
        {kind === "event" && (
          <>
            {field("date", "事件日期", "date")}
            {select(
              "entityId",
              "关联对象",
              entities.map((e) => [e.id, e.title]),
            )}
            {cycles.length > 0 &&
              select(
                "cycleId",
                "所属周期",
                cycles.map((c) => [c.id, c.title]),
              )}
            {d.cycleId &&
              select(
                "phaseId",
                "周期阶段",
                ((cycles.find((c) => c.id === d.cycleId)?.data.phases ||
                  []) as any[]).map((p) => [p.id, p.name || "未命名"]),
              )}
            {field("sourceUrl", "原文来源", "url")}
            {field("evidence", "事实与原文证据", "textarea")}
            {field("mechanism", "影响机制（个人分析）", "textarea")}
            {select("status", "确认状态", [
              ["待确认", "待确认"],
              ["已确认", "已确认"],
              ["待补证", "待补证"],
            ])}
          </>
        )}
        {kind === "thesis" && (
          <>
            {field("mechanism", "为什么会发生影响", "textarea")}
            {cycles.length > 0 &&
              select(
                "cycleId",
                "所属周期",
                cycles.map((c) => [c.id, c.title]),
              )}
            {d.cycleId &&
              select(
                "phaseId",
                "周期阶段",
                ((cycles.find((c) => c.id === d.cycleId)?.data.phases ||
                  []) as any[]).map((p) => [p.id, p.name || "未命名"]),
              )}
            {field("verification", "什么指标或证据可以验证", "textarea")}
            {field("counterEvidence", "可能推翻判断的条件", "textarea")}
            {field("reviewAt", "下次复盘日期", "date")}
            {field("outcome", "复盘结论", "textarea")}
            {select("status", "当前状态", [
              ["待验证", "待验证"],
              ["验证中", "验证中"],
              ["已复盘", "已复盘"],
            ])}
          </>
        )}
        {kind === "cycle" && (
          <>
            {select("kind", "周期类型", [
              ["库存周期", "库存周期"],
              ["产能周期", "产能周期"],
              ["价格周期", "价格周期"],
              ["技术周期", "技术周期"],
              ["自定义", "自定义"],
            ])}
            {field("description", "周期说明与判断依据", "textarea")}
            <PhaseEditor
              phases={d.phases || []}
              onChange={(phases) => setD({ ...d, phases })}
            />
            {select(
              "currentPhaseId",
              "当前阶段",
              ((d.phases || []) as any[]).map((p) => [
                p.id,
                p.name || "未命名",
              ]),
            )}
            {field("sourceUrl", "来源链接", "url")}
          </>
        )}
        {kind === "watch" && (
          <>
            {select("kind", "类型", [
              ["stock", "个股"],
              ["index", "指数 / 大盘"],
            ])}
            {select("market", "市场", [
              ["CN", "A 股"],
              ["US", "美股"],
              ["HK", "港股"],
            ])}
            {d.kind === "index" && (
              <Field label="常用指数">
                <select
                  value={d.symbol || ""}
                  onChange={(e) => {
                    const picked = indexPresets.find(
                      (p) => p.symbol === e.target.value,
                    );
                    setD({
                      ...d,
                      symbol: e.target.value,
                      market: picked?.market || d.market,
                    });
                    if (picked && !title.trim()) setTitle(picked.label);
                  }}
                >
                  <option value="">请选择，或直接在下方填写</option>
                  {indexPresets
                    .filter((p) => p.market === d.market)
                    .map((p) => (
                      <option key={p.symbol} value={p.symbol}>
                        {p.label}（{p.symbol}）
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {field(
              "symbol",
              d.kind === "index"
                ? d.market === "US"
                  ? "指数代码，例如 .INX"
                  : d.market === "HK"
                    ? "指数代码，例如 HSI"
                    : "指数代码，例如 sh000300"
                : d.market === "US"
                  ? "股票代码，例如 AAPL"
                  : d.market === "HK"
                    ? "股票代码，例如 00700"
                    : "股票代码，例如 600519",
            )}
            <p className="form-hint">
              {d.kind === "index"
                ? "指数走 akshare 的新浪接口；东财接口在本机被代理阻断。首次刷新获取近三年日线。"
                : "添加后生成日频行情数据源。需在个人服务器安装行情 worker；首次刷新会获取近三年未复权日线。"}
            </p>
          </>
        )}
        <ErrorBox message={error} />
        <div className="modal-actions">
          {entry && (
            <button
              type="button"
              className="text-button danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
              删除
            </button>
          )}
          <button type="button" className="soft-button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
        {confirmDelete && (
          <ConfirmModal
            title="删除记录"
            message="删除这条记录？可在设置页的回收站恢复。"
            confirmLabel="删除"
            danger
            onConfirm={async () => {
              if (!entry) return;
              await remove(entry.id);
              onClose();
            }}
            onClose={() => setConfirmDelete(false)}
          />
        )}
      </form>
    </Modal>
  );
}

function DataTable({
  initial,
  entities,
}: {
  initial: Entry;
  entities: Entry[];
}) {
  const [data, setData] = useState(initial.data),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState(""),
    [error, setError] = useState(""),
    [fieldForm, setFieldForm] = useState<{ name: string; type: string } | null>(
      null,
    );
  const current = useRef(initial),
    dirty = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    queue = useRef(Promise.resolve());
  const persist = () => {
    clearTimeout(timer.current);
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (!dirty.current) return;
        dirty.current = false;
        try {
          const result = await save({
            ...current.current,
            data: structuredClone(current.current.data),
          });
          current.current.revision = result.revision;
          current.current.id = result.id;
          setError("");
        } catch (e) {
          dirty.current = true;
          setError(String(e));
        }
      });
    return queue.current;
  };
  useEffect(() => {
    const unregister = registerFlush(async () => {
      await persist();
      if (dirty.current) throw new Error("数据表尚未保存");
    });
    return () => {
      unregister();
      void persist();
    };
  }, []);
  const update = (next: any) => {
    setData(next);
    current.current.data = next;
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 350);
  };
  let rows = [...data.rows].filter((r) =>
    JSON.stringify(r).toLowerCase().includes(query.toLowerCase()),
  );
  if (sort)
    rows.sort((a, b) =>
      typeof a[sort] === "number"
        ? a[sort] - b[sort]
        : String(a[sort] || "").localeCompare(String(b[sort] || "")),
    );
  return (
    <section className="surface data-table-panel">
      <div className="section-heading">
        <h3>{initial.title}</h3>
        <div className="inline">
          <input
            className="small-input"
            placeholder="筛选表格…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="soft-button"
            onClick={() => setFieldForm({ name: "", type: "text" })}
          >
            添加字段
          </button>
          <button
            className="soft-button"
            onClick={() =>
              update({
                ...data,
                rows: [...data.rows, { id: crypto.randomUUID() }],
              })
            }
          >
            <Plus size={14} />
            添加行
          </button>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="table-scroll">
        <table className="structured-table">
          <thead>
            <tr>
              {data.columns.map((c: any) => (
                <th key={c.id}>
                  <button onClick={() => setSort(sort === c.id ? "" : c.id)}>
                    {c.name} {sort === c.id ? "↑" : ""}
                    <small>{c.type}</small>
                  </button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((r) => (
              <tr key={r.id}>
                {data.columns.map((c: any) => (
                  <td key={c.id}>
                    {c.type === "entity" ? (
                      <select
                        value={r[c.id] || ""}
                        onChange={(e) =>
                          update({
                            ...data,
                            rows: data.rows.map((row: any) =>
                              row.id === r.id
                                ? { ...row, [c.id]: e.target.value }
                                : row,
                            ),
                          })
                        }
                      >
                        <option value="">关联对象</option>
                        {entities.map((e) => (
                          <option value={e.id} key={e.id}>
                            {e.title}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          c.type === "number"
                            ? "number"
                            : c.type === "date"
                              ? "date"
                              : c.type === "checkbox"
                                ? "checkbox"
                                : "text"
                        }
                        value={
                          c.type === "checkbox" ? undefined : (r[c.id] ?? "")
                        }
                        checked={c.type === "checkbox" ? !!r[c.id] : undefined}
                        onChange={(e) =>
                          update({
                            ...data,
                            rows: data.rows.map((row: any) =>
                              row.id === r.id
                                ? {
                                    ...row,
                                    [c.id]:
                                      c.type === "checkbox"
                                        ? e.target.checked
                                        : c.type === "number"
                                          ? e.target.value === ""
                                            ? null
                                            : Number(e.target.value)
                                          : e.target.value,
                                  }
                                : row,
                            ),
                          })
                        }
                      />
                    )}
                  </td>
                ))}
                <td>
                  <button
                    className="icon-button"
                    aria-label="删除行"
                    onClick={() =>
                      update({
                        ...data,
                        rows: data.rows.filter((row: any) => row.id !== r.id),
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {data.columns.map((c: any) => (
                <td key={c.id}>
                  {c.type === "number"
                    ? `合计 ${rows.reduce((sum, r) => sum + (Number(r[c.id]) || 0), 0).toLocaleString()}`
                    : ""}
                </td>
              ))}
              <td>{rows.length} 行</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {rows.length > 200 && (
        <p className="muted small">当前展示前 200 行，请使用筛选缩小范围。</p>
      )}
      {fieldForm && (
        <Modal title="添加字段" onClose={() => setFieldForm(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = fieldForm.name.trim();
              if (!name) return;
              update({
                ...data,
                columns: [
                  ...data.columns,
                  { id: crypto.randomUUID(), name, type: fieldForm.type },
                ],
              });
              setFieldForm(null);
            }}
          >
            <Field label="字段名称">
              <input
                autoFocus
                value={fieldForm.name}
                onChange={(e) =>
                  setFieldForm({ ...fieldForm, name: e.target.value })
                }
              />
            </Field>
            <Field label="字段类型">
              <select
                value={fieldForm.type}
                onChange={(e) =>
                  setFieldForm({ ...fieldForm, type: e.target.value })
                }
              >
                <option value="text">text · 文本</option>
                <option value="number">number · 数字</option>
                <option value="date">date · 日期</option>
                <option value="checkbox">checkbox · 勾选</option>
                <option value="entity">entity · 关联对象</option>
              </select>
            </Field>
            <div className="modal-actions">
              <button
                type="button"
                className="soft-button"
                onClick={() => setFieldForm(null)}
              >
                取消
              </button>
              <button className="primary">添加</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function PhaseEditor({
  phases,
  onChange,
}: {
  phases: any[];
  onChange: (phases: any[]) => void;
}) {
  const palette = ["#7fa76f", "#c9a86b", "#8f8fbf", "#b97567", "#6f9ab0"];
  return (
    <div className="phase-editor">
      <span className="phase-editor-title">周期阶段（按时间顺序）</span>
      {phases.map((p, i) => (
        <div className="phase-row" key={p.id}>
          <span
            className="phase-swatch"
            style={{ background: p.color || palette[i % palette.length] }}
          />
          <input
            aria-label={`阶段${i + 1}名称`}
            placeholder="阶段名称，如：主动补库"
            value={p.name || ""}
            onChange={(e) =>
              onChange(
                phases.map((x, j) =>
                  j === i ? { ...x, name: e.target.value } : x,
                ),
              )
            }
          />
          <input
            aria-label={`阶段${i + 1}开始日期`}
            type="date"
            value={String(p.start || "").slice(0, 10)}
            onChange={(e) =>
              onChange(
                phases.map((x, j) =>
                  j === i ? { ...x, start: e.target.value } : x,
                ),
              )
            }
          />
          <input
            aria-label={`阶段${i + 1}结束日期`}
            type="date"
            value={String(p.end || "").slice(0, 10)}
            onChange={(e) =>
              onChange(
                phases.map((x, j) =>
                  j === i ? { ...x, end: e.target.value } : x,
                ),
              )
            }
          />
          <button
            type="button"
            className="icon-button"
            aria-label="删除阶段"
            onClick={() => onChange(phases.filter((_, j) => j !== i))}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="soft-button"
        onClick={() =>
          onChange([
            ...phases,
            {
              id: crypto.randomUUID(),
              name: "",
              start: "",
              end: "",
              color: palette[phases.length % palette.length],
            },
          ])
        }
      >
        <Plus size={14} />
        添加阶段
      </button>
    </div>
  );
}

function EventTimeline({
  events,
  cycles,
  entities,
  series,
  onEdit,
  onError,
}: {
  events: Entry[];
  cycles: Entry[];
  entities: Entry[];
  series: Entry[];
  onEdit: (e: Entry) => void;
  onError: (message: string) => void;
}) {
  const [view, setView] = useState<"flat" | "cycle">("flat");
  const [entityFilter, setEntityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cycleFilter, setCycleFilter] = useState("");
  const [query, setQuery] = useState("");
  const [timelineSeries, setTimelineSeries] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [confirming, setConfirming] = useState<Entry | null>(null);
  const filtered = events.filter((e) => {
    if (entityFilter && e.data.entityId !== entityFilter) return false;
    if (statusFilter && (e.data.status || "待确认") !== statusFilter)
      return false;
    if (cycleFilter && e.data.cycleId !== cycleFilter) return false;
    const date = String(e.data.date || "").slice(0, 10);
    if (fromDate && (!date || date < fromDate)) return false;
    if (toDate && (!date || date > toDate)) return false;
    if (query.trim()) {
      const hay =
        `${e.title} ${e.data.evidence || ""} ${e.data.mechanism || ""}`.toLowerCase();
      if (!hay.includes(query.trim().toLowerCase())) return false;
    }
    return true;
  });
  const dated = filtered
    .filter((e) => String(e.data.date || "").slice(0, 10))
    .sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
  const undated = filtered.filter(
    (e) => !String(e.data.date || "").slice(0, 10),
  );
  const groups: { key: string; label: string; rows: Entry[] }[] = [];
  for (const e of dated) {
    const key = String(e.data.date).slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(e);
    else groups.push({ key, label: monthLabel(key), rows: [e] });
  }
  const cycleGroups = cycles
    .map((c) => ({
      cycle: c,
      phases: ((c.data.phases || []) as any[]).map((p) => ({
        phase: p,
        rows: filtered.filter(
          (e) => e.data.cycleId === c.id && e.data.phaseId === p.id,
        ),
      })),
      loose: filtered.filter(
        (e) => e.data.cycleId === c.id && !e.data.phaseId,
      ),
    }))
    .filter((g) => g.phases.some((p) => p.rows.length) || g.loose.length);
  const noCycle = filtered.filter((e) => !e.data.cycleId);
  // The board above the list: the chosen series, one event lane per industry
  // object, and the move each series made around each event.
  const activeSeries = resolveIds(timelineSeries, series);
  const chosenSeries = series.filter((s) => activeSeries.includes(s.id));
  const chartInputs: SeriesInput[] = chosenSeries.map((s) => ({
    id: s.id,
    name: s.title,
    points: s.data.points || [],
  }));
  const chartAligned = alignSeries(chartInputs);
  const impacts = eventImpacts(
    filtered.map((e) => ({ id: e.id, date: e.data.date, title: e.title })),
    chartAligned,
  );
  const impactById = new Map(impacts.map((impact) => [impact.id, impact]));
  const lanes: ChartLane[] = (() => {
    const grouped = new Map<
      string,
      { date: string; title: string; status: string }[]
    >();
    for (const event of dated) {
      const key = String(event.data.entityId || "");
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({
        date: String(event.data.date).slice(0, 10),
        title: event.title,
        status: String(event.data.status || "待确认"),
      });
    }
    return [...grouped.entries()].map(([key, points]) => ({
      name: entities.find((entity) => entity.id === key)?.title || "未归类",
      points,
    }));
  })();
  // Bands follow the cycle filter, so the chart's phases match the list below it.
  const timelineBands = (
    cycleFilter ? cycles.filter((c) => c.id === cycleFilter) : cycles
  ).flatMap((c) =>
    ((c.data.phases || []) as any[])
      .filter((p) => p.start && p.end)
      .map((p) => ({
        start: String(p.start).slice(0, 10),
        end: String(p.end).slice(0, 10),
        label: `${c.title} · ${p.name || "阶段"}`,
        color: p.color || "#7fa76f",
      })),
  );
  const chartExport = useRef<ChartExport | null>(null);
  const stamp = () => new Date().toISOString().slice(0, 10);
  const exportPng = async () => {
    const data = chartExport.current?.toDataURL();
    if (!data) {
      onError("图表尚未渲染完成，请稍后重试");
      return;
    }
    try {
      const bytes = Uint8Array.from(atob(data.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      await download(`时间轴-${stamp()}.png`, bytes, "image/png");
    } catch (e) {
      onError(String(e));
    }
  };
  const exportCsv = () => {
    const header = [
      "日期",
      "事件",
      "状态",
      "对象",
      ...chosenSeries.map((s) => `${s.title} · 事件前后5个交易日涨跌%`),
    ];
    const rows = filtered.map((event) => {
      const impact = impactById.get(event.id);
      return [
        String(event.data.date || "").slice(0, 10),
        event.title,
        String(event.data.status || ""),
        entities.find((en) => en.id === event.data.entityId)?.title || "",
        ...chosenSeries.map((s) => {
          const move = impact?.moves.find((m) => m.id === s.id);
          return move?.percent == null ? "" : move.percent.toFixed(2);
        }),
      ];
    });
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\r\n");
    // The BOM keeps Excel from mangling the Chinese column headers.
    void download(`时间轴-${stamp()}.csv`, `﻿${csv}`, "text/csv");
  };
  async function quickConfirm(event: Entry) {
    try {
      const latest = await get(event.id);
      if (latest && !latest.deleted)
        await save({ ...latest, data: { ...latest.data, status: "已确认" } });
    } catch (err) {
      onError(String(err));
    }
  }
  async function toNote(event: Entry) {
    try {
      const note = await createNote(
        event.title,
        `# ${event.title}\n\n日期：${String(event.data.date || "待补充").slice(0, 10)}\n\n来源：${event.data.sourceUrl || "未记录"}\n\n## 事实与原文证据\n\n${String(event.data.evidence || "").replace(/<[^>]*>/g, "")}\n\n## 影响机制（个人分析）\n\n${event.data.mechanism || ""}\n\n## 我的分析\n\n`,
      );
      window.dispatchEvent(
        new CustomEvent("cetrinw-open-note", { detail: note.id }),
      );
    } catch (err) {
      onError(String(err));
    }
  }
  const card = (event: Entry) => {
    const cycle = cycles.find((c) => c.id === event.data.cycleId);
    const phase = cycle
      ? ((cycle.data.phases || []) as any[]).find(
          (p) => p.id === event.data.phaseId,
        )
      : undefined;
    return (
      <div className="timeline-card" key={event.id}>
        <div className="section-heading">
          <h3>{event.title}</h3>
          <span
            className={`badge ${event.data.status === "已确认" ? "green" : "amber"}`}
          >
            {event.data.status || "待确认"}
          </span>
        </div>
        {phase && (
          <span
            className="badge phase-badge"
            style={{
              background: `${phase.color || "#7fa76f"}22`,
              color: phase.color || "#5d7a4d",
            }}
          >
            {cycle!.title} · {phase.name}
          </span>
        )}
        <p>{String(event.data.evidence || "").replace(/<[^>]*>/g, "")}</p>
        {event.data.mechanism && (
          <div className="mechanism">
            <b>影响机制</b>
            {event.data.mechanism}
          </div>
        )}
        {impactById
          .get(event.id)
          ?.moves.some((move) => move.percent !== null) && (
          <div className="event-impacts">
            {impactById
              .get(event.id)!
              .moves.filter((move) => move.percent !== null)
              .map((move) => (
                <span
                  key={move.id}
                  className={move.percent! >= 0 ? "up" : "down"}
                >
                  {move.name} {move.percent! >= 0 ? "+" : ""}
                  {move.percent!.toFixed(1)}%
                </span>
              ))}
          </div>
        )}
        <footer>
          {event.data.sourceUrl && (
            <a href={event.data.sourceUrl} target="_blank" rel="noreferrer">
              查看原文 <ExternalLink size={13} />
            </a>
          )}
          <div className="inline">
            {event.data.status !== "已确认" && (
              <button
                className="text-button"
                onClick={() => void quickConfirm(event)}
              >
                <Check size={13} /> 标记已确认
              </button>
            )}
            <button className="text-button" onClick={() => void toNote(event)}>
              转为笔记
            </button>
            <button className="text-button" onClick={() => onEdit(event)}>
              编辑
            </button>
            <button
              className="text-button danger"
              onClick={() => setConfirming(event)}
            >
              <Trash2 size={13} /> 删除
            </button>
          </div>
        </footer>
      </div>
    );
  };
  return (
    <div className="event-timeline">
      <div className="timeline-toolbar">
        <div className="inline wrap">
          <select
            aria-label="按对象筛选"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
          >
            <option value="">全部对象</option>
            {entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.title}
              </option>
            ))}
          </select>
          <select
            aria-label="按状态筛选"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">全部状态</option>
            <option>待确认</option>
            <option>已确认</option>
            <option>待补证</option>
          </select>
          {cycles.length > 0 && (
            <select
              aria-label="按周期筛选"
              value={cycleFilter}
              onChange={(e) => setCycleFilter(e.target.value)}
            >
              <option value="">全部周期</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <input
            className="small-input"
            aria-label="搜索事件"
            placeholder="搜索事件…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="date-range">
            从
            <input
              type="date"
              aria-label="起始日期"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            到
            <input
              type="date"
              aria-label="结束日期"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          {(fromDate || toDate) && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
            >
              清除日期
            </button>
          )}
        </div>
        <div className="view-switch">
          <button
            className={view === "flat" ? "active" : ""}
            onClick={() => setView("flat")}
          >
            平铺
          </button>
          <button
            className={view === "cycle" ? "active" : ""}
            onClick={() => setView("cycle")}
          >
            按周期
          </button>
        </div>
      </div>
      {series.length > 0 && (
        <section className="timeline-board">
          <MarketPanel
            series={series}
            events={filtered}
            bands={timelineBands}
            lanes={lanes}
            activeIds={activeSeries}
            onToggle={setTimelineSeries}
            exportRef={chartExport}
            emptyHint="选择至少一个标的后，走势与事件泳道会显示在这里。"
          />
          <div className="board-actions">
            <span className="muted small">
              {chosenSeries.length} 条序列 · {filtered.length} 条事件
            </span>
            <button className="soft-button" onClick={() => void exportPng()}>
              导出图片
            </button>
            <button className="soft-button" onClick={exportCsv}>
              导出 CSV
            </button>
          </div>
        </section>
      )}
      {!filtered.length && (
        <Empty
          title="没有匹配的事件"
          description="调整筛选条件，或记录一条有来源的新事件。"
        />
      )}
      {view === "flat" ? (
        <div className="timeline">
          {groups.map((g) => (
            <section key={g.key} className="timeline-month">
              <h4 className="timeline-month-head">{g.label}</h4>
              {g.rows.map((e) => (
                <article key={e.id}>
                  <div className="timeline-date">
                    {String(e.data.date).slice(5, 10)}
                    <span />
                  </div>
                  {card(e)}
                </article>
              ))}
            </section>
          ))}
          {undated.length > 0 && (
            <section className="timeline-month">
              <h4 className="timeline-month-head">未定日期</h4>
              {undated.map((e) => (
                <article key={e.id}>
                  <div className="timeline-date">
                    待补充
                    <span />
                  </div>
                  {card(e)}
                </article>
              ))}
            </section>
          )}
        </div>
      ) : (
        <div className="cycle-lanes">
          {cycleGroups.map((g) => (
            <section key={g.cycle.id} className="surface cycle-lane">
              <div className="section-heading">
                <h3>{g.cycle.title}</h3>
                <span className="badge">{g.cycle.data.kind || "周期"}</span>
              </div>
              {g.phases.map(({ phase, rows }) => (
                <div className="cycle-phase" key={phase.id}>
                  <div className="cycle-phase-head">
                    <span
                      className="phase-swatch"
                      style={{ background: phase.color || "#7fa76f" }}
                    />
                    <b>{phase.name || "未命名阶段"}</b>
                    <small>
                      {String(phase.start || "?").slice(0, 10)} 至{" "}
                      {String(phase.end || "?").slice(0, 10)} · {rows.length}{" "}
                      条事件
                    </small>
                  </div>
                  {rows.map((e) => card(e))}
                </div>
              ))}
              {g.loose.length > 0 && (
                <div className="cycle-phase">
                  <div className="cycle-phase-head">
                    <b>未分阶段</b>
                    <small>{g.loose.length} 条事件</small>
                  </div>
                  {g.loose.map((e) => card(e))}
                </div>
              )}
            </section>
          ))}
          {noCycle.length > 0 && (
            <section className="surface cycle-lane">
              <div className="section-heading">
                <h3>未挂周期</h3>
                <span className="badge">{noCycle.length} 条</span>
              </div>
              {noCycle.map((e) => card(e))}
            </section>
          )}
        </div>
      )}
      {confirming && (
        <ConfirmModal
          title="删除事件"
          message={`删除「${confirming.title}」？可在设置页的回收站恢复。`}
          confirmLabel="删除"
          danger
          onConfirm={async () => {
            await remove(confirming.id);
          }}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

/** One line of range statistics, fed by whatever the price chart is showing. */
function RangeStatsRow({ stats }: { stats: RangeStats | null }) {
  if (!stats) return null;
  const percent = (value: number | null) =>
    value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  return (
    <div className="range-stats">
      <span className="muted small">
        {stats.from} 至 {stats.to} · {stats.bars} 根
      </span>
      <span
        className={
          stats.percent === null ? "muted" : stats.percent >= 0 ? "up" : "down"
        }
      >
        区间涨跌 {percent(stats.percent)}
      </span>
      <span>振幅 {percent(stats.amplitude)}</span>
      <span>最高 {stats.high.toFixed(2)}</span>
      <span>最低 {stats.low.toFixed(2)}</span>
      {stats.averageVolume !== null && (
        <span>均量 {Math.round(stats.averageVolume).toLocaleString("zh-CN")}</span>
      )}
    </div>
  );
}

/** An empty pick means "everything available"; the panel never renders nothing. */
function resolveIds(picked: string[], series: Entry[]): string[] {
  return picked.length ? picked : series.map((s) => s.id);
}

/** Moves one entry within a list, for reordering the drawn series. */
function move(list: string[], from: number, to: number): string[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The market panel shared by the event timeline and the cycle board: free
 * combination and ordering of series on one axis, optional rebasing to a common
 * start, phase bands behind the lines and event lanes underneath. The parent
 * owns the selection so both views can keep their own persisted pick.
 */
function MarketPanel({
  series,
  events,
  bands,
  lanes = [],
  activeIds,
  onToggle,
  exportRef,
  emptyHint = "选择至少一个序列后显示走势。",
}: {
  series: Entry[];
  events: Entry[];
  bands: { start: string; end: string; label?: string; color?: string }[];
  lanes?: ChartLane[];
  activeIds: string[];
  onToggle: (ids: string[]) => void;
  exportRef?: React.MutableRefObject<ChartExport | null>;
  emptyHint?: string;
}) {
  // Absolute values by default: a rebased line that starts at 100 reads as
  // broken data unless the user actually asked for a comparison.
  const [normalized, setNormalized] = useState(false);
  const [mode, setMode] = useState<"compare" | "candles">("compare");
  const [range, setRange] = useState<RangeStats | null>(null);
  const chosen = series.filter((s) => activeIds.includes(s.id));
  // The candle view needs real OHLC bars, which only the market sources carry;
  // macro series keep the comparison chart.
  const single = chosen.length === 1 ? chosen[0] : null;
  const candlePoints = single?.data.points || [];
  const candleReady = !!single && hasOhlc(candlePoints);
  const inputs: SeriesInput[] = chosen.map((s) => ({
    id: s.id,
    name: s.title,
    points: s.data.points || [],
  }));
  const aligned = alignSeries(inputs);
  // Rebase at the earliest phase start, so a cycle's phases line up with the
  // series even when the data reaches further back.
  const baseDate =
    bands
      .map((band) => band.start)
      .filter(Boolean)
      .sort()[0] || aligned.dates[0];
  const chartSeries = inputs.map((item) => ({
    ...item,
    points:
      normalized && baseDate ? rebasePoints(item.points, baseDate) : item.points,
  }));
  if (!series.length) return null;
  return (
    <>
      <div className="board-toolbar">
        <div className="series-chips">
          {series.map((s) => {
            const on = activeIds.includes(s.id);
            const at = activeIds.indexOf(s.id);
            return (
              <span key={s.id} className={`chip ${on ? "selected" : ""}`}>
                <button
                  type="button"
                  className="chip-toggle"
                  aria-pressed={on}
                  onClick={() =>
                    onToggle(
                      on
                        ? activeIds.filter((value) => value !== s.id)
                        : [...activeIds, s.id],
                    )
                  }
                >
                  {s.title}
                  <small>{s.data.currency || s.data.unit}</small>
                </button>
                {on && activeIds.length > 1 && (
                  <span className="chip-move">
                    <button
                      type="button"
                      aria-label={`${s.title} 前移`}
                      disabled={at <= 0}
                      onClick={() => onToggle(move(activeIds, at, at - 1))}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      aria-label={`${s.title} 后移`}
                      disabled={at >= activeIds.length - 1}
                      onClick={() => onToggle(move(activeIds, at, at + 1))}
                    >
                      ▶
                    </button>
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <div className="board-modes">
          {candleReady && (
            <div className="view-switch">
              <button
                className={mode === "compare" ? "active" : ""}
                onClick={() => setMode("compare")}
              >
                折线对比
              </button>
              <button
                className={mode === "candles" ? "active" : ""}
                onClick={() => setMode("candles")}
              >
                K线
              </button>
            </div>
          )}
          <button
            className={`soft-button ${normalized ? "active" : ""}`}
            onClick={() => setNormalized(!normalized)}
          >
            {normalized ? "归一化 · 起点=100" : "绝对数值"}
          </button>
        </div>
      </div>
      {chosen.length && mode === "candles" && candleReady ? (
        <Suspense fallback={<Busy />}>
          <PriceChart
            points={candlePoints}
            bands={bands}
            events={events.map((e) => ({
              date: String(e.data.date || ""),
              title: e.title,
            }))}
            exportRef={exportRef}
            onRangeChange={(visible: VisibleRange | null) =>
              setRange(
                visible
                  ? rangeStats(candlePoints, visible.from, visible.to)
                  : null,
              )
            }
          />
          <RangeStatsRow stats={range} />
        </Suspense>
      ) : chosen.length ? (
        <Suspense fallback={<Busy />}>
          <Chart
            series={chartSeries}
            // Lanes already place every event on the axis; dashed lines as well
            // would draw each marker twice.
            events={
              lanes.length ? [] : events.map((e) => ({ ...e.data, title: e.title }))
            }
            bands={bands}
            lanes={lanes}
            exportRef={exportRef}
          />
        </Suspense>
      ) : (
        <p className="muted small">{emptyHint}</p>
      )}
    </>
  );
}

function CycleBoard({
  cycle,
  events,
  theses,
  series,
  onEdit,
}: {
  cycle: Entry;
  events: Entry[];
  theses: Entry[];
  series: Entry[];
  onEdit: () => void;
}) {
  const phases: any[] = cycle.data.phases || [];
  const [picked, setPicked] = useState<string[]>(
    (cycle.data.seriesIds as string[]) || [],
  );
  const [error, setError] = useState("");
  const today = new Date().toLocaleDateString("en-CA");
  const due = theses.filter(
    (t) =>
      t.data.status !== "已复盘" &&
      t.data.reviewAt &&
      String(t.data.reviewAt).slice(0, 10) <= today,
  );
  // Every series of the topic is a candidate; the cycle stores only the ones it
  // picked, so an empty list means "show everything available".
  const activeIds = resolveIds(picked, series);
  const chosen = series.filter((s) => activeIds.includes(s.id));
  const inputs: SeriesInput[] = chosen.map((s) => ({
    id: s.id,
    name: s.title,
    points: s.data.points || [],
  }));
  // Phase returns come from the raw series; rebasing is a display concern that
  // MarketPanel applies on its own.
  const aligned = alignSeries(inputs);
  // Events carry their date and phase inside `data`, which is what phaseStats reads.
  const stats = phaseStats(
    phases,
    aligned,
    events.map((e) => e.data),
    today,
  );
  const current = phases.find((p) => p.id === cycle.data.currentPhaseId);
  const progress = phaseProgress(current, today);
  const bands = phases
    .filter((p) => p.start && p.end)
    .map((p) => ({
      start: String(p.start).slice(0, 10),
      end: String(p.end).slice(0, 10),
      label: p.name || "阶段",
      color: p.color || "#7fa76f",
    }));
  async function toggleSeries(next: string[]) {
    setPicked(next);
    try {
      const latest = await get(cycle.id);
      if (latest && !latest.deleted)
        await save({ ...latest, data: { ...latest.data, seriesIds: next } });
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="surface cycle-board">
      <div className="section-heading">
        <div>
          <h3>
            {cycle.title}{" "}
            <span className="badge">{cycle.data.kind || "周期"}</span>
          </h3>
          <p className="muted small">
            {cycle.data.description || "待补充周期说明"}
          </p>
        </div>
        <button className="soft-button" onClick={onEdit}>
          编辑周期
        </button>
      </div>
      {current && (
        <p className="cycle-progress">
          当前阶段 <b>{current.name || "未命名"}</b> · {progress.state}
          {progress.total
            ? ` · 第 ${progress.days} 天 / 共 ${progress.total} 天（${progress.percent}%）`
            : ` · 已过 ${progress.days} 天`}
        </p>
      )}
      <div className="phase-bar">
        {phases.map((p) => {
          const active = cycle.data.currentPhaseId === p.id;
          return (
            <div
              key={p.id}
              className={`phase-segment ${active ? "current" : ""}`}
              style={{
                background: `${p.color || "#7fa76f"}22`,
                borderColor: p.color || "#7fa76f",
              }}
              title={`${p.name || "未命名"} ${p.start || "?"} 至 ${p.end || "?"}`}
            >
              <b>{p.name || "未命名阶段"}</b>
              <small>
                {String(p.start || "?").slice(0, 7)} 至{" "}
                {String(p.end || "?").slice(0, 7)}
              </small>
              <span className="phase-count">
                {events.filter((e) => e.data.phaseId === p.id).length} 条事件
              </span>
              {active && <em>当前</em>}
            </div>
          );
        })}
        {!phases.length && (
          <p className="muted small">还没有阶段，编辑周期添加。</p>
        )}
      </div>
      {due.length > 0 && (
        <p className="cycle-due">
          到期复盘：{due.map((t) => t.title).join("、")}
        </p>
      )}
      <ErrorBox message={error} />
      {series.length > 0 ? (
        <>
          <MarketPanel
            series={series}
            events={events}
            bands={bands}
            activeIds={activeIds}
            onToggle={(ids) => void toggleSeries(ids)}
          />
          {chosen.length > 0 && phases.length > 0 && (
            <div className="phase-table">
              <table>
                <thead>
                  <tr>
                    <th>阶段</th>
                    <th>区间</th>
                    <th>天数</th>
                    <th>事件</th>
                    {chosen.map((s) => (
                      <th key={s.id}>{s.title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.map((stat) => (
                    <tr
                      key={stat.id}
                      className={
                        stat.id === cycle.data.currentPhaseId ? "current" : ""
                      }
                    >
                      <td>{stat.name}</td>
                      <td className="muted">
                        {stat.start} 至 {stat.end}
                      </td>
                      <td>{stat.days}</td>
                      <td>{stat.events}</td>
                      {stat.returns.map((r) => (
                        <td
                          key={r.id}
                          className={
                            r.percent === null
                              ? "muted"
                              : r.percent >= 0
                                ? "up"
                                : "down"
                          }
                        >
                          {r.percent === null
                            ? "—"
                            : `${r.percent >= 0 ? "+" : ""}${r.percent.toFixed(1)}%`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="muted small">
          关联一个数据源后，这里会显示带阶段色带的指标图。
        </p>
      )}
      <div className="cycle-events">
        {events.slice(0, 8).map((e) => (
          <div className="compact-event" key={e.id}>
            <span className="event-point" />
            <div>
              <small>{String(e.data.date || "日期待补充").slice(0, 10)}</small>
              <b>{e.title}</b>
            </div>
          </div>
        ))}
        {!events.length && (
          <p className="muted padded">还没有事件挂到这个周期。</p>
        )}
      </div>
    </section>
  );
}
