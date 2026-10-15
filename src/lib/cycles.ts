/**
 * Pure helpers behind the cycle dashboard: several price series arrive on their
 * own trading calendars, events arrive on arbitrary dates, and phases are date
 * ranges. These functions put all three onto one comparable axis.
 */

export interface SeriesPoint {
  date: string;
  close?: number;
  value?: number;
  [key: string]: unknown;
}

export interface Phase {
  id: string;
  name?: string;
  start?: string;
  end?: string;
  color?: string;
}

export interface SeriesInput {
  id: string;
  name: string;
  color?: string;
  points: SeriesPoint[];
}

export interface AlignedLine {
  id: string;
  name: string;
  color?: string;
  values: (number | null)[];
}

export interface Aligned {
  dates: string[];
  lines: AlignedLine[];
}

export interface PhaseStat {
  id: string;
  name: string;
  start: string;
  end: string;
  days: number;
  events: number;
  returns: { id: string; name: string; percent: number | null }[];
}

export const dayOf = (value: unknown): string =>
  String(value ?? "").slice(0, 10);

/** Days since the epoch, so date arithmetic never drifts across DST. */
export function dayNumber(date: string): number {
  const parsed = Date.parse(`${dayOf(date)}T00:00:00Z`);
  return Number.isNaN(parsed) ? 0 : Math.round(parsed / 86400000);
}

export function pointValue(point: SeriesPoint): number | null {
  const raw = point.close ?? point.value;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** Ascending union of every series' observation dates. */
export function unionDates(series: SeriesInput[]): string[] {
  const dates = new Set<string>();
  for (const item of series)
    for (const point of item.points) {
      const date = dayOf(point.date);
      if (date) dates.add(date);
    }
  return [...dates].sort();
}

/**
 * Forward-fills every series onto the shared axis. A line stays null until its
 * own first observation, so a series that starts later never invents history.
 */
export function alignSeries(series: SeriesInput[]): Aligned {
  const dates = unionDates(series);
  const lines = series.map((item) => {
    const byDate = new Map<string, number | null>();
    for (const point of item.points) {
      const date = dayOf(point.date);
      if (date) byDate.set(date, pointValue(point));
    }
    const values: (number | null)[] = [];
    let carried: number | null = null;
    for (const date of dates) {
      const own = byDate.get(date);
      if (own !== undefined && own !== null) carried = own;
      values.push(carried);
    }
    return { id: item.id, name: item.name, color: item.color, values };
  });
  return { dates, lines };
}

/** Index of the first axis date at or after `target`; -1 when there is none. */
export function indexAt(dates: string[], target: string): number {
  const wanted = dayOf(target);
  return dates.findIndex((date) => date >= wanted);
}

/**
 * Index of the last axis date at or before `target`; -1 when there is none.
 * Phase ends use this rather than `indexAt`, so a window never reaches past the
 * phase into the next trading day.
 */
export function lastIndexAt(dates: string[], target: string): number {
  const wanted = dayOf(target);
  for (let index = dates.length - 1; index >= 0; index--)
    if (dates[index] <= wanted) return index;
  return -1;
}

/** Nearest axis date, so events and phases land on real observations. */
export function nearestDate(
  dates: string[],
  target: string,
): string | undefined {
  if (!dates.length) return undefined;
  const wanted = dayOf(target);
  if (!wanted) return dates[0];
  const wantedNumber = dayNumber(wanted);
  let best = dates[0];
  for (const date of dates)
    if (
      Math.abs(dayNumber(date) - wantedNumber) <
      Math.abs(dayNumber(best) - wantedNumber)
    )
      best = date;
  return best;
}

/**
 * Rebases every line to 100 at `baseDate` and drops earlier observations, so
 * series with different price levels become comparable on one axis.
 */
export function rebaseAt(aligned: Aligned, baseDate: string): Aligned {
  const start = indexAt(aligned.dates, baseDate);
  if (start < 0)
    return {
      dates: [],
      lines: aligned.lines.map((line) => ({ ...line, values: [] })),
    };
  const dates = aligned.dates.slice(start);
  const lines = aligned.lines.map((line) => {
    const window = line.values.slice(start);
    const base = window.find((value): value is number => value !== null && value !== 0);
    if (base === undefined) return { ...line, values: dates.map(() => null) };
    return {
      ...line,
      values: window.map((value) => (value === null ? null : (value / base) * 100)),
    };
  });
  return { dates, lines };
}

/**
 * Rebased point arrays, for callers that hand raw points to the chart rather
 * than an already-aligned frame. Keeps the chart's own contract unchanged.
 */
export function rebasePoints(
  points: SeriesPoint[],
  baseDate: string,
): SeriesPoint[] {
  const from = dayOf(baseDate);
  const window = points
    .filter((point) => dayOf(point.date) >= from)
    .sort((a, b) => dayOf(a.date).localeCompare(dayOf(b.date)));
  const base = window
    .map(pointValue)
    .find((value): value is number => value !== null && value !== 0);
  if (base === undefined) return [];
  return window
    .map((point) => ({ date: dayOf(point.date), value: pointValue(point) }))
    .filter((point): point is { date: string; value: number } => point.value !== null)
    .map((point) => ({ date: point.date, close: (point.value / base) * 100 }));
}

export interface EventImpact {
  id: string;
  date: string;
  title: string;
  moves: {
    id: string;
    name: string;
    before: number | null;
    after: number | null;
    percent: number | null;
  }[];
}

/**
 * What each series did around an event, measured on the observations that
 * actually exist rather than on calendar days — a weekend or holiday must not
 * count as a missing window. The window is clamped at the ends of the data
 * instead of inventing observations.
 */
export function eventImpacts(
  events: { id?: unknown; date?: unknown; title?: unknown }[],
  aligned: Aligned,
  window = 5,
): EventImpact[] {
  return events
    .map((event) => {
      const date = dayOf(event.date);
      const at = date ? indexAt(aligned.dates, date) : -1;
      const moves = aligned.lines.map((line) => {
        const from = at < 0 ? -1 : Math.max(0, at - window);
        const to = at < 0 ? -1 : Math.min(line.values.length - 1, at + window);
        const before = from < 0 ? null : line.values[from];
        const after = to < 0 ? null : line.values[to];
        return {
          id: line.id,
          name: line.name,
          before,
          after,
          percent:
            before === null || after === null || before === 0
              ? null
              : ((after - before) / before) * 100,
        };
      });
      return {
        id: String(event.id ?? date),
        date,
        title: String(event.title ?? ""),
        moves,
      };
    })
    .filter((impact) => impact.date);
}

/** Per-phase duration, event count and each line's return across the phase. */
export function phaseStats(
  phases: Phase[],
  aligned: Aligned,
  events: { date?: unknown; phaseId?: unknown }[] = [],
  today = new Date().toISOString().slice(0, 10),
): PhaseStat[] {
  return phases.map((phase) => {
    const start = dayOf(phase.start);
    const end = dayOf(phase.end) || today;
    const from = indexAt(aligned.dates, start);
    const to = lastIndexAt(aligned.dates, end);
    const returns = aligned.lines.map((line) => {
      const window =
        from < 0 ? [] : line.values.slice(from, to < 0 ? undefined : to + 1);
      const first = window.find((value): value is number => value !== null);
      const last = [...window]
        .reverse()
        .find((value): value is number => value !== null);
      const percent =
        first === undefined || last === undefined || first === 0
          ? null
          : ((last - first) / first) * 100;
      return { id: line.id, name: line.name, percent };
    });
    return {
      id: phase.id,
      name: phase.name || "未命名阶段",
      start,
      end,
      days: Math.max(0, dayNumber(end) - dayNumber(start)),
      // An explicit phase link wins; a dated event inside the range still counts,
      // so the board never under-reports because a link was never set.
      events: events.filter((event) => {
        if (event.phaseId) return event.phaseId === phase.id;
        const date = dayOf(event.date);
        return !!date && date >= start && date <= end;
      }).length,
      returns,
    };
  });
}

/** Where a phase stands today, for the dashboard header. */
export function phaseProgress(
  phase: Phase | undefined,
  today = new Date().toISOString().slice(0, 10),
): { days: number; total: number; percent: number; state: string } {
  const start = dayOf(phase?.start);
  if (!start) return { days: 0, total: 0, percent: 0, state: "未排期" };
  const end = dayOf(phase?.end);
  const now = dayNumber(today);
  if (end && now > dayNumber(end))
    return {
      days: Math.max(0, dayNumber(end) - dayNumber(start)),
      total: Math.max(0, dayNumber(end) - dayNumber(start)),
      percent: 100,
      state: "已结束",
    };
  const total = end ? Math.max(1, dayNumber(end) - dayNumber(start)) : 0;
  const elapsed = Math.max(0, now - dayNumber(start));
  return {
    days: elapsed,
    total,
    percent: total ? Math.min(100, Math.round((elapsed / total) * 100)) : 0,
    state: "进行中",
  };
}
