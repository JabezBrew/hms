/**
 * ChartTrendGraph - Chronicle-styled line chart for trend visualization.
 *
 * Displays trends of numeric/scale fields over time using ECharts.
 */

import { LoadingSpinner } from '@/components/ui/loading-spinner';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HmsEChart } from '@/shared/components/charts/HmsEChart';
import {
  createBaseChartOption,
  escapeChartTooltipHtml,
} from '@/shared/components/charts/HmsEChartTheme';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { useChartEntryTrends, useChartAssignment } from '@/features/charts/hooks';

function formatTrendTooltip(params, theme, currentField) {
  const list = Array.isArray(params) ? params : [params];
  const point = list[0]?.data?.record;
  if (!point) return '';

  const unit = currentField?.config?.unit;
  const isCritical = point.isCritical;
  const safeUnit = unit ? ` ${escapeChartTooltipHtml(unit)}` : '';
  return `
    <div>
      <div style="color:${theme.muted};font-size:11px;margin-bottom:4px;">
        ${escapeChartTooltipHtml(`${point.formattedDate} at ${point.formattedTime}`)}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${isCritical ? theme.palette[2] : theme.palette[0]};"></span>
        <span>${escapeChartTooltipHtml(currentField?.name || 'Value')}</span>
        <strong style="margin-left:auto;">${escapeChartTooltipHtml(point.value)}${safeUnit}</strong>
      </div>
      ${isCritical ? `<div style="color:${theme.palette[2]};font-size:11px;margin-top:6px;">Critical value</div>` : ''}
    </div>
  `;
}

function buildCriticalThresholdSeries(chartData, criticalRange, theme) {
  if (chartData.length === 0) return [];

  const start = chartData[0].datetime;
  const end = chartData[chartData.length - 1].datetime;
  const thresholds = [];
  if (criticalRange?.low !== undefined) {
    thresholds.push({ label: 'Low', value: criticalRange.low });
  }
  if (criticalRange?.high !== undefined) {
    thresholds.push({ label: 'High', value: criticalRange.high });
  }

  return thresholds.map((line) => ({
    data: [[start, line.value], [end, line.value]],
    lineStyle: { color: theme.palette[2], opacity: 0.6, type: 'dashed', width: 1 },
    name: line.label,
    showSymbol: false,
    silent: true,
    tooltip: { show: false },
    type: 'line',
  }));
}

const ChartTrendGraph = ({
  assignmentId,
  fieldKey,
  onFieldChange,
  limit = 50,
  className,
}) => {
  const [resolvedFieldKey, componentKey] = (fieldKey || '').split(':');
  const { data: assignment, isLoading: assignmentLoading } = useChartAssignment(assignmentId);
  const { data: trendData, isLoading: trendLoading } = useChartEntryTrends(
    assignmentId,
    resolvedFieldKey,
    {
      limit,
      component: componentKey,
    },
  );

  const template = assignment?.template;
  const graphableFields = useMemo(() => {
    if (!template?.fields) return [];
    return template.fields.filter((field) =>
      ['numeric', 'scale', 'calculated', 'paired'].includes(field.field_type)
    );
  }, [template]);

  const currentField = useMemo(() => (
    graphableFields.find((field) => field.field_key === resolvedFieldKey)
  ), [graphableFields, resolvedFieldKey]);

  const fieldOptions = useMemo(() => (
    graphableFields.flatMap((field) => {
      if (field.field_type !== 'paired') {
        return [{ value: field.field_key, label: field.name }];
      }

      return (field.config?.fields || []).map((part) => ({
        value: `${field.field_key}:${part.key}`,
        label: `${field.name} - ${part.label}`,
      }));
    })
  ), [graphableFields]);

  const chartData = useMemo(() => {
    if (!trendData) return [];

    return trendData.map((point) => {
      const parsedDate = parseISO(point.datetime);
      return {
        datetime: parsedDate.getTime(),
        formattedDate: format(parsedDate, 'MMM d'),
        formattedTime: format(parsedDate, 'h:mm a'),
        isCritical: point.is_critical,
        value: point.value,
      };
    });
  }, [trendData]);

  const criticalRange = useMemo(() => {
    if (!currentField?.config) return null;

    const { critical_low, critical_high } = currentField.config;
    if (currentField.field_type === 'paired') {
      return {
        high: componentKey ? critical_high?.[componentKey] : undefined,
        low: componentKey ? critical_low?.[componentKey] : undefined,
      };
    }

    return { high: critical_high, low: critical_low };
  }, [componentKey, currentField]);

  const optionFactory = useMemo(() => (theme) => {
    const base = createBaseChartOption(theme, 'Chart entry trend graph');
    return {
      ...base,
      grid: { ...base.grid, bottom: 34, top: 18 },
      legend: { ...base.legend, show: false },
      tooltip: {
        ...base.tooltip,
        formatter: (params) => formatTrendTooltip(params, theme, currentField),
      },
      xAxis: {
        ...base.xAxis,
        type: 'time',
      },
      yAxis: {
        ...base.yAxis,
        scale: true,
      },
      series: [
        {
          data: chartData.map((point) => ({
            itemStyle: {
              color: point.isCritical ? theme.palette[2] : theme.palette[0],
            },
            record: point,
            value: [point.datetime, point.value],
          })),
          lineStyle: { color: theme.palette[0], width: 2 },
          name: currentField?.name || 'Value',
          showSymbol: chartData.length < 20,
          smooth: 0.25,
          symbolSize: (value, params) => (params.data?.record?.isCritical ? 10 : 7),
          type: 'line',
        },
        ...buildCriticalThresholdSeries(chartData, criticalRange, theme),
      ],
    };
  }, [chartData, criticalRange, currentField]);

  const isLoading = assignmentLoading || trendLoading;
  const values = chartData.map((point) => point.value).filter(Number.isFinite);

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <LoadingSpinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (graphableFields.length === 0) {
    return (
      <div className={cn('py-12 text-center text-muted-foreground', className)}>
        <TrendingUp className="mx-auto mb-3 size-12 opacity-50" />
        <p>No numeric fields to graph</p>
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border', className)}>
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-amber-600" />
            <h3 className="font-display text-base text-foreground">Trend</h3>
          </div>
          <Select value={fieldKey} onValueChange={onFieldChange}>
            <SelectTrigger className="w-[180px] font-mono text-xs">
              <SelectValue placeholder="Select field" />
            </SelectTrigger>
            <SelectContent className="z-[200]">
              {fieldOptions.map((field) => (
                <SelectItem key={field.value} value={field.value} className="font-mono">
                  {field.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="p-4">
        {!resolvedFieldKey ? (
          <div className="py-12 text-center text-muted-foreground">
            <p>Select a field to view trends</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <TrendingUp className="mx-auto mb-3 size-12 opacity-50" />
            <p>No data available for this field</p>
          </div>
        ) : (
          <HmsEChart ariaLabel="Chart entry trend graph" height={300} option={optionFactory} />
        )}
      </div>

      {values.length > 0 && (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ChartTrendStat label="Latest" value={values[values.length - 1]} unit={currentField?.config?.unit} />
            <ChartTrendStat label="Min" value={Math.min(...values)} />
            <ChartTrendStat label="Max" value={Math.max(...values)} />
            <ChartTrendStat
              label="Avg"
              value={(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

function ChartTrendStat({ label, value, unit = '' }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-sm text-foreground">
        {value ?? '—'}{unit ? ` ${unit}` : ''}
      </p>
    </div>
  );
}

export { ChartTrendGraph };
export default ChartTrendGraph;
