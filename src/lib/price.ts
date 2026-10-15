/**
 * Pure helpers for the price chart. Kept apart from the chart component so the
 * arithmetic — bar mapping, moving averages, range statistics — can be tested
 * without a canvas.
 */
import { dayOf, type SeriesPoint } from "./cycles";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolumeBar {
  time: string;
  value: number;
  /** Rising bars are drawn in the up colour, falling ones in the down colour. */
  up: boolean;
}

/** True when a series carries real OHLC bars rather than a single value. */
export function hasOhlc(points: SeriesPoint[]): boolean {
  return points.some(
    (point) =>
      typeof point.open === "number" &&
      typeof point.high === "number" &&
      typeof point.low === "number" &&
      typeof point.close === "number",
  );
}

/** Drops points that cannot form a bar, so a partial row never draws a spike. */
export function toCandles(points: SeriesPoint[]): Candle[] {
  const candles: Candle[] = [];
  for (const point of points) {
    const { open, high, low, close } = point as Record<string, unknown>;
    const time = dayOf(point.date);
    if (!time) continue;
    if (
      typeof open !== "number" ||
      typeof high !== "number" ||
      typeof low !== "number" ||
      typeof close !== "number" ||
      ![open, high, low, close].every(Number.isFinite)
    )
      continue;
    candles.push({ time, open, high, low, close });
  }
  return candles.sort((a, b) => a.time.localeCompare(b.time));
}

/** Volume bars for the same dates; points without volume are skipped. */
export function toVolume(points: SeriesPoint[]): VolumeBar[] {
  const bars: VolumeBar[] = [];
  for (const point of points) {
    const { volume, open, close } = point as Record<string, unknown>;
    const time = dayOf(point.date);
    if (!time || typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0)
      continue;
    bars.push({
      time,
      value: volume,
      up: typeof open === "number" && typeof close === "number" && close >= open,
    });
  }
  return bars.sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Simple moving average over closing prices. The first `window - 1` points have
 * no average yet and are omitted rather than faked from a short window.
 */
export function movingAverage(
  points: SeriesPoint[],
  window: number,
): { time: string; value: number }[] {
  if (!Number.isFinite(window) || window < 1) return [];
  const candles = toCandles(points);
  const out: { time: string; value: number }[] = [];
  let sum = 0;
  for (let index = 0; index < candles.length; index++) {
    sum += candles[index].close;
    if (index >= window) sum -= candles[index - window].close;
    if (index >= window - 1)
      out.push({ time: candles[index].time, value: sum / window });
  }
  return out;
}

export interface RangeStats {
  from: string;
  to: string;
  bars: number;
  first: number;
  last: number;
  change: number;
  percent: number | null;
  high: number;
  low: number;
  /** (high - low) / first, as a percentage. */
  amplitude: number | null;
  averageVolume: number | null;
}

/**
 * Statistics for the bars inside an inclusive date range. Returns null when the
 * range holds no bars, rather than reporting zeros that would read as real data.
 */
export function rangeStats(
  points: SeriesPoint[],
  from: string,
  to: string,
): RangeStats | null {
  const start = dayOf(from);
  const end = dayOf(to);
  const candles = toCandles(points).filter(
    (candle) => candle.time >= start && candle.time <= end,
  );
  if (!candles.length) return null;
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const volumes = toVolume(points)
    .filter((bar) => bar.time >= start && bar.time <= end)
    .map((bar) => bar.value);
  return {
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    bars: candles.length,
    first,
    last,
    change: last - first,
    percent: first === 0 ? null : ((last - first) / first) * 100,
    high,
    low,
    amplitude: first === 0 ? null : ((high - low) / first) * 100,
    averageVolume: volumes.length
      ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length
      : null,
  };
}
