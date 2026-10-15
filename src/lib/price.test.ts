import { describe, it, expect } from "vitest";
import {
  hasOhlc,
  movingAverage,
  rangeStats,
  toCandles,
  toVolume,
} from "./price";

const bar = (
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
) => ({ date, open, high, low, close, volume });

describe("bar mapping", () => {
  it("detects which series can be drawn as candles", () => {
    expect(hasOhlc([bar("2026-01-05", 10, 12, 9, 11)])).toBe(true);
    expect(hasOhlc([{ date: "2026-01-05", value: 3.2 }])).toBe(false);
  });

  it("drops rows that cannot form a bar and sorts by date", () => {
    const candles = toCandles([
      bar("2026-01-07", 11, 12, 10, 11.5),
      { date: "2026-01-06", close: 11 }, // no OHLC: a macro point
      bar("2026-01-05", 10, 12, 9, 11),
      { date: "", open: 1, high: 1, low: 1, close: 1 },
    ]);
    expect(candles.map((candle) => candle.time)).toEqual([
      "2026-01-05",
      "2026-01-07",
    ]);
    expect(candles[0]).toEqual({
      time: "2026-01-05",
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    });
  });

  it("marks volume bars by the direction of the bar", () => {
    const bars = toVolume([
      bar("2026-01-05", 10, 12, 9, 11, 500), // up
      bar("2026-01-06", 11, 11, 8, 9, 700), // down
      { date: "2026-01-07", close: 9, volume: 0 }, // no volume
    ]);
    expect(bars.map((entry) => entry.up)).toEqual([true, false]);
    expect(bars.map((entry) => entry.value)).toEqual([500, 700]);
  });
});

describe("moving average", () => {
  const points = [
    bar("2026-01-05", 1, 1, 1, 10),
    bar("2026-01-06", 1, 1, 1, 20),
    bar("2026-01-07", 1, 1, 1, 30),
    bar("2026-01-08", 1, 1, 1, 40),
  ];

  it("omits the warm-up window instead of averaging a short one", () => {
    const average = movingAverage(points, 3);
    expect(average.map((point) => point.time)).toEqual([
      "2026-01-07",
      "2026-01-08",
    ]);
    expect(average[0].value).toBeCloseTo(20, 6);
    expect(average[1].value).toBeCloseTo(30, 6);
  });

  it("returns nothing for a window that cannot be filled", () => {
    expect(movingAverage(points, 0)).toEqual([]);
    expect(movingAverage(points, 99)).toEqual([]);
  });
});

describe("range statistics", () => {
  const points = [
    bar("2026-01-05", 10, 12, 9, 10, 100),
    bar("2026-01-06", 10, 14, 10, 13, 200),
    bar("2026-01-07", 13, 13, 11, 11, 300),
    bar("2026-01-08", 11, 15, 11, 15, 400),
  ];

  it("reports the return, amplitude and extremes inside the range", () => {
    const stats = rangeStats(points, "2026-01-05", "2026-01-07")!;
    expect(stats.bars).toBe(3);
    expect(stats.first).toBe(10);
    expect(stats.last).toBe(11);
    expect(stats.percent).toBeCloseTo(10, 6);
    expect(stats.high).toBe(14);
    expect(stats.low).toBe(9);
    expect(stats.amplitude).toBeCloseTo(50, 6);
    expect(stats.averageVolume).toBeCloseTo(200, 6);
  });

  it("uses the bars that exist rather than the calendar span", () => {
    // A weekend inside the range must not add empty bars.
    const stats = rangeStats(points, "2026-01-05", "2026-01-08")!;
    expect(stats.bars).toBe(4);
    expect(stats.percent).toBeCloseTo(50, 6);
  });

  it("returns null for an empty range instead of zeros", () => {
    expect(rangeStats(points, "2027-01-01", "2027-02-01")).toBeNull();
  });
});
