import { useMemo } from 'react';
import { format } from 'date-fns';
import { HmsEChart } from '@/shared/components/charts/HmsEChart';
import {
  createBaseChartOption,
  escapeChartTooltipHtml,
} from '@/shared/components/charts/HmsEChartTheme';

const DEFAULT_EMPTY_ARRAY = [];
const DENSE_THRESHOLD = 15;

function deriveYBounds(data, series, normalRange) {
  const values = [];
  data.forEach((point) => {
    series.forEach(({ key }) => {
      const value = point?.[key];
      if (Number.isFinite(value)) values.push(value);
    });
  });

  if (normalRange) values.push(normalRange.low, normalRange.high);
  if (values.length === 0) return undefined;

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = min === 0 ? 1 : Math.max(Math.abs(min) * 0.1, 1);
    return [min - pad, max + pad];
  }

  const pad = Math.max((max - min) * 0.12, 1);
  return [Math.floor(min - pad), Math.ceil(max + pad)];
}

function formatTooltipParam(param, unit) {
  const value = Array.isArray(param.value) ? param.value[1] : param.value;
  const safeUnit = unit ? ` ${escapeChartTooltipHtml(unit)}` : '';
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${param.color};"></span>
      <span>${escapeChartTooltipHtml(param.seriesName)}</span>
      <strong style="margin-left:auto;">${escapeChartTooltipHtml(value)}${safeUnit}</strong>
    </div>
  `;
}

function buildReferenceSeries(normalizedData, normalRange, referenceLines, theme) {
  if ((!normalRange && referenceLines.length === 0) || normalizedData.length === 0) return [];

  const start = normalizedData[0].timestamp;
  const end = normalizedData[normalizedData.length - 1].timestamp;
  const thresholdLines = [
    ...(normalRange ? [
      { color: theme.palette[1], label: 'Normal low', value: normalRange.low },
      { color: theme.palette[1], label: 'Normal high', value: normalRange.high },
    ] : []),
    ...referenceLines,
  ];

  return thresholdLines.map((line) => ({
    data: [[start, line.value], [end, line.value]],
    lineStyle: { color: line.color, opacity: 0.6, type: 'dashed', width: 1 },
    name: line.label,
    showSymbol: false,
    silent: true,
    tooltip: { show: false },
    type: 'line',
  }));
}

export default function ClinicalTrendLineChart({
  data = DEFAULT_EMPTY_ARRAY,
  series = DEFAULT_EMPTY_ARRAY,
  unit = '',
  normalRange = null,
  referenceLines = DEFAULT_EMPTY_ARRAY,
  height = 220,
  xAxisLabel = 'Recorded time',
  yAxisLabel = null,
  showLegend = false,
}) {
  const normalizedData = useMemo(() => (
    data
      .filter((point) => Number.isFinite(point?.timestamp))
      .slice()
      .sort((left, right) => left.timestamp - right.timestamp)
  ), [data]);

  const optionFactory = useMemo(() => (theme) => {
    const base = createBaseChartOption(theme, 'Clinical trend chart');
    const isDense = normalizedData.length >= DENSE_THRESHOLD;
    const yBounds = deriveYBounds(normalizedData, series, normalRange);

    return {
      ...base,
      grid: {
        ...base.grid,
        bottom: showLegend ? 44 : 36,
        left: yAxisLabel ? 18 : 8,
        top: 18,
      },
      legend: {
        ...base.legend,
        show: showLegend,
      },
      tooltip: {
        ...base.tooltip,
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          const timestamp = Array.isArray(list[0]?.value) ? list[0].value[0] : list[0]?.axisValue;
          const timestampLabel = format(new Date(timestamp), 'MMM d, yyyy HH:mm');
          return `
            <div>
              <div style="color:${theme.muted};font-size:11px;margin-bottom:4px;">${escapeChartTooltipHtml(timestampLabel)}</div>
              ${list.map((param) => formatTooltipParam(param, unit)).join('')}
            </div>
          `;
        },
      },
      xAxis: {
        ...base.xAxis,
        name: xAxisLabel,
        nameGap: 24,
        nameLocation: 'middle',
        nameTextStyle: {
          color: theme.muted,
          fontFamily: 'var(--font-ibm-plex-mono)',
          fontSize: 10,
        },
        type: 'time',
      },
      yAxis: {
        ...base.yAxis,
        max: yBounds?.[1],
        min: yBounds?.[0],
        name: yAxisLabel || undefined,
        nameGap: 38,
        nameLocation: 'middle',
        nameRotate: 90,
        nameTextStyle: {
          color: theme.muted,
          fontFamily: 'var(--font-ibm-plex-mono)',
          fontSize: 10,
        },
        scale: true,
      },
      series: [
        ...series.map((entry, index) => ({
          data: normalizedData
            .filter((point) => Number.isFinite(point?.[entry.key]))
            .map((point) => [point.timestamp, point[entry.key]]),
          lineStyle: { color: entry.color || theme.palette[index], width: 2 },
          name: entry.label,
          showSymbol: !isDense,
          smooth: 0.25,
          symbolSize: 7,
          type: 'line',
        })),
        ...buildReferenceSeries(normalizedData, normalRange, referenceLines, theme),
      ],
    };
  }, [normalizedData, normalRange, referenceLines, series, showLegend, unit, xAxisLabel, yAxisLabel]);

  if (normalizedData.length === 0 || series.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No data available
      </div>
    );
  }

  return <HmsEChart ariaLabel="Clinical trend chart" height={height} option={optionFactory} />;
}
