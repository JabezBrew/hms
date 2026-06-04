import { useMemo } from 'react';
import { HmsEChart } from '@/shared/components/charts/HmsEChart';
import {
  createBaseChartOption,
  escapeChartTooltipHtml,
} from '@/shared/components/charts/HmsEChartTheme';

const DEFAULT_EMPTY_ARRAY = [];

export default function FluidBalanceTrendsChart({ data = DEFAULT_EMPTY_ARRAY }) {
  const optionFactory = useMemo(() => (theme) => {
    const base = createBaseChartOption(theme, 'Fluid balance trend chart');
    return {
      ...base,
      grid: { ...base.grid, bottom: 46, top: 18 },
      legend: { ...base.legend, show: true },
      tooltip: {
        ...base.tooltip,
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          const row = list[0]?.data?.record;
          return `
            <div>
              <div style="color:${theme.muted};font-size:11px;margin-bottom:4px;">${escapeChartTooltipHtml(row?.fullDateLabel || row?.dateLabel || '')}</div>
              ${list.map((param) => `
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${param.color};"></span>
                  <span>${escapeChartTooltipHtml(param.seriesName)}</span>
                  <strong style="margin-left:auto;">${escapeChartTooltipHtml(param.value)} mL</strong>
                </div>
              `).join('')}
            </div>
          `;
        },
      },
      xAxis: {
        ...base.xAxis,
        data: data.map((point) => point.dateLabel),
        type: 'category',
      },
      yAxis: {
        ...base.yAxis,
        name: 'mL',
        nameGap: 42,
        nameLocation: 'middle',
        nameRotate: 90,
        scale: true,
      },
      series: [
        {
          barMaxWidth: 24,
          data: data.map((point) => ({ record: point, value: point.intake })),
          itemStyle: { color: theme.palette[3], borderRadius: [3, 3, 0, 0] },
          name: 'Intake',
          type: 'bar',
        },
        {
          barMaxWidth: 24,
          data: data.map((point) => ({ record: point, value: point.output })),
          itemStyle: { color: theme.palette[0], borderRadius: [3, 3, 0, 0] },
          name: 'Output',
          type: 'bar',
        },
        {
          data: data.map((point) => ({ record: point, value: point.balance })),
          lineStyle: { color: theme.palette[1], width: 2 },
          name: 'Net balance',
          smooth: 0.2,
          symbolSize: 7,
          type: 'line',
        },
        {
          data: data.map((point) => [point.dateLabel, 0]),
          lineStyle: { color: theme.axis, opacity: 0.7, width: 1 },
          name: 'Zero balance',
          showSymbol: false,
          silent: true,
          tooltip: { show: false },
          type: 'line',
        },
      ],
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No fluid-balance data available
      </div>
    );
  }

  return <HmsEChart ariaLabel="Fluid balance trend chart" height={320} option={optionFactory} />;
}
