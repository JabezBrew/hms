import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

function VitalsChart({
  data,
  dataKey,
  title,
  color,
  domain,
  unit,
  referenceLines = [],
  secondaryKey = null,
  secondaryColor = null,
}) {
  if (!data || data.length === 0) {
    return (
      <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
        No data available
      </div>
    );
  }

  return (
    <div className="h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10 }}
            className="text-muted-foreground"
          />
          <YAxis
            domain={domain}
            tick={{ fontSize: 10 }}
            className="text-muted-foreground"
            width={35}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            formatter={(value, name) => [`${value} ${unit}`, name === dataKey ? title : name]}
            labelFormatter={(label, payload) => {
              if (payload?.[0]?.payload?.date) {
                return `${payload[0].payload.date} ${label}`;
              }
              return label;
            }}
          />
          {referenceLines.map((line, idx) => (
            <ReferenceLine
              key={idx}
              y={line.value}
              stroke={line.color}
              strokeDasharray="5 5"
              label={{ value: line.label, fontSize: 10, fill: line.color }}
            />
          ))}
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls
          />
          {secondaryKey && (
            <Line
              type="monotone"
              dataKey={secondaryKey}
              stroke={secondaryColor}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          )}
          {secondaryKey && <Legend />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default VitalsChart;
