import {
  ArrowUpRight,
  Plus,
  FileText,
  Headphones,
  GitBranch,
  Sun,
  CalendarDays,
  Check,
  ArrowRight,
  Lightbulb,
} from "lucide-react";
import { useEntries, dateLabel } from "../lib/hooks";
import type { Screen } from "../types";
export default function Today({
  navigate,
  newNote,
  openNote,
}: {
  navigate: (s: Screen) => void;
  newNote: () => void;
  openNote: (id: string) => void;
}) {
  const notes = useEntries("note", "", 5),
    topics = useEntries("topic", "", 10),
    events = useEntries("event", "", 4),
    theses = useEntries("thesis", "", 100),
    lessons = useEntries("lesson", "", 5),
    sources = useEntries("source", "", 100);
  const isoToday = new Date().toLocaleDateString("en-CA");
  const dueReviews = theses.rows.filter(
    (t) =>
      t.data.status !== "已复盘" &&
      t.data.reviewAt &&
      String(t.data.reviewAt).slice(0, 10) <= isoToday,
  ).length;
  const now = new Date();
  const date = now.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  return (
    <div className="page today-page">
      <div className="today-date">
        <Sun size={16} />
        {date}
        <span>每一个想法，都值得被认真对待</span>
      </div>
      <div className="today-greeting">
        <div>
          <div className="eyebrow">A SPACE FOR YOUR THINKING</div>
          <h1>
            把好奇，变成自己的知识<span className="title-dot">.</span>
          </h1>
          <p>研究正在发生的事，也为每天的自己，留一点成长的空间。</p>
        </div>
        <div className="hero-mark" aria-hidden="true">
          <div />
          <span>知</span>
          <i />
        </div>
      </div>
      <div className="quick-actions">
        <button onClick={newNote}>
          <span className="action-icon green">
            <FileText size={22} />
          </span>
          <div>
            <b>写下一点想法</b>
            <small>让灵感有处可寻</small>
          </div>
          <Plus size={18} />
        </button>
        <button onClick={() => navigate("research")}>
          <span className="action-icon sand">
            <GitBranch size={22} />
          </span>
          <div>
            <b>继续一项研究</b>
            <small>从资料走向判断</small>
          </div>
          <ArrowUpRight size={18} />
        </button>
        <button onClick={() => navigate("english")}>
          <span className="action-icon lavender">
            <Headphones size={22} />
          </span>
          <div>
            <b>听一段，读一句</b>
            <small>今天也进步一点点</small>
          </div>
          <ArrowUpRight size={18} />
        </button>
      </div>
      <div className="today-columns">
        <div>
          <section className="surface">
            <div className="section-heading">
              <h3>
                最近的笔记{" "}
                <span className="heading-caption">接着上次的思考</span>
              </h3>
              <button className="text-button" onClick={() => navigate("notes")}>
                查看全部 <ArrowUpRight size={15} />
              </button>
            </div>
            {notes.rows.length ? (
              notes.rows.map((n) => (
                <button
                  className="recent-note"
                  key={n.id}
                  onClick={() => openNote(n.id)}
                >
                  <FileText size={19} />
                  <div>
                    <b>{n.title || "未命名笔记"}</b>
                    <small>
                      {n.data.folder || "收件箱"} · {dateLabel(n.updated_at)}
                    </small>
                  </div>
                  <ArrowUpRight size={15} />
                </button>
              ))
            ) : (
              <div className="welcome-note">
                <div className="paper-lines">
                  <i />
                  <i />
                  <i />
                </div>
                <h4>知识从第一句话开始</h4>
                <p>收集一段原文、记录一个问题，或打开空白页自由书写。</p>
                <button className="text-button" onClick={newNote}>
                  创建第一篇笔记 <ArrowRight size={15} />
                </button>
              </div>
            )}
          </section>
          <section className="surface">
            <div className="section-heading">
              <h3>关注的变化</h3>
              <button
                className="text-button"
                onClick={() => navigate("research")}
              >
                研究工作台 <ArrowUpRight size={15} />
              </button>
            </div>
            {events.rows.length ? (
              events.rows.map((e) => (
                <div className="compact-event" key={e.id}>
                  <span className="event-point" />
                  <div>
                    <small>{e.data.date?.slice(0, 10) || "日期待补充"}</small>
                    <b>{e.title}</b>
                    <p>
                      {e.data.status || "待确认"} ·{" "}
                      {e.data.sourceUrl ? "有原文来源" : "来源待补充"}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="quiet-empty horizontal">
                <CalendarDays size={24} />
                <div>
                  <b>还没有新的事件</b>
                  <p>建立研究专题、连接资料源后，在这里查看变化。</p>
                </div>
              </div>
            )}
          </section>
        </div>
        <div>
          <section className="daily-learning">
            <div className="section-heading">
              <span className="eyebrow">DAILY ENGLISH</span>
              <Headphones size={22} />
            </div>
            <h3>
              每天 20 分钟，
              <br />
              慢慢听见自己的进步。
            </h3>
            <p>
              {lessons.rows.length
                ? `继续学习「${lessons.rows[0].title}」`
                : "导入第一节课程，从你感兴趣的内容开始。"}
            </p>
            <button onClick={() => navigate("english")}>
              {lessons.rows.length ? "开始今天的学习" : "准备我的课程"}
              <ArrowRight size={17} />
            </button>
            <div className="waveform" aria-hidden="true">
              {[
                10, 20, 14, 30, 42, 24, 38, 52, 30, 18, 40, 26, 48, 34, 18, 30,
                14, 22, 10, 18, 8,
              ].map((h, i) => (
                <i key={i} style={{ height: h }} />
              ))}
            </div>
          </section>
          <section className="surface small-surface">
            <div className="section-heading">
              <h3>研究备忘</h3>
              <Lightbulb size={17} />
            </div>
            <div className="mini-stat">
              <span>进行中的专题</span>
              <b>{topics.rows.length}</b>
            </div>
            <div className="mini-stat">
              <span>待验证的判断</span>
              <b>
                {theses.rows.filter((t) => t.data.status !== "已复盘").length}
              </b>
            </div>
            <div className="mini-stat">
              <span>已连接数据源</span>
              <b>{sources.rows.length}</b>
            </div>
            <div className="mini-stat">
              <span>采集异常</span>
              <b
                className={
                  sources.rows.some((s) => s.data.status === "failed")
                    ? "danger"
                    : ""
                }
              >
                {sources.rows.filter((s) => s.data.status === "failed").length}
              </b>
            </div>
            <div className="mini-stat">
              <span>到期复盘</span>
              <b className={dueReviews ? "danger" : ""}>{dueReviews}</b>
            </div>
          </section>
          <div className="local-note">
            <span className="dot" />
            <p>
              内容保存在你的设备
              <br />
              <small>让长期积累，也有长期的归属。</small>
            </p>
          </div>
        </div>
      </div>
      <footer className="today-footer">MAKE ROOM FOR WHAT MATTERS.</footer>
    </div>
  );
}
