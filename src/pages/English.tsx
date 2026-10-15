import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  Headphones,
  Plus,
  Upload,
  Play,
  Pause,
  Repeat2,
  Mic,
  Square,
  BookOpen,
  Check,
  Volume2,
  ChevronLeft,
  ChevronRight,
  Download,
  Clock3,
  Trash2,
  Globe2,
  ExternalLink,
  Pencil,
} from "lucide-react";
import { useEntries, dateLabel } from "../lib/hooks";
import {
  upload,
  assetUrl,
  save,
  dictionary,
  remove,
  command,
  remote,
  native,
  synchronize,
  learningCommand,
  registerFlush,
  registerDirty,
} from "../lib/db";
import {
  parseTranscript,
  reviewCard,
  clock,
  distributeTimeline,
} from "../lib/learning";
import { useSpeechQueue, englishVoices } from "../lib/tts";
import {
  Modal,
  Empty,
  Field,
  ErrorBox,
  Busy,
  ConfirmModal,
  PromptModal,
} from "../components/ui";
import type { Entry, Segment, Asset } from "../types";
import { starterChinese, translateText } from "../lib/translation";
const News = lazy(() => import("./News"));

export default function English() {
  const lessons = useEntries("lesson"),
    words = useEntries("word"),
    sessions = useEntries("session", "", 1000),
    reviews = useEntries("review", "", 1000);
  const [selected, setSelected] = useState(""),
    [tab, setTab] = useState<"lessons" | "words" | "resources" | "news">(
      "lessons",
    ),
    [importing, setImporting] = useState(false),
    [error, setError] = useState("");
  const lesson = lessons.rows.find((l) => l.id === selected) || lessons.rows[0];
  const today = new Date().toLocaleDateString("en-CA");
  const todaySeconds = sessions.rows
    .filter(
      (s) => new Date(s.data.startedAt).toLocaleDateString("en-CA") === today,
    )
    .reduce((n, s) => n + (s.data.seconds || 0), 0);
  const due = words.rows.filter(
    (w) => !w.data.card?.due || new Date(w.data.card.due) <= new Date(),
  );
  return (
    <div className="page english-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE, EVERY DAY</div>
          <h1>
            英语，让每天都有一点进步<span className="title-dot">.</span>
          </h1>
          <p>听懂一句，跟读一句。用熟悉的节奏，积累真实的进步。</p>
        </div>
        <button className="primary" onClick={() => setImporting(true)}>
          <Plus size={17} />
          导入课程
        </button>
      </div>
      <ErrorBox message={error || lessons.error} />
      <div className="learning-stats">
        <div>
          <Clock3 size={20} />
          <span>
            今日学习
            <strong>
              {Math.floor(todaySeconds / 60)} <small>/ 20 分钟</small>
            </strong>
          </span>
          <div className="progress-line">
            <i
              style={{
                width: `${Math.min(100, (todaySeconds / 1200) * 100)}%`,
              }}
            />
          </div>
        </div>
        <div>
          <BookOpen size={20} />
          <span>
            我的词汇
            <strong>
              {words.rows.length}
              <small> 个词</small>
            </strong>
          </span>
        </div>
        <div>
          <Repeat2 size={20} />
          <span>
            待复习
            <strong>
              {due.length}
              <small> 个词</small>
            </strong>
          </span>
        </div>
        <div>
          <Check size={20} />
          <span>
            复习记录
            <strong>
              {reviews.rows.length}
              <small> 次</small>
            </strong>
          </span>
        </div>
      </div>
      <div className="tabs">
        <button
          className={tab === "news" ? "active" : ""}
          onClick={() => setTab("news")}
        >
          <Globe2 size={16} />
          每日英文新闻
        </button>
        <button
          className={tab === "resources" ? "active" : ""}
          onClick={() => setTab("resources")}
        >
          <Globe2 size={16} />
          公开学习资料
        </button>
        <button
          className={tab === "lessons" ? "active" : ""}
          onClick={() => setTab("lessons")}
        >
          <Headphones size={16} />
          课程与跟读
        </button>
        <button
          className={tab === "words" ? "active" : ""}
          onClick={() => setTab("words")}
        >
          <BookOpen size={16} />
          生词与复习 <span className="count-badge">{due.length}</span>
        </button>
      </div>
      {tab === "lessons" &&
        (lesson ? (
          <div className="lesson-layout">
            <aside className="lesson-list">
              {lessons.rows.map((l) => (
                <button
                  key={l.id}
                  className={l.id === lesson.id ? "selected" : ""}
                  onClick={() => setSelected(l.id)}
                >
                  <span className="lesson-icon">
                    <Headphones size={20} />
                  </span>
                  <div>
                    <b>{l.title}</b>
                    <small>
                      {l.data.segments?.length || 0} 句 ·{" "}
                      {l.data.completed ? "已完成" : "学习中"}
                    </small>
                  </div>
                </button>
              ))}
            </aside>
            <LessonPlayer key={lesson.id} lesson={lesson} onError={setError} />
          </div>
        ) : (
          <Empty
            icon={<Headphones size={32} />}
            title="从一段你喜欢的对话开始"
            description="导入自有音频和课文，或下载有授权的资源。支持 MP3、M4A、SRT、LRC 和 TXT，下载后可离线学习。"
            action={
              <button className="primary" onClick={() => setTab("resources")}>
                <Download size={16} />
                选择免费入门课程
              </button>
            }
          />
        ))}
      {tab === "words" && <WordReview words={words.rows} onError={setError} />}
      {tab === "news" && (
        <Suspense fallback={<Busy />}>
          <News />
        </Suspense>
      )}
      {tab === "resources" && (
        <LearningResources
          lessons={lessons.rows}
          onOpen={(l) => {
            setSelected(l.id);
            setTab("lessons");
          }}
        />
      )}
      {importing && (
        <ImportLesson
          onClose={() => setImporting(false)}
          onDone={(l) => {
            setSelected(l.id);
            setImporting(false);
          }}
        />
      )}
    </div>
  );
}

function LearningResources({
  lessons,
  onOpen,
}: {
  lessons: Entry[];
  onOpen: (lesson: Entry) => void;
}) {
  const [catalog, setCatalog] = useState<any>(null),
    [collection, setCollection] = useState("voa"),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [batch, setBatch] = useState<{ done: number; total: number; current: string } | null>(null);
  const batchStop = useRef(false);
  useEffect(() => {
    void learningCommand({ op: "learning_catalog" })
      .then(setCatalog)
      .catch((e) => setError(String(e)));
  }, []);
  async function downloadAll() {
    const pending = catalog.courses.filter(
      (c: any) =>
        c.collection === collection && !lessons.find((l) => l.id === c.id),
    );
    if (!pending.length) {
      setError("");
      setBatch(null);
      return;
    }
    batchStop.current = false;
    const failures: string[] = [];
    for (let i = 0; i < pending.length; i++) {
      if (batchStop.current) break;
      const course = pending[i];
      setBatch({ done: i, total: pending.length, current: course.title });
      try {
        await learningCommand({ op: "learning_download", id: course.id });
      } catch (e) {
        failures.push(`${course.title}：${String(e)}`);
      }
    }
    setBatch(null);
    setError(failures.join("；"));
  }
  return (
    <section className="resource-library">
      <div className="resource-intro surface">
        <div>
          <span className="eyebrow">LISTEN · DOWNLOAD · LEARN</span>
          <h2>每天一课，从日常对话开始</h2>
          <p>
            VOA 完整 52 课与 ELLLO A1 完整 25
            课，按需下载音频和课文；更多日常对话、英式播客与有声书入口也整理在下方。
          </p>
          <p className="muted small">
            无需账号或个人服务器。原文没有时间轴，逐句循环前需手工校准；可先完整听读。
          </p>
        </div>
        <span className="resource-level">
          A1–A2<span>入门英语</span>
        </span>
      </div>
      <ErrorBox message={error} />
      {!catalog ? (
        <Busy text="正在打开课程目录" />
      ) : (
        <>
          <div className="section-heading">
            <select
              aria-label="课程来源"
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
            >
              {catalog.collections?.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.count} 课
                </option>
              ))}
            </select>
            <input
              className="small-input"
              aria-label="筛选公开课程"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按课题搜索…"
            />
            <button
              className="soft-button"
              disabled={!!busy || !!batch}
              onClick={() =>
                batch ? (batchStop.current = true) : void downloadAll()
              }
            >
              <Download size={14} />
              {batch
                ? `下载中 ${batch.done + 1}/${batch.total} · 点击暂停`
                : "下载本来源全部课程"}
            </button>
          </div>
          {batch && (
            <p role="status" className="translation-status">
              正在下载 {batch.done + 1}/{batch.total}：{batch.current}
            </p>
          )}
          <p className="muted">
            {
              catalog.collections?.find((c: any) => c.id === collection)
                ?.description
            }{" "}
            · 音频 + 英文课文 · 可生成中文对照
          </p>
          <div className="resource-grid">
            {catalog.courses
              .filter(
                (c: any) =>
                  c.collection === collection &&
                  `${c.title} ${c.description}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .map((course: any) => {
                const existing = lessons.find((l) => l.id === course.id);
                return (
                  <article className="resource-card surface" key={course.id}>
                    <div className="resource-number">
                      {String(course.number).padStart(2, "0")}
                      <span>
                        {existing ? "已下载 · 可离线" : "免费 · 音频 + 课文"}
                      </span>
                    </div>
                    <h3>{course.description}</h3>
                    <p>{course.title}</p>
                    <div className="resource-actions">
                      <a
                        href={course.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        官方原文 <ExternalLink size={12} />
                      </a>
                      <button
                        className={existing ? "soft-button" : "primary"}
                        disabled={!!busy || !!batch}
                        onClick={async () => {
                          if (existing) {
                            onOpen(existing);
                            return;
                          }
                          setBusy(course.id);
                          setError("");
                          try {
                            onOpen(
                              await learningCommand({
                                op: "learning_download",
                                id: course.id,
                              }),
                            );
                          } catch (e) {
                            setError(`下载未完成：${String(e)}`);
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        {busy === course.id
                          ? "正在下载…"
                          : existing
                            ? "开始学习"
                            : "下载并学习"}
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
          <h3>更多公开资料 · 从官网下载后导入</h3>
          <div className="resource-grid">
            {catalog.libraries?.map((library: any) => (
              <article className="resource-card surface" key={library.name}>
                <span className="badge">{library.category}</span>
                <h3>{library.name}</h3>
                <p>{library.description}</p>
                <a href={library.sourceUrl} target="_blank" rel="noreferrer">
                  浏览官网与下载入口 <ExternalLink size={14} />
                </a>
              </article>
            ))}
          </div>
          <p className="muted small">
            各来源保留自己的许可。资料按需下载到个人资料库，机器辅助译文用于理解，可逐句修正；新概念教材可从右上角导入自有文件。
          </p>
        </>
      )}
    </section>
  );
}

function ImportLesson({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (r: Entry) => void;
}) {
  const [title, setTitle] = useState(""),
    [audio, setAudio] = useState<File | null>(null),
    [text, setText] = useState(""),
    [format, setFormat] = useState<"srt" | "lrc" | "txt">("txt"),
    [url, setUrl] = useState(""),
    [source, setSource] = useState(""),
    [license, setLicense] = useState("个人自有资料"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="导入英语课程" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (!audio && !url)
              throw new Error("请选择音频文件或提供授权下载链接");
            if (!title.trim()) throw new Error("请填写课程名称");
            const segments = parseTranscript(text, format);
            let asset: Asset;
            if (audio) asset = await upload(audio);
            else {
              if (native) {
                asset = await remote({
                  op: "download",
                  url,
                  name: `${title}.mp3`,
                });
                await synchronize();
              } else
                asset = await command({
                  op: "download",
                  url,
                  name: `${title}.mp3`,
                });
            }
            const r = await save({
              kind: "lesson",
              title,
              data: {
                audio: asset,
                segments,
                format,
                needsCalibration: format === "txt",
                sourceUrl: source || url,
                license,
                completed: false,
              },
            });
            onDone(r);
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="课程名称">
          <input
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：新概念 · Lesson 1"
          />
        </Field>
        <div className="two-col compact">
          <Field label="本地音频">
            <input
              type="file"
              accept="audio/*,.mp3,.m4a"
              onChange={(e) => setAudio(e.target.files?.[0] || null)}
            />
          </Field>
          <Field label="字幕或课文文件">
            <input
              type="file"
              accept=".txt,.srt,.lrc"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setText(await f.text());
                  setFormat(
                    f.name.endsWith(".srt")
                      ? "srt"
                      : f.name.endsWith(".lrc")
                        ? "lrc"
                        : "txt",
                  );
                }
              }}
            />
          </Field>
        </div>
        <Field
          label="或填写可下载的音频链接"
          hint="链接下载由个人服务器执行；请使用自己有权下载的资源。"
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <Field label="课文 / 字幕">
          <textarea
            required
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="每行一句，或粘贴完整 SRT/LRC 字幕"
          />
        </Field>
        <Field label="文本格式">
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as any)}
          >
            <option value="txt">TXT · 需手工校准时间</option>
            <option value="srt">SRT · 自带时间轴</option>
            <option value="lrc">LRC · 自带时间轴</option>
          </select>
        </Field>
        <div className="two-col compact">
          <Field label="出处链接">
            <input
              type="url"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </Field>
          <Field label="许可 / 使用依据">
            <input
              required
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            />
          </Field>
        </div>
        <ErrorBox message={error} />
        <div className="modal-actions">
          <button type="button" className="soft-button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "正在导入…" : "保存并开始学习"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LessonPlayer({
  lesson,
  onError,
}: {
  lesson: Entry;
  onError: (e: string) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]),
    current = useRef(lesson),
    segmentsRef = useRef<Segment[]>(lesson.data.segments || []);
  const [url, setUrl] = useState(""),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(0),
    [rate, setRate] = useState(1),
    [loop, setLoop] = useState(false),
    [selected, setSelected] = useState(0),
    [recording, setRecording] = useState(false),
    [recordings, setRecordings] = useState<Asset[]>(
      lesson.data.recordings || [],
    ),
    [playback, setPlayback] = useState(""),
    [word, setWord] = useState(""),
    [wordSentence, setWordSentence] = useState(""),
    [wordOpen, setWordOpen] = useState(false),
    [calibrating, setCalibrating] = useState(false),
    [playbackIndex, setPlaybackIndex] = useState(-1),
    [renameOpen, setRenameOpen] = useState(false),
    [confirmDeleteCourse, setConfirmDeleteCourse] = useState(false),
    [confirmDeleteRecording, setConfirmDeleteRecording] = useState(false),
    [bilingual, setBilingual] = useState(true),
    [translating, setTranslating] = useState(false),
    [translationStatus, setTranslationStatus] = useState(""),
    [segments, setSegments] = useState<Segment[]>(lesson.data.segments || []),
    [readRate, setReadRate] = useState(1),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [voiceURI, setVoiceURI] = useState(""),
    [loopSentence, setLoopSentence] = useState(false);
  const elapsed = useRef(0),
    session = useRef<Entry | null>(null),
    startedAt = useRef(new Date().toISOString()),
    sessionQueue = useRef(Promise.resolve()),
    playingRef = useRef(false),
    recordingRef = useRef(false),
    readingRef = useRef(false);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const speech = useSpeechQueue(segments.map((s) => s.text));
  const patchQueue = useRef(Promise.resolve());
  const sessionError = useRef("");
  const recordingSave = useRef<Promise<void>>(Promise.resolve());
  const finishRecording = useRef<() => void>(() => {});
  const recordingError = useRef("");
  const translationStop = useRef(false);
  useEffect(
    () => () => {
      translationStop.current = true;
    },
    [],
  );
  async function translateLesson() {
    setTranslating(true);
    translationStop.current = false;
    try {
      let next = [...segmentsRef.current];
      for (let i = 0; i < next.length; i++) {
        if (translationStop.current) break;
        if (next[i].translation) continue;
        setTranslationStatus(`正在生成中文 ${i + 1}/${next.length}`);
        const translation = await translateText(next[i].text);
        if (translationStop.current) break;
        next = next.map((s, j) => (j === i ? { ...s, translation } : s));
        segmentsRef.current = next;
        setSegments(next);
        await patch({
          segments: next,
          translationProvider: "MyMemory / 人工校订",
        });
      }
      setTranslationStatus(
        translationStop.current
          ? "已暂停，已生成的中文已保存"
          : "中文对照已保存，可离线阅读",
      );
    } catch (e) {
      setTranslationStatus(
        `部分中文尚未生成：${String(e)}。已完成部分保留，可重试。`,
      );
    } finally {
      setTranslating(false);
    }
  }
  const active = segments.findIndex(
    (s) => position >= s.start && position < s.end,
  );
  // Calibration and translation edits share one source of truth so a flush on
  // navigation persists them and neither path overwrites the other.
  const editSegments = (next: Segment[]) => {
    segmentsRef.current = next;
    setSegments(next);
  };
  async function persistSession() {
    if (elapsed.current < 1) return;
    sessionQueue.current = sessionQueue.current
      .catch(() => {})
      .then(async () => {
        try {
          session.current = await save({
            ...session.current,
            kind: "session",
            title: lesson.title,
            data: {
              lessonId: lesson.id,
              startedAt: startedAt.current,
              seconds: elapsed.current,
            },
          });
          sessionError.current = "";
        } catch (e) {
          sessionError.current = String(e);
          onError(String(e));
        }
      });
    return sessionQueue.current;
  }
  useEffect(() => {
    const unregister = registerFlush(async () => {
      translationStop.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      await recordingSave.current;
      if (recordingError.current) throw new Error(recordingError.current);
      await patchQueue.current;
      if (
        JSON.stringify(segmentsRef.current) !==
        JSON.stringify(current.current.data.segments)
      )
        await patch({ segments: segmentsRef.current });
      await persistSession();
      if (sessionError.current) throw new Error(sessionError.current);
    });
    const unregisterDirty = registerDirty(
      () =>
        JSON.stringify(segmentsRef.current) !==
        JSON.stringify(current.current.data.segments),
    );
    void assetUrl(lesson.data.audio)
      .then(setUrl)
      .catch((e) => onError(String(e)));
    const timer = setInterval(() => {
      if (playingRef.current || recordingRef.current || readingRef.current) {
        elapsed.current++;
        if (elapsed.current % 30 === 0) void persistSession();
      }
    }, 1000);
    return () => {
      unregister();
      unregisterDirty();
      clearInterval(timer);
      void persistSession();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    playingRef.current = playing;
    recordingRef.current = recording;
  }, [playing, recording]);
  useEffect(() => {
    readingRef.current = speech.reading;
  }, [speech.reading]);
  useEffect(() => {
    speech.setRate(readRate);
    speech.setLoop(loopSentence);
    speech.setVoice(voices.find((v) => v.voiceURI === voiceURI) || null);
  });
  useEffect(() => {
    const load = () => {
      const list = englishVoices();
      if (!list.length) return;
      setVoices(list);
      setVoiceURI(
        (current) =>
          current ||
          list.find((v) => v.lang === "en-US")?.voiceURI ||
          list[0].voiceURI,
      );
    };
    load();
    if (typeof speechSynthesis !== "undefined")
      speechSynthesis.onvoiceschanged = load;
    return () => {
      if (typeof speechSynthesis !== "undefined")
        speechSynthesis.onvoiceschanged = null;
    };
  }, []);
  useEffect(() => {
    if (!speech.reading || speech.index < 0) return;
    rowRefs.current[speech.index]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [speech.index, speech.reading]);
  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: lesson.title,
        artist: "Cetrinw 英语学习",
      });
      navigator.mediaSession.setActionHandler(
        "play",
        () => void audio.current?.play().catch((e) => onError(String(e))),
      );
      navigator.mediaSession.setActionHandler("pause", () =>
        audio.current?.pause(),
      );
      navigator.mediaSession.setActionHandler("seekbackward", () => {
        if (audio.current)
          audio.current.currentTime = Math.max(
            0,
            audio.current.currentTime - 5,
          );
      });
      navigator.mediaSession.setActionHandler("seekforward", () => {
        if (audio.current) audio.current.currentTime += 5;
      });
    }
    return () => {
      if ("mediaSession" in navigator) {
        for (const a of [
          "play",
          "pause",
          "seekbackward",
          "seekforward",
        ] as MediaSessionAction[])
          navigator.mediaSession.setActionHandler(a, null);
      }
    };
  }, []);
  async function patch(data: any) {
    patchQueue.current = patchQueue.current
      .catch(() => {})
      .then(async () => {
        current.current = await save({
          ...current.current,
          data: { ...current.current.data, ...data },
        });
      });
    try {
      await patchQueue.current;
    } catch (e) {
      onError(String(e));
      throw e;
    }
  }
  async function record() {
    speech.stop();
    try {
      if (recording) {
        recorder.current?.stop();
        return;
      }
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const r = new MediaRecorder(
        stream.current,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = r;
      recordingError.current = "";
      recordingSave.current = new Promise<void>((resolve) => {
        finishRecording.current = resolve;
      });
      chunks.current = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.onstop = async () => {
        setRecording(false);
        recordingRef.current = false;
        stream.current?.getTracks().forEach((t) => t.stop());
        try {
          const blob = new Blob(chunks.current, { type: r.mimeType });
          const asset = await upload(
            new File(
              [blob],
              `${lesson.title}-跟读-${new Date().toISOString().slice(0, 19)}.${r.mimeType.includes("mp4") ? "m4a" : "webm"}`,
              { type: r.mimeType },
            ),
          );
          const next = [...(current.current.data.recordings || []), asset];
          setRecordings(next);
          await patch({ recordings: next });
          setPlayback(await assetUrl(asset));
          setPlaybackIndex(next.length - 1);
          await persistSession();
        } catch (e) {
          recordingError.current = String(e);
          onError(String(e));
        } finally {
          finishRecording.current();
        }
      };
      r.start();
      setRecording(true);
      recordingRef.current = true;
    } catch (e) {
      onError(`无法开始录音：${String(e)}。请检查系统麦克风权限。`);
    }
  }
  function seek(i: number) {
    if (!audio.current || !segments[i]) return;
    setSelected(i);
    audio.current.currentTime = segments[i].start;
    void audio.current.play().catch((e) => onError(String(e)));
  }
  return (
    <section className="lesson-player surface">
      <div className="player-heading">
        <div className="eyebrow">SHADOWING PRACTICE</div>
        <div className="section-heading">
          <h2>{lesson.title}</h2>
          <div className="inline">
            <button
              className="icon-button"
              title="重命名课程"
              aria-label="重命名课程"
              onClick={() => setRenameOpen(true)}
            >
              <Pencil size={15} />
            </button>
            <button
              className="soft-button"
              onClick={() => setCalibrating(!calibrating)}
            >
              校准时间轴
            </button>
          </div>
        </div>
        <p className="muted">
          {lesson.data.license} · {segments.length} 个句子
          {lesson.data.needsCalibration && (
            <span className="badge amber">TXT 时间轴待校准</span>
          )}
        </p>
        {lesson.data.sourceUrl && (
          <a
            className="small"
            href={lesson.data.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            课程原文与出处 <ExternalLink size={12} />
          </a>
        )}
      </div>
      <audio
        ref={audio}
        src={url || undefined}
        onLoadedMetadata={() => setDuration(audio.current?.duration || 0)}
        onPlay={() => {
          speech.pause();
          setPlaying(true);
        }}
        onPause={() => {
          setPlaying(false);
          void persistSession();
        }}
        onEnded={() => {
          setPlaying(false);
          void persistSession();
        }}
        onTimeUpdate={() => {
          const a = audio.current!;
          setPosition(a.currentTime);
          if (
            loop &&
            segments[selected] &&
            a.currentTime >= segments[selected].end
          )
            a.currentTime = segments[selected].start;
        }}
        onError={() => onError("音频无法播放，请检查附件或音频格式。")}
      />
      <div className="audio-controls">
        <button
          className="round-play"
          aria-label={playing ? "暂停原音" : "播放原音"}
          disabled={!url}
          onClick={() => {
            if (playing) audio.current?.pause();
            else void audio.current?.play().catch((e) => onError(String(e)));
          }}
        >
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <div className="audio-progress">
          <input
            aria-label="播放进度"
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={position}
            onChange={(e) => {
              audio.current!.currentTime = Number(e.target.value);
              setPosition(Number(e.target.value));
            }}
          />
          <div>
            <span>{clock(position)}</span>
            <span>{clock(duration)}</span>
          </div>
        </div>
        <select
          aria-label="播放速度"
          value={rate}
          onChange={(e) => {
            setRate(Number(e.target.value));
            audio.current!.playbackRate = Number(e.target.value);
          }}
        >
          {[0.5, 0.75, 1, 1.25, 1.5].map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <button
          className={`icon-button ${loop ? "active" : ""}`}
          title="循环所选句子"
          aria-label="循环所选句子"
          onClick={() => setLoop(!loop)}
        >
          <Repeat2 size={19} />
        </button>
      </div>
      <div className="read-along-bar">
        <button
          className="primary"
          disabled={!segments.length}
          onClick={() => {
            if (speech.reading) speech.pause();
            else {
              audio.current?.pause();
              speech.start(speech.index >= 0 ? speech.index : 0);
            }
          }}
        >
          {speech.reading ? <Pause size={15} /> : <Play size={15} />}
          {speech.reading
            ? "暂停朗读"
            : speech.index >= 0
              ? "继续朗读"
              : "整课朗读"}
        </button>
        <label>
          语速
          <select
            aria-label="朗读语速"
            value={readRate}
            onChange={(e) => setReadRate(Number(e.target.value))}
          >
            {[0.7, 0.8, 0.9, 1, 1.1, 1.2].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        {voices.length > 0 && (
          <label>
            语音
            <select
              aria-label="朗读语音"
              value={voiceURI}
              onChange={(e) => setVoiceURI(e.target.value)}
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} · {v.lang}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={loopSentence}
            onChange={(e) => setLoopSentence(e.target.checked)}
          />
          单句循环
        </label>
        <small>系统语音朗读，离线可用；点句尾喇叭只读这一句。</small>
      </div>
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
            translating
              ? (translationStop.current = true)
              : void translateLesson()
          }
        >
          {translating ? "暂停生成" : "生成 / 补全中文"}
        </button>
        <small>
          优先使用本地离线模型；未就绪时使用 MyMemory 公共接口（有额度限制）。译文可编辑。
        </small>
      </div>
      {translationStatus && (
        <p className="translation-status" role="status">
          {translationStatus}
        </p>
      )}
      <div className="transcript">
        {segments.map((s, i) => (
          <div
            key={s.id}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            className={`transcript-row ${active === i ? "current" : ""} ${selected === i ? "selected" : ""} ${speech.index === i && speech.reading ? "reading" : ""}`}
          >
            <button className="sentence-time" onClick={() => seek(i)}>
              {active === i && playing ? (
                <Volume2 size={15} />
              ) : (
                <span>{clock(s.start)}</span>
              )}
            </button>
            <div className="sentence-body">
              <p>
                {s.text
                  .split(/([a-zA-Z]+(?:['’-][a-zA-Z]+)*)/)
                  .map((part, j) =>
                    /[a-zA-Z]/.test(part) ? (
                      <button
                        className="word"
                        key={j}
                        onClick={() => {
                          setWord(part.toLowerCase());
                          setWordSentence(s.text);
                          setWordOpen(true);
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
                    aria-label={`第${i + 1}句中文`}
                    placeholder="中文对照 · 可生成或手工填写"
                    rows={2}
                    value={s.translation || starterChinese[s.text] || ""}
                    onChange={(e) => {
                      const next = segmentsRef.current.map((item, j) =>
                        j === i
                          ? { ...item, translation: e.target.value }
                          : item,
                      );
                      segmentsRef.current = next;
                      setSegments(next);
                    }}
                    onBlur={() => void patch({ segments: segmentsRef.current })}
                  />
                )}
                <button
                  className={`sentence-speak ${speech.index === i && !speech.reading ? "active" : ""}`}
                  aria-label="朗读这句"
                  title="朗读这句"
                  onClick={() => speech.speakOnly(i)}
                >
                  <Volume2 size={13} />
                </button>
            </div>
            {calibrating && (
              <div className="segment-times">
                <input
                  aria-label={`第${i + 1}句开始秒数`}
                  type="number"
                  min="0"
                  step="0.1"
                  value={s.start}
                  onChange={(e) =>
                    editSegments(
                      segmentsRef.current.map((v, j) =>
                        i === j ? { ...v, start: Number(e.target.value) } : v,
                      ),
                    )
                  }
                />
                <span>—</span>
                <input
                  aria-label={`第${i + 1}句结束秒数`}
                  type="number"
                  min="0"
                  step="0.1"
                  value={s.end}
                  onChange={(e) =>
                    editSegments(
                      segmentsRef.current.map((v, j) =>
                        i === j ? { ...v, end: Number(e.target.value) } : v,
                      ),
                    )
                  }
                />
                <button
                  onClick={() =>
                    editSegments(
                      segmentsRef.current.map((v, j) =>
                        i === j ? { ...v, start: position } : v,
                      ),
                    )
                  }
                >
                  当前时间
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {calibrating && (
        <div className="calibration-footer">
          <button
            className="soft-button"
            disabled={!duration}
            title="按每句文字长度占比，把音频总时长分配给全部句子，再手工微调"
            onClick={() =>
              editSegments(distributeTimeline(segmentsRef.current, duration))
            }
          >
            按句长自动分配时间
          </button>
          <button
            className="primary"
            onClick={async () => {
              if (segments.some((s) => s.end <= s.start || s.start < 0)) {
                onError("请确保每句结束时间晚于开始时间");
                return;
              }
              segmentsRef.current = segments;
              await patch({ segments, needsCalibration: false });
              setCalibrating(false);
            }}
          >
            保存时间轴
          </button>
        </div>
      )}
      <div className="shadowing-bar">
        <div>
          <b>轮到你了</b>
          <p>边听边跟读，或暂停原音后录制。录音只用于你的对照练习。</p>
        </div>
        <button
          className={recording ? "record-button recording" : "record-button"}
          onClick={() => void record()}
        >
          {recording ? <Square size={16} /> : <Mic size={17} />}{" "}
          {recording ? "结束录音" : "开始跟读"}
        </button>
      </div>
      {recordings.length > 0 && (
        <div className="recordings">
          <div className="section-heading">
            <h4>我的跟读</h4>
            <select
              aria-label="选择跟读录音"
              value={playbackIndex >= 0 ? String(playbackIndex) : ""}
              onChange={async (e) => {
                const index = Number(e.target.value);
                setPlaybackIndex(index);
                setPlayback(await assetUrl(recordings[index]));
              }}
            >
              <option value="" disabled>
                选择录音
              </option>
              {recordings.map((r, i) => (
                <option key={r.hash} value={i}>
                  第 {i + 1} 次 · {r.name}
                </option>
              ))}
            </select>
          </div>
          {playback && <audio controls src={playback} />}
          {playbackIndex >= 0 && (
            <button
              className="text-button danger"
              onClick={() => setConfirmDeleteRecording(true)}
            >
              <Trash2 size={14} />
              删除这条录音
            </button>
          )}
        </div>
      )}
      <footer className="lesson-footer">
        <button
          className="text-button"
          onClick={() => seek(Math.max(0, selected - 1))}
        >
          <ChevronLeft size={15} />
          上一句
        </button>
        <button
          className="soft-button"
          onClick={async () => {
            await patch({ completed: true });
            await persistSession();
          }}
        >
          标记课程完成 <Check size={15} />
        </button>
        <button
          className="text-button"
          onClick={() => seek(Math.min(segments.length - 1, selected + 1))}
        >
          下一句
          <ChevronRight size={15} />
        </button>
        <button
          className="text-button danger"
          onClick={() => setConfirmDeleteCourse(true)}
        >
          <Trash2 size={14} />
          删除课程
        </button>
      </footer>
      {wordOpen && (
        <WordLookup
          word={word}
          sentence={wordSentence}
          lessonId={lesson.id}
          onClose={() => setWordOpen(false)}
        />
      )}
      {renameOpen && (
        <PromptModal
          title="重命名课程"
          label="课程名称"
          defaultValue={lesson.title}
          onSubmit={async (value) => {
            const title = value.trim();
            if (!title) throw new Error("请填写课程名称");
            current.current = await save({ ...current.current, title });
          }}
          onClose={() => setRenameOpen(false)}
        />
      )}
      {confirmDeleteCourse && (
        <ConfirmModal
          title="删除课程"
          message={`删除课程「${lesson.title}」？学习记录与生词保留，可在设置页的回收站恢复。`}
          confirmLabel="移入回收站"
          danger
          onConfirm={async () => {
            await remove(lesson.id);
          }}
          onClose={() => setConfirmDeleteCourse(false)}
        />
      )}
      {confirmDeleteRecording && playbackIndex >= 0 && (
        <ConfirmModal
          title="删除跟读录音"
          message="从这门课程中移除这条录音？已上传的附件文件仍保留在本地资料库。"
          confirmLabel="删除录音"
          danger
          onConfirm={async () => {
            const next = recordings.filter((_, i) => i !== playbackIndex);
            setRecordings(next);
            setPlayback("");
            setPlaybackIndex(-1);
            await patch({ recordings: next });
          }}
          onClose={() => setConfirmDeleteRecording(false)}
        />
      )}
    </section>
  );
}

export function WordLookup({
  word,
  sentence,
  lessonId,
  onClose,
}: {
  word: string;
  sentence: string;
  lessonId?: string;
  onClose: () => void;
}) {
  const [meaning, setMeaning] = useState(""),
    [phonetic, setPhonetic] = useState(""),
    [source, setSource] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let stop = false;
    void dictionary(word)
      .then((raw: any) => {
        if (stop) return;
        if (raw.translation) {
          setMeaning(
            raw.translation + (raw.definition ? `\n${raw.definition}` : ""),
          );
          setPhonetic(raw.phonetic || "");
          setSource(raw.source || "离线词典");
        } else {
          const entry = raw[0];
          setMeaning(
            (entry?.meanings || [])
              .flatMap((m: any) =>
                m.definitions
                  .slice(0, 2)
                  .map((d: any) => `${m.partOfSpeech}. ${d.definition}`),
              )
              .join("\n"),
          );
          setPhonetic(entry?.phonetic || "");
          setSource("Free Dictionary API · 英英释义");
        }
      })
      .catch((e) => {
        if (!stop) setError(String(e));
      })
      .finally(() => {
        if (!stop) setBusy(false);
      });
    return () => {
      stop = true;
    };
  }, [word]);
  return (
    <Modal title={word} onClose={onClose}>
      <div className="word-phonetic">
        {phonetic}
        <button
          className="icon-button"
          aria-label="朗读单词"
          onClick={() => {
            const u = new SpeechSynthesisUtterance(word);
            u.lang = "en-US";
            speechSynthesis.speak(u);
          }}
        >
          <Volume2 size={18} />
        </button>
      </div>
      {busy && <Busy text="正在查词" />}
      <ErrorBox message={error} />
      <Field label="释义（可补充中文）">
        <textarea
          rows={5}
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
        />
      </Field>
      <blockquote>{sentence}</blockquote>
      <small className="muted">{source || "手工释义"}</small>
      <div className="modal-actions">
        <button
          className="primary"
          disabled={!meaning.trim() || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await save({
                kind: "word",
                title: word,
                data: {
                  meaning,
                  phonetic,
                  sentence,
                  lessonId,
                  source,
                  addedAt: new Date().toISOString(),
                },
              });
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Plus size={16} />
          加入生词本
        </button>
      </div>
    </Modal>
  );
}

function WordReview({
  words,
  onError,
}: {
  words: Entry[];
  onError: (e: string) => void;
}) {
  const [reveal, setReveal] = useState(false),
    [lookup, setLookup] = useState(""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmWord, setConfirmWord] = useState<Entry | null>(null);
  const due = words
    .filter((w) => !w.data.card?.due || new Date(w.data.card.due) <= new Date())
    .sort((a, b) =>
      String(a.data.card?.due || "").localeCompare(
        String(b.data.card?.due || ""),
      ),
    );
  const current = due[0];
  return (
    <>
      <div className="section-heading">
        <h3>间隔复习</h3>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookup.trim()) setOpen(true);
          }}
        >
          <input
            className="small-input"
            placeholder="查询一个单词…"
            aria-label="查询单词"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
          />
          <button className="soft-button">查词</button>
        </form>
      </div>
      {current ? (
        <section className="review-card surface">
          <small>待复习 {due.length} 个 · 按实际回忆情况选择</small>
          <h2>{current.title}</h2>
          <p className="word-phonetic">{current.data.phonetic}</p>
          <blockquote>{current.data.sentence}</blockquote>
          {reveal ? (
            <>
              <p className="word-meaning">{current.data.meaning}</p>
              <div className="rating-buttons">
                {[
                  [1, "忘记"],
                  [2, "困难"],
                  [3, "记得"],
                  [4, "轻松"],
                ].map(([n, label]) => (
                  <button
                    disabled={busy}
                    key={n}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const result = reviewCard(
                          current.data.card,
                          Number(n) as 1 | 2 | 3 | 4,
                        );
                        await save({
                          ...current,
                          data: { ...current.data, card: result.card },
                        });
                        await save({
                          kind: "review",
                          title: current.title,
                          data: {
                            wordId: current.id,
                            card: result.card,
                            log: result.log,
                            reviewedAt: new Date().toISOString(),
                          },
                        });
                        setReveal(false);
                      } catch (e) {
                        onError(String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button className="primary" onClick={() => setReveal(true)}>
              显示释义
            </button>
          )}
        </section>
      ) : (
        <Empty
          icon={<Check size={28} />}
          title={words.length ? "今天的复习已完成" : "建立自己的生词本"}
          description={
            words.length
              ? "之后根据记忆情况安排下一次复习。"
              : "点击课文里的单词，或在这里查询并收藏。"
          }
        />
      )}
      <section className="surface word-list">
        <div className="section-heading">
          <h3>
            全部词汇 <small>{words.length}</small>
          </h3>
        </div>
        {words.map((w) => (
          <div key={w.id}>
            <b>{w.title}</b>
            <span>{w.data.meaning?.split("\n")[0]}</span>
            <small>
              {w.data.card?.due
                ? `下次 ${dateLabel(w.data.card.due)}`
                : "尚未复习"}
            </small>
            <button
              className="icon-button"
              aria-label={`删除单词 ${w.title}`}
              onClick={() => setConfirmWord(w)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </section>
      {open && (
        <WordLookup
          word={lookup.toLowerCase().trim()}
          sentence=""
          onClose={() => setOpen(false)}
        />
      )}
      {confirmWord && (
        <ConfirmModal
          title="删除单词"
          message={`从生词本删除「${confirmWord.title}」？复习记录保留，可在回收站恢复。`}
          confirmLabel="删除"
          danger
          onConfirm={async () => {
            await remove(confirmWord.id);
          }}
          onClose={() => setConfirmWord(null)}
        />
      )}
    </>
  );
}
