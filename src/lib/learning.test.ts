import { describe, it, expect } from "vitest";
import { parseTranscript, reviewCard, distributeTimeline } from "./learning";
import { splitForTranslation } from "./translation";
describe("actual subtitle import and spaced review", () => {
  it("imports an SRT dialogue with multiline text and exact timecodes", () => {
    const r = parseTranscript(
      "1\r\n00:00:01,200 --> 00:00:04,500\r\nCould you explain\r\nthe supply chain?\r\n\r\n2\r\n00:00:05,000 --> 00:00:08,100\r\nLet us start with the raw materials.",
      "srt",
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      start: 1.2,
      end: 4.5,
      text: "Could you explain the supply chain?",
    });
    expect(r[1].end).toBe(8.1);
  });
  it("retains repeated LRC timestamps and requires calibration for plain text", () => {
    const r = parseTranscript(
      "[00:01.00][00:08.50]What changed?\n[00:12.00]The latest report explains it.",
      "lrc",
    );
    expect(r.map((x) => x.start)).toEqual([1, 8.5, 12]);
    expect(
      parseTranscript("First sentence.\nSecond sentence.", "txt"),
    ).toHaveLength(2);
  });
  it("rejects invalid subtitle intervals rather than marking a lesson ready", () => {
    expect(() =>
      parseTranscript("1\n00:00:05,000 --> 00:00:02,000\nInvalid", "srt"),
    ).toThrow();
  });
  it("persists FSRS state across JSON roundtrip and records actual graded repetitions", () => {
    const now = new Date("2026-10-10T08:00:00Z");
    const first = reviewCard(undefined, 3, now);
    const second = reviewCard(
      JSON.parse(JSON.stringify(first.card)),
      3,
      new Date(first.card.due),
    );
    expect(second.card.reps).toBe(2);
    expect(second.log.rating).toBe(3);
    expect(second.card.due.getTime()).toBeGreaterThan(first.card.due.getTime());
  });
});
describe("timeline auto-distribution and translation chunking", () => {
  it("distributes TXT lesson time proportionally to sentence length", () => {
    const segments = parseTranscript(
      "Short one.\nA much much much longer sentence that takes more time.",
      "txt",
    );
    const placed = distributeTimeline(segments, 90);
    expect(placed[0].start).toBe(0);
    expect(placed[1].end).toBe(90);
    expect(placed[0].end).toBe(placed[1].start);
    expect(placed[1].end - placed[1].start).toBeGreaterThan(
      placed[0].end - placed[0].start,
    );
    expect(distributeTimeline(segments, 0)).toEqual(segments);
  });
  it("keeps translation chunks within the byte limit even for single long tokens", () => {
    const long = "x".repeat(1000);
    const chunks = splitForTranslation(`hello ${long} world`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks)
      expect(new TextEncoder().encode(c).length).toBeLessThanOrEqual(450);
    expect(chunks.join("")).toContain("hello");
    expect(chunks.join("")).toContain("world");
  });
});
