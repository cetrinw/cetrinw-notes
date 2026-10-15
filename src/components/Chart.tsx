import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as echarts from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { alignSeries, nearestDate, type SeriesInput } from "../lib/cycles";
echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);
export interface ChartBand {
  start: string;
  end: string;
  label?: string;
  color?: string;
}
export interface ChartSeries extends SeriesInput {
  /** A series on `right` gets its own axis, for indicators at another scale. */
  axis?: "left" | "right";
}
/** One row of event markers below the chart, sharing its time axis. */
export interface ChartLane {
  name: string;
  points: { date: string; title?: string; status?: string }[];
}
/** Handed to the parent so an export button can grab the rendered image. */
export interface ChartExport {
  toDataURL: () => string;
}
/** Fallback ramp for themes that do not define their own chart colours. */
const PALETTE = ["#38644f", "#bb985d", "#5b7fa6", "#a45f6b", "#7a6fa6", "#4f8f8a"];
function cssVar(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}
/** The single-`points` shape stays supported so existing callers keep working. */
function toSeries(points: any[], series?: ChartSeries[]): ChartSeries[] {
  if (series?.length) return series;
  return points?.length ? [{ id: "primary", name: "", points }] : [];
}
export default function Chart({
  points = [],
  series,
  events = [],
  bands = [],
  lanes = [],
  exportRef,
}: {
  points?: any[];
  series?: ChartSeries[];
  events?: any[];
  bands?: ChartBand[];
  lanes?: ChartLane[];
  exportRef?: MutableRefObject<ChartExport | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);
  const inputs = useMemo(() => toSeries(points, series), [points, series]);
  const aligned = useMemo(() => alignSeries(inputs), [inputs]);
  // Kept beside the aligned frame rather than on it: alignment only carries the
  // drawn values, so the axis choice is looked up by id instead of cast.
  const axisById = useMemo(
    () => new Map(inputs.map((item) => [item.id, item.axis])),
    [inputs],
  );
  useEffect(() => {
    if (!ref.current) return;
    const instance = echarts.init(ref.current);
    chart.current = instance;
    if (exportRef)
      exportRef.current = {
        toDataURL: () =>
          instance.getDataURL({
            pixelRatio: 2,
            backgroundColor: cssVar("--paper", "#fffefa"),
          }),
      };
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(ref.current);
    return () => {
      resize.disconnect();
      instance.dispose();
      chart.current = null;
      if (exportRef) exportRef.current = null;
    };
  }, [exportRef]);
  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    const { dates, lines } = aligned;
    if (!dates.length) {
      instance.clear();
      return;
    }
    const dual = lines.some((line) => axisById.get(line.id) === "right");
    const multi = lines.length > 1;
    // A lane is only worth drawing when its events actually land on the axis.
    const activeLanes = lanes
      .map((lane) => ({
        name: lane.name,
        points: lane.points
          .map((point) => ({
            date: nearestDate(dates, point.date),
            title: point.title || "",
            status: point.status || "",
          }))
          .filter((point) => point.date),
      }))
      .filter((lane) => lane.points.length);
    // Events and phase bands snap onto real observations; a category axis has no
    // position for a date the data never traded on.
    const markers = events
      .filter((event) => event.date)
      .slice(0, 20)
      .map((event) => ({
        name: String(event.title || ""),
        xAxis: nearestDate(dates, String(event.date)),
      }))
      .filter((marker) => marker.xAxis);
    const areas = bands
      .filter((band) => band.start && band.end)
      .map((band) => ({
        band,
        start: nearestDate(dates, band.start),
        end: nearestDate(dates, band.end),
      }))
      .filter((area) => area.start && area.end);
    const axisStyle = {
      axisLine: { lineStyle: { color: cssVar("--chart-axis", "#deded4") } },
      axisLabel: { color: cssVar("--chart-label", "#8a8c80") },
    };
    const leftAxis = {
      type: "value" as const,
      scale: true,
      splitLine: { lineStyle: { color: cssVar("--chart-grid", "#efefe8") } },
      axisLabel: { color: cssVar("--chart-label", "#8a8c80") },
    };
    const rightAxis = {
      type: "value" as const,
      scale: true,
      splitLine: { show: false },
      axisLabel: { color: cssVar("--chart-label", "#8a8c80") },
    };
    const laneCount = activeLanes.length;
    // Lanes take a fixed share of the height; the main chart keeps the rest.
    const laneShare = laneCount ? Math.min(32, 9 + 5 * laneCount) : 0;
    const pad = { left: 68, right: dual ? 68 : 24 };
    const topPad = multi ? 46 : 32;
    // Reuse the instance and only swap the option; colors follow the theme.
    instance.setOption(
      {
        animation: false,
        legend: multi
          ? {
              type: "scroll",
              top: 0,
              itemWidth: 14,
              itemHeight: 8,
              data: lines.map((line) => line.name || "数值"),
              textStyle: { color: cssVar("--chart-label", "#8a8c80") },
            }
          : undefined,
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        grid: laneCount
          ? [
              { ...pad, top: topPad, bottom: `${laneShare + 18}%` },
              { ...pad, bottom: "16%", height: `${laneShare}%` },
            ]
          : { ...pad, top: topPad, bottom: 66 },
        tooltip: { trigger: "axis", confine: true },
        xAxis: laneCount
          ? [
              // The lower axis carries the labels, so the two grids read as one.
              { type: "category", data: dates, boundaryGap: false, gridIndex: 0, axisLabel: { show: false }, axisLine: axisStyle.axisLine },
              { type: "category", data: dates, boundaryGap: false, gridIndex: 1, ...axisStyle },
            ]
          : { type: "category", data: dates, boundaryGap: false, ...axisStyle },
        yAxis: laneCount
          ? [
              dual ? leftAxis : leftAxis,
              {
                type: "category" as const,
                gridIndex: 1,
                data: activeLanes.map((lane) => lane.name),
                axisLine: { show: false },
                axisTick: { show: false },
                splitLine: { show: false },
                axisLabel: { color: cssVar("--chart-label", "#8a8c80"), fontSize: 11 },
              },
              ...(dual ? [rightAxis] : []),
            ]
          : dual
            ? [leftAxis, rightAxis]
            : leftAxis,
        dataZoom: [
          { type: "inside", xAxisIndex: laneCount ? [0, 1] : 0 },
          {
            type: "slider",
            xAxisIndex: laneCount ? [0, 1] : 0,
            height: 18,
            bottom: 10,
            borderColor: "transparent",
            fillerColor: cssVar("--chart-fill", "#dce7dc"),
          },
        ],
        series: [
          ...lines.map((line, index) => {
            const color =
              line.color ||
              cssVar(`--chart-line-${index + 1}`, PALETTE[index % PALETTE.length]);
            return {
              type: "line",
              name: line.name || "数值",
              showSymbol: false,
              data: line.values,
              yAxisIndex: dual && axisById.get(line.id) === "right" ? (laneCount ? 2 : 1) : 0,
              lineStyle: { width: 2, color },
              itemStyle: { color },
              // Filling every line would hide the ones behind it.
              areaStyle: multi
                ? undefined
                : { color: cssVar("--chart-area", "rgba(66,106,85,.045)") },
              // Markers ride the first line only, so they are not drawn once per line.
              markLine:
                index === 0 && markers.length
                  ? {
                      symbol: "none",
                      label: { fontSize: 10, formatter: "{b}" },
                      lineStyle: {
                        type: "dashed",
                        color: cssVar("--chart-event", "#bb985d"),
                      },
                      data: markers,
                    }
                  : undefined,
              markArea:
                index === 0 && areas.length
                  ? {
                      silent: true,
                      itemStyle: { opacity: 0.14 },
                      data: areas.map(({ band, start, end }) => [
                        {
                          xAxis: start,
                          itemStyle: band.color ? { color: band.color } : undefined,
                          label: band.label
                            ? {
                                show: true,
                                position: "insideTop" as const,
                                formatter: band.label,
                                fontSize: 10,
                              }
                            : { show: false },
                        },
                        { xAxis: end },
                      ]),
                    }
                  : undefined,
            };
          }),
          ...(laneCount
            ? [
                {
                  type: "scatter",
                  name: "事件",
                  xAxisIndex: 1,
                  yAxisIndex: 1,
                  symbolSize: 9,
                  itemStyle: {
                    color: cssVar("--chart-event", "#bb985d"),
                    borderColor: cssVar("--chart-line", "#38644f"),
                    borderWidth: 1,
                  },
                  data: activeLanes.flatMap((lane) =>
                    lane.points.map((point) => ({
                      value: [point.date, lane.name],
                      name: point.title,
                    })),
                  ),
                  tooltip: {
                    formatter: (params: any) =>
                      params?.name ? String(params.name) : "",
                  },
                },
              ]
            : []),
        ],
      },
      { notMerge: true },
    );
  }, [aligned, axisById, events, bands, lanes]);
  return <div ref={ref} className="chart" aria-label="历史数据走势图" />;
}
