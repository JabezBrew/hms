import { useMemo } from 'react';
import { HmsEChart } from '@/shared/components/charts/HmsEChart';
import {
  createBaseChartOption,
  escapeChartTooltipHtml,
} from '@/shared/components/charts/HmsEChartTheme';

const DEFAULT_EMPTY_ARRAY = [];

function buildReferenceSeries(data, referenceLines) {
  if (!referenceLines.length || data.length === 0) return [];

  return referenceLines.map((line) => ({
    data: data.map((point) => [point.time, line.value]),
    lineStyle: { color: line.color, opacity: 0.6, type: 'dashed', width: 1 },
    name: line.label,
    showSymbol: false,
    silent: true,
    tooltip: { show: false },
    type: 'line',
  }));
}

function VitalsChart({
  data = DEFAULT_EMPTY_ARRAY,
  dataKey,
  title,
  color,
  domain,
  unit,
  referenceLines = DEFAULT_EMPTY_ARRAY,
  secondaryKey = null,
  secondaryColor = null,
}) {
  const chartRows = useMemo(() => data.filter((point) => point?.[dataKey] != null), [data, dataKey]);
  const optionFactory = useMemo(() => (theme) => {
    const base = createBaseChartOption(theme, `${title} vital signs trend`);
    const primaryColor = color || theme.palette[0];
    const secondaryLineColor = secondaryColor || theme.palette[1];

    return {
      ...base,
      grid: { ...base.grid, bottom: secondaryKey ? 42 : 24, top: 12 },
      legend: { ...base.legend, show: Boolean(secondaryKey) },
      tooltip: {
        ...base.tooltip,
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          const row = list[0]?.data?.record;
          const safeUnit = unit ? ` ${escapeChartTooltipHtml(unit)}` : '';
          return `
            <div>
              <div style="color:${theme.muted};font-size:11px;margin-bottom:4px;">${escapeChartTooltipHtml(`${row?.date || ''} ${row?.time || ''}`.trim())}</div>
              ${list.map((param) => `
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${param.color};"></span>
                  <span>${escapeChartTooltipHtml(param.seriesName)}</span>
                  <strong style="margin-left:auto;">${escapeChartTooltipHtml(param.value?.[1] ?? '')}${safeUnit}</strong>
                </div>
              `).join('')}
            </div>
          `;
        },
      },
      xAxis: {
        ...base.xAxis,
        data: data.map((point) => point.time),
        type: 'category',
      },
      yAxis: {
        ...base.yAxis,
        max: domain?.[1],
        min: domain?.[0],
        scale: !domain,
      },
      series: [
        {
          connectNulls: true,
          data: data.map((point) => ({ record: point, value: [point.time, point[dataKey]] })),
          lineStyle: { color: primaryColor, width: 2 },
          name: title,
          showSymbol: data.length < 15,
          smooth: 0.25,
          symbolSize: 7,
          type: 'line',
        },
        ...(secondaryKey ? [{
          connectNulls: true,
          data: data.map((point) => ({ record: point, value: [point.time, point[secondaryKey]] })),
          lineStyle: { color: secondaryLineColor, width: 2 },
          name: secondaryKey,
          showSymbol: data.length < 15,
          smooth: 0.25,
          symbolSize: 7,
          type: 'line',
        }] : []),
        ...buildReferenceSeries(data, referenceLines),
      ],
    };
  }, [color, data, dataKey, domain, referenceLines, secondaryColor, secondaryKey, title, unit]);

  if (chartRows.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
        No data available
      </div>
    );
  }

  return <HmsEChart ariaLabel={`${title} vital signs trend`} height={180} option={optionFactory} />;
}

export default VitalsChart;
