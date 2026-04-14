import { useMemo } from 'react';
import { format } from 'date-fns';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

function deriveXDomain(data) {
  if (!data?.length) {
    return ['auto', 'auto'];
  }

  if (data.length === 1) {
    const ts = data[0].timestamp;
    const halfHour = 30 * 60 * 1000;
    return [ts - halfHour, ts + halfHour];
  }

  return ['dataMin', 'dataMax'];
}

function deriveYDomain(data, series, explicitDomain) {
  if (explicitDomain) {
    return explicitDomain;
  }

  const values = [];
  data.forEach((point) => {
    series.forEach(({ key }) => {
      const value = point?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        values.push(value);
      }
    });
  });

  if (!values.length) {
    return ['auto', 'auto'];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = min === 0 ? 1 : Math.max(Math.abs(min) * 0.1, 1);
    return [min - pad, max + pad];
  }

  const range = max - min;
  const pad = Math.max(range * 0.12, 1);
  return [min - pad, max + pad];
}

export default function ClinicalTrendLineChart({
  data = [],
  series = [],
  unit = '',
  yDomain = null,
  referenceLines = [],
  height = 220,
}) {
  const normalizedData = useMemo(() => (
    data
      .filter((point) => Number.isFinite(point?.timestamp))
      .sort((left, right) => left.timestamp - right.timestamp)
  ), [data]);

  const hasData = normalizedData.length > 0 && series.length > 0;

  const sameDay = useMemo(() => {
    if (normalizedData.length < 2) {
      return true;
    }
    return normalizedData.every((point) => (
      format(new Date(point.timestamp), 'yyyy-MM-dd') === format(new Date(normalizedData[0].timestamp), 'yyyy-MM-dd')
    ));
  }, [normalizedData]);

  const xDomain = useMemo(() => deriveXDomain(normalizedData), [normalizedData]);
  const resolvedYDomain = useMemo(
    () => deriveYDomain(normalizedData, series, yDomain),
    [normalizedData, series, yDomain],
  );

  if (!hasData) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={normalizedData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted/70" />
          <XAxis
            type="number"
            dataKey="timestamp"
            domain={xDomain}
            tick={{ fontSize: 10 }}
            tickFormatter={(value) => format(new Date(value), sameDay ? 'HH:mm' : 'MMM d')}
            className="text-muted-foreground"
          />
          <YAxis
            domain={resolvedYDomain}
            tick={{ fontSize: 10 }}
            className="text-muted-foreground"
            width={44}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '10px',
              fontSize: '12px',
            }}
            labelFormatter={(value) => format(new Date(value), 'MMM d, yyyy HH:mm')}
            formatter={(value, name) => [`${value}${unit ? ` ${unit}` : ''}`, name]}
          />
          {referenceLines.map((line) => (
            <ReferenceLine
              key={`${line.label}-${line.value}`}
              y={line.value}
              stroke={line.color}
              strokeDasharray="4 4"
              label={{ value: line.label, fill: line.color, fontSize: 10 }}
            />
          ))}
          {series.map((entry) => (
            <Line
              key={entry.key}
              type="linear"
              dataKey={entry.key}
              name={entry.label}
              stroke={entry.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
