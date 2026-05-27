/* oxlint-disable react-doctor/prefer-dynamic-import -- These chart modules already load through route or slide-over chunks; splitting Recharts again would add a nested loading waterfall. */
/**
 * ChartTrendGraph - Chronicle-styled line chart for trend visualization
 *
 * Displays trends of numeric/scale fields over time using Recharts.
 * Highlights critical values with color coding.
 */

import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import format from "date-fns/format";
import parseISO from "date-fns/parseISO";
import { useChartEntryTrends, useChartAssignment } from "@/features/charts/hooks";

function ChartTrendTooltip({ active, payload, currentField }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isCritical = data.isCritical;

    return (
      <div className={cn(
        "bg-card border border-border rounded-lg shadow-lg p-3",
        isCritical && "border-rose-500"
      )}>
        <p className="font-mono text-[10px] text-muted-foreground mb-1">
          {data.formattedDate} at {data.formattedTime}
        </p>
        <p className={cn(
          "font-mono text-lg font-medium",
          isCritical ? "text-rose-500" : "text-foreground"
        )}>
          {data.value}
          {currentField?.config?.unit && (
            <span className="text-sm text-muted-foreground ml-1">
              {currentField.config.unit}
            </span>
          )}
        </p>
        {isCritical && (
          <p className="flex items-center gap-1 text-[10px] text-rose-500 mt-1">
            <AlertTriangle className="size-3" />
            Critical value
          </p>
        )}
      </div>
    );
  }
  return null;
}

const ChartTrendGraph = ({
  assignmentId,
  fieldKey,
  onFieldChange,
  limit = 50,
  className,
}) => {
  const [resolvedFieldKey, componentKey] = (fieldKey || '').split(':');
  // Fetch assignment for template info
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

  // Get numeric/scale fields that can be graphed
  const graphableFields = useMemo(() => {
    if (!template?.fields) return [];
    return template.fields.filter((f) =>
      ['numeric', 'scale', 'calculated', 'paired'].includes(f.field_type)
    );
  }, [template]);

  // Get current field config
  const currentField = useMemo(() => {
    return graphableFields.find((f) => f.field_key === resolvedFieldKey);
  }, [graphableFields, resolvedFieldKey]);
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

  // Format trend data for chart
  const chartData = useMemo(() => {
    if (!trendData) return [];

    return trendData.map((point) => ({
      datetime: parseISO(point.datetime),
      value: point.value,
      isCritical: point.is_critical,
      formattedDate: format(parseISO(point.datetime), 'MMM d'),
      formattedTime: format(parseISO(point.datetime), 'h:mm a'),
    }));
  }, [trendData]);

  // Get critical range for reference lines
  const criticalRange = useMemo(() => {
    if (!currentField?.config) return null;

    const { critical_low, critical_high } = currentField.config;
    if (currentField.field_type === 'paired') {
      return {
        low: componentKey ? critical_low?.[componentKey] : undefined,
        high: componentKey ? critical_high?.[componentKey] : undefined,
      };
    }

    return { low: critical_low, high: critical_high };
  }, [componentKey, currentField]);

  const isLoading = assignmentLoading || trendLoading;

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (graphableFields.length === 0) {
    return (
      <div className={cn("text-center py-12 text-muted-foreground", className)}>
        <TrendingUp className="size-12 mx-auto mb-3 opacity-50" />
        <p>No numeric fields to graph</p>
      </div>
    );
  }

  return (
    <div className={cn("border border-border rounded-xl overflow-hidden", className)}>
      {/* Header */}
      <div className="px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-amber-600" />
            <h3 className="font-display text-base text-foreground">
              Trend
            </h3>
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

      {/* Chart */}
      <div className="p-4">
        {!resolvedFieldKey ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>Select a field to view trends</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <TrendingUp className="size-12 mx-auto mb-3 opacity-50" />
            <p>No data available for this field</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="datetime"
                tickFormatter={(date) => format(date, 'MMM d')}
                tick={{ fontSize: 10, fontFamily: 'var(--font-ibm-plex-mono)' }}
                stroke="hsl(var(--muted-foreground))"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fontFamily: 'var(--font-ibm-plex-mono)' }}
                stroke="hsl(var(--muted-foreground))"
                tickLine={false}
                axisLine={false}
                width={50}
                domain={['dataMin - 5', 'dataMax + 5']}
              />
              <Tooltip content={<ChartTrendTooltip currentField={currentField} />} />

              {/* Critical range reference lines */}
              {criticalRange?.low !== undefined && (
                <ReferenceLine
                  y={criticalRange.low}
                  stroke="hsl(var(--rose-500))"
                  strokeDasharray="5 5"
                  strokeWidth={1}
                  label={{
                    value: 'Low',
                    position: 'left',
                    fontSize: 10,
                    fontFamily: 'var(--font-ibm-plex-mono)',
                    fill: 'hsl(var(--rose-500))',
                  }}
                />
              )}
              {criticalRange?.high !== undefined && (
                <ReferenceLine
                  y={criticalRange.high}
                  stroke="hsl(var(--rose-500))"
                  strokeDasharray="5 5"
                  strokeWidth={1}
                  label={{
                    value: 'High',
                    position: 'left',
                    fontSize: 10,
                    fontFamily: 'var(--font-ibm-plex-mono)',
                    fill: 'hsl(var(--rose-500))',
                  }}
                />
              )}

              {/* Main line */}
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--amber-500))"
                strokeWidth={2}
                dot={({ cx, cy, payload }) => (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={payload.isCritical ? 5 : 3}
                    fill={payload.isCritical ? 'hsl(var(--rose-500))' : 'hsl(var(--amber-500))'}
                    stroke={payload.isCritical ? 'hsl(var(--rose-500))' : 'hsl(var(--amber-500))'}
                  />
                )}
                activeDot={{
                  r: 6,
                  stroke: 'hsl(var(--amber-500))',
                  strokeWidth: 2,
                  fill: 'hsl(var(--background))',
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer with stats */}
      {chartData.length > 0 && (
        <div className="px-4 py-3 bg-muted/30 border-t border-border">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Latest
              </p>
              <p className="font-mono text-sm text-foreground">
                {chartData[chartData.length - 1]?.value ?? '—'}
                {currentField?.config?.unit ? ` ${currentField.config.unit}` : ''}
              </p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Min
              </p>
              <p className="font-mono text-sm text-foreground">
                {Math.min(...chartData.map((d) => d.value))}
              </p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Max
              </p>
              <p className="font-mono text-sm text-foreground">
                {Math.max(...chartData.map((d) => d.value))}
              </p>
            </div>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Avg
              </p>
              <p className="font-mono text-sm text-foreground">
                {(chartData.reduce((sum, d) => sum + d.value, 0) / chartData.length).toFixed(1)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export { ChartTrendGraph };
export default ChartTrendGraph;
