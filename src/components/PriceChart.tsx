import { useEffect, useRef, type MutableRefObject } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { dayOf, type SeriesPoint } from "../lib/cycles";
import { movingAverage, toCandles, toVolume } from "../lib/price";
// Type-only: the export contract lives with the comparison chart; importing it
// as a type keeps echarts out of this lazily loaded chunk.
import type { ChartExport } from "./Chart";

export interface PriceBand {
  start: string;
  end: string;
  label?: string;
  color?: string;
}
export interface PriceEvent {
  date: string;
  title?: string;
}
export interface VisibleRange {
  from: string;
  to: string;
}

function cssVar(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/**
 * Shades phase ranges behind the candles. Lightweight Charts has no band series,
 * so this rides the primitive API's background layer, which exists for exactly
 * this kind of time-area highlighting.
 */
class BandPrimitive implements ISeriesPrimitive<Time> {
  private bands: { from: Time; to: Time; color: string; label?: string }[] = [];
  private chart: IChartApi | null = null;
  private view: IPrimitivePaneView = {
    renderer: (): IPrimitivePaneRenderer => ({
      // The bands live on the background layer; the foreground has nothing to add.
      draw: () => {},
      drawBackground: (target) => {
        const scale = this.chart?.timeScale();
        if (!scale || !this.bands.length) return;
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          for (const band of this.bands) {
            // A boundary outside the data range has no coordinate; the band is
            // simply not drawn rather than stretched to the edge.
            const left = scale.timeToCoordinate(band.from);
            const right = scale.timeToCoordinate(band.to);
            if (left === null || right === null) continue;
            const width = Math.max(1, right - left);
            context.fillStyle = band.color;
            context.fillRect(left, 0, width, mediaSize.height);
            if (band.label) {
              context.fillStyle = cssVar("--chart-label", "#8a8c80");
              context.font = "10px system-ui, sans-serif";
              context.fillText(band.label, left + 4, 12);
            }
          }
        });
      },
    }),
  };
  setBands(
    bands: { from: Time; to: Time; color: string; label?: string }[],
    chart: IChartApi,
  ) {
    this.bands = bands;
    this.chart = chart;
  }
  updateAllViews() {}
  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }
}

export default function PriceChart({
  points,
  bands = [],
  events = [],
  averages = [5, 20, 60],
  onRangeChange,
  exportRef,
}: {
  points: SeriesPoint[];
  bands?: PriceBand[];
  events?: PriceEvent[];
  averages?: number[];
  onRangeChange?: (range: VisibleRange | null) => void;
  exportRef?: MutableRefObject<ChartExport | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const averagesRef = useRef<ISeriesApi<"Line">[]>([]);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bandRef = useRef<BandPrimitive | null>(null);
  const rangeHandler = useRef(onRangeChange);
  rangeHandler.current = onRangeChange;
  // The parent rebuilds `bands`, `events` and the default `averages` array on
  // every render, so the update effect below keys on serialized content rather
  // than identity; otherwise it reruns on every render and re-fits the viewport.
  const dataKey = JSON.stringify(points);
  const bandKey = JSON.stringify(bands);
  const eventKey = JSON.stringify(events);
  const averageKey = averages.join(",");
  const fitted = useRef("");

  useEffect(() => {
    if (!box.current) return;
    const instance = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { color: cssVar("--paper", "#fffefa") },
        textColor: cssVar("--chart-label", "#8a8c80"),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssVar("--chart-grid", "#efefe8") },
        horzLines: { color: cssVar("--chart-grid", "#efefe8") },
      },
      rightPriceScale: { borderColor: cssVar("--chart-axis", "#deded4") },
      timeScale: {
        borderColor: cssVar("--chart-axis", "#deded4"),
        rightOffset: 4,
      },
      crosshair: { mode: 0 },
    });
    chart.current = instance;
    // Hand the parent a screenshot hook so the board's 导出图片 button also works
    // in the K线 view, which does not render the comparison chart.
    if (exportRef)
      exportRef.current = { toDataURL: () => instance.takeScreenshot().toDataURL() };
    candles.current = instance.addSeries(CandlestickSeries, {
      upColor: "#b0603f",
      downColor: "#4f7a5c",
      borderUpColor: "#b0603f",
      borderDownColor: "#4f7a5c",
      wickUpColor: "#b0603f",
      wickDownColor: "#4f7a5c",
    });
    const band = new BandPrimitive();
    candles.current.attachPrimitive(band);
    bandRef.current = band;
    // Volume gets its own pane so it never competes with the price scale.
    instance.addPane();
    const volume = instance.addSeries(
      HistogramSeries,
      { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    volumeRef.current = volume;
    const onRange = (range: { from: Time; to: Time } | null) => {
      rangeHandler.current?.(
        range ? { from: String(range.from), to: String(range.to) } : null,
      );
    };
    instance.timeScale().subscribeVisibleTimeRangeChange(onRange);
    return () => {
      instance.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
      instance.remove();
      if (exportRef) exportRef.current = null;
      chart.current = null;
      candles.current = null;
      volumeRef.current = null;
      markers.current = null;
      averagesRef.current = [];
      bandRef.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    const price = candles.current;
    const volume = volumeRef.current;
    if (!instance || !price || !volume) return;
    const bars = toCandles(points);
    price.setData(
      bars.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );
    const upColor = "#b0603f";
    const downColor = "#4f7a5c";
    volume.setData(
      toVolume(points).map((bar) => ({
        time: bar.time,
        value: bar.value,
        color: bar.up ? `${upColor}88` : `${downColor}88`,
      })),
    );
    // Averages are rebuilt on every change, so the count follows `averages`.
    for (const series of averagesRef.current) instance.removeSeries(series);
    averagesRef.current = averages
      .map((window, index) => ({ window, index }))
      .filter(({ window }) => window > 1)
      .map(({ window, index }) => {
        const series = instance.addSeries(LineSeries, {
          color: cssVar(
            `--chart-line-${index + 1}`,
            ["#38644f", "#bb985d", "#5b7fa6"][index % 3],
          ),
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(
          movingAverage(points, window).map((point) => ({
            time: point.time,
            value: point.value,
          })),
        );
        return series;
      });
    const eventMarkers: SeriesMarker<Time>[] = events
      .map((event) => ({ ...event, time: dayOf(event.date) }))
      .filter((event) => event.time)
      .map((event) => ({
        time: event.time,
        position: "aboveBar" as const,
        color: cssVar("--chart-event", "#bb985d"),
        shape: "circle" as const,
        text: event.title || "",
      }));
    if (!markers.current) markers.current = createSeriesMarkers(price, eventMarkers);
    else markers.current.setMarkers(eventMarkers);
    bandRef.current?.setBands(
      bands
        .filter((band) => band.start && band.end)
        .map((band) => ({
          from: dayOf(band.start),
          to: dayOf(band.end),
          color: `${band.color || "#7fa76f"}22`,
          label: band.label,
        })),
      instance,
    );
    // A no-op options apply is the documented way to repaint after a primitive's
    // own data changed.
    price.applyOptions({});
    // Fit once per data set. Fitting on every run would fight the user's zoom,
    // because the chart's own range change re-renders the parent.
    if (fitted.current !== dataKey) {
      instance.timeScale().fitContent();
      fitted.current = dataKey;
    }
  }, [dataKey, bandKey, eventKey, averageKey]);

  return <div ref={box} className="price-chart" aria-label="K线走势图" />;
}
