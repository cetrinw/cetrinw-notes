import { describe, it, expect } from "vitest";
import {
  alignSeries,
  eventImpacts,
  nearestDate,
  phaseProgress,
  phaseStats,
  rebaseAt,
  rebasePoints,
  unionDates,
} from "./cycles";

const line = (id: string, name: string, points: [string, number][]) => ({
  id,
  name,
  points: points.map(([date, close]) => ({ date, close })),
});

describe("aligning several series onto one axis", () => {
  it("unions the calendars and forward-fills each line", () => {
    const aligned = alignSeries([
      line("a", "上证指数", [
        ["2026-01-05", 3000],
        ["2026-01-06", 3030],
        ["2026-01-08", 3060],
      ]),
      // A benchmark that only starts on the second day must not invent history.
      line("b", "沪深300", [
        ["2026-01-06", 4000],
        ["2026-01-08", 4040],
      ]),
    ]);
    expect(aligned.dates).toEqual(["2026-01-05", "2026-01-06", "2026-01-08"]);
    expect(aligned.lines[0].values).toEqual([3000, 3030, 3060]);
    expect(aligned.lines[1].values).toEqual([null, 4000, 4040]);
  });

  it("carries the last close across a date only one series traded on", () => {
    const aligned = alignSeries([
      line("a", "A", [["2026-01-05", 10]]),
      line("b", "B", [
        ["2026-01-05", 20],
        ["2026-01-06", 21],
      ]),
    ]);
    expect(aligned.lines[0].values).toEqual([10, 10]);
    expect(unionDates([])).toEqual([]);
  });

  it("ignores points without a usable date or value", () => {
    const aligned = alignSeries([
      { id: "a", name: "A", points: [{ date: "", close: 5 }, { date: "2026-01-05" }] },
    ]);
    expect(aligned.dates).toEqual(["2026-01-05"]);
    expect(aligned.lines[0].values).toEqual([null]);
  });
});

describe("rebasing to a common base", () => {
  const aligned = alignSeries([
    line("a", "A", [
      ["2026-01-05", 3000],
      ["2026-01-06", 3150],
    ]),
    line("b", "B", [
      ["2026-01-05", 4000],
      ["2026-01-06", 3800],
    ]),
  ]);

  it("puts series with different price levels on one scale", () => {
    const rebased = rebaseAt(aligned, "2026-01-05");
    expect(rebased.dates).toEqual(["2026-01-05", "2026-01-06"]);
    expect(rebased.lines[0].values).toEqual([100, 105]);
    expect(rebased.lines[1].values).toEqual([100, 95]);
  });

  it("drops observations before the base date", () => {
    const rebased = rebaseAt(aligned, "2026-01-06");
    expect(rebased.dates).toEqual(["2026-01-06"]);
    expect(rebased.lines[0].values).toEqual([100]);
  });

  it("returns an empty frame rather than throwing when the base is out of range", () => {
    const rebased = rebaseAt(aligned, "2027-01-01");
    expect(rebased.dates).toEqual([]);
    expect(rebased.lines[0].values).toEqual([]);
  });

  it("leaves a line null when it has no observation at or after the base", () => {
    const rebased = rebaseAt(aligned, "2026-01-05");
    const late = rebaseAt(
      alignSeries([
        line("a", "A", [["2026-01-05", 10]]),
        line("b", "B", [["2026-01-07", 20]]),
      ]),
      "2026-01-06",
    );
    expect(rebased.lines.length).toBe(2);
    expect(late.lines[1].values).toEqual([100]);
  });
});

describe("phase statistics", () => {
  const aligned = alignSeries([
    line("a", "A", [
      ["2026-01-05", 100],
      ["2026-03-02", 120],
      ["2026-06-01", 90],
    ]),
  ]);
  const phases = [
    { id: "p1", name: "主动补库", start: "2026-01-05", end: "2026-03-01" },
    { id: "p2", name: "被动补库", start: "2026-03-02", end: "2026-06-01" },
  ];

  it("computes each phase's return for every line", () => {
    const stats = phaseStats(phases, aligned, []);
    expect(stats[0].returns[0].percent).toBeCloseTo(0, 5);
    expect(stats[1].returns[0].percent).toBeCloseTo(-25, 5);
  });

  it("reports duration in days and counts events by phase link first", () => {
    const stats = phaseStats(phases, aligned, [
      { date: "2026-01-20", phaseId: "p1" },
      { date: "2026-02-01" }, // no link, falls inside p1 by date
      { date: "2026-04-01", phaseId: "p2" },
      { date: "2026-04-02", phaseId: "p1" }, // explicit link wins over the range
    ]);
    expect(stats[0].events).toBe(3);
    expect(stats[1].events).toBe(1);
    expect(stats[0].days).toBe(55);
  });

  it("never reports a null return as zero", () => {
    const stats = phaseStats(
      [{ id: "p1", name: "空", start: "2030-01-01", end: "2030-02-01" }],
      aligned,
      [],
    );
    expect(stats[0].returns[0].percent).toBeNull();
  });
});

describe("rebasing raw points for the chart", () => {
  it("rebases to 100 at the base date and drops earlier observations", () => {
    expect(
      rebasePoints(
        [
          { date: "2026-01-04", close: 3800 },
          { date: "2026-01-05", close: 4000 },
          { date: "2026-01-06", close: 4200 },
        ],
        "2026-01-05",
      ),
    ).toEqual([
      { date: "2026-01-05", close: 100 },
      { date: "2026-01-06", close: 105 },
    ]);
  });

  it("returns nothing rather than throwing when the base is out of range", () => {
    expect(
      rebasePoints([{ date: "2026-01-05", close: 10 }], "2027-01-01"),
    ).toEqual([]);
  });
});

describe("event impact windows", () => {
  const aligned = alignSeries([
    line("a", "沪深300", [
      ["2026-01-05", 100],
      ["2026-01-06", 101],
      ["2026-01-07", 102],
      ["2026-01-08", 103],
      ["2026-01-09", 104],
      ["2026-01-12", 105],
      ["2026-01-13", 106],
      ["2026-01-14", 107],
      ["2026-01-15", 108],
      ["2026-01-16", 109],
      ["2026-01-19", 110],
      ["2026-01-20", 111],
    ]),
  ]);

  it("measures the move on real observations, not calendar days", () => {
    const [impact] = eventImpacts(
      [{ id: "e1", date: "2026-01-12", title: "库存见顶" }],
      aligned,
      5,
    );
    // Five observations either side of the 2026-01-12 close.
    expect(impact.moves[0].before).toBe(100);
    expect(impact.moves[0].after).toBe(110);
    expect(impact.moves[0].percent).toBeCloseTo(10, 5);
  });

  it("clamps at the ends instead of inventing observations", () => {
    const [impact] = eventImpacts(
      [{ id: "e2", date: "2026-01-05", title: "序列起点" }],
      aligned,
      5,
    );
    expect(impact.moves[0].before).toBe(100);
    expect(impact.moves[0].after).toBe(105);
    expect(impact.moves[0].percent).toBeCloseTo(5, 5);
  });

  it("drops events with no usable date and never reports a null move as zero", () => {
    expect(eventImpacts([{ id: "e3", title: "无日期" }], aligned)).toEqual([]);
    const [far] = eventImpacts(
      [{ id: "e4", date: "2027-06-01", title: "未来" }],
      aligned,
      5,
    );
    expect(far.moves[0].percent).toBeNull();
  });
});

describe("snapping and phase progress", () => {  it("snaps an event date onto the nearest real observation", () => {
    const dates = ["2026-01-05", "2026-01-08"];
    expect(nearestDate(dates, "2026-01-06")).toBe("2026-01-05");
    expect(nearestDate(dates, "2026-01-07")).toBe("2026-01-08");
    expect(nearestDate(dates, "")).toBe("2026-01-05");
    expect(nearestDate([], "2026-01-06")).toBeUndefined();
  });

  it("describes an open, running and finished phase", () => {
    expect(phaseProgress({ id: "p" }, "2026-05-01").state).toBe("未排期");
    const running = phaseProgress(
      { id: "p", start: "2026-01-01", end: "2026-01-11" },
      "2026-01-06",
    );
    expect(running.state).toBe("进行中");
    expect(running.percent).toBe(50);
    expect(
      phaseProgress({ id: "p", start: "2026-01-01", end: "2026-01-11" }, "2026-02-01")
        .state,
    ).toBe("已结束");
  });
});
