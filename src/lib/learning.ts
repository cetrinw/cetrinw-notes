import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card,
  type Grade,
} from "ts-fsrs";
import type { Segment } from "../types";
const time = (s: string) => {
  const p = s.replace(",", ".").split(":").map(Number);
  if (p.some((x) => !Number.isFinite(x))) throw new Error("字幕时间格式不正确");
  return p.length === 3
    ? p[0] * 3600 + p[1] * 60 + p[2]
    : p.length === 2
      ? p[0] * 60 + p[1]
      : p[0];
};
export function parseTranscript(
  text: string,
  format: "srt" | "lrc" | "txt",
): Segment[] {
  const normalized = text.replace(/\r/g, "").replace(/^\uFEFF/, "");
  let result: Segment[] = [];
  if (format === "srt") {
    for (const block of normalized.trim().split(/\n\s*\n/)) {
      const lines = block.split("\n");
      const i = lines.findIndex((l) => l.includes("-->"));
      if (i < 0) continue;
      const [start, end] = lines[i]
        .split("-->")
        .map((v) => time(v.trim().split(" ")[0]));
      const body = lines
        .slice(i + 1)
        .join(" ")
        .replace(/<[^>]*>/g, "")
        .trim();
      if (end <= start || start < 0)
        throw new Error("字幕结束时间必须晚于开始时间");
      if (body)
        result.push({ id: crypto.randomUUID(), start, end, text: body });
    }
  } else if (format === "lrc") {
    for (const line of normalized.split("\n")) {
      const matches = [...line.matchAll(/\[(\d+:\d+(?:\.\d+)?)\]/g)];
      const body = line.replace(/\[[^\]]*\]/g, "").trim();
      for (const m of matches)
        if (body)
          result.push({
            id: crypto.randomUUID(),
            start: time(m[1]),
            end: 0,
            text: body,
          });
    }
    result.sort((a, b) => a.start - b.start);
    result = result.map((r, i) => ({
      ...r,
      end: result[i + 1]?.start ?? r.start + 5,
    }));
  } else {
    result = normalized
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text, i) => ({
        id: crypto.randomUUID(),
        start: i * 5,
        end: (i + 1) * 5,
        text,
      }));
  }
  if (!result.length) throw new Error("没有识别到有效字幕或课文");
  return result.sort((a, b) => a.start - b.start);
}
export function reviewCard(
  stored: Partial<Card> | undefined,
  rating: Grade,
  now = new Date(),
) {
  const card = stored
    ? ({
        ...stored,
        due: new Date(stored.due!),
        last_review: stored.last_review
          ? new Date(stored.last_review)
          : undefined,
      } as Card)
    : createEmptyCard(now);
  return fsrs(generatorParameters({ enable_fuzz: false })).next(
    card,
    now,
    rating,
  );
}
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
/** Spreads sentences across the real audio duration in proportion to their
 * text length, so TXT lessons get a usable starting timeline in one click. */
export function distributeTimeline(
  segments: Segment[],
  duration: number,
): Segment[] {
  if (!segments.length || !Number.isFinite(duration) || duration <= 0)
    return segments;
  const weights = segments.map((s) => Math.max(1, s.text.trim().length));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return segments.map((s, i) => {
    const start = cursor;
    cursor += (weights[i] / total) * duration;
    const end = i === segments.length - 1 ? duration : cursor;
    return {
      ...s,
      start: Math.round(start * 10) / 10,
      end: Math.round(end * 10) / 10,
    };
  });
}
