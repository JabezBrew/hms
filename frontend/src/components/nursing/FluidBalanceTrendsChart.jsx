import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export default function FluidBalanceTrendsChart({ data = [] }) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-medium mb-2">Daily Intake and Output</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 10 }}
              label={{ value: 'Recorded day', position: 'insideBottom', offset: -12, fontSize: 10 }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={56}
              label={{ value: 'mL', angle: -90, position: 'insideLeft', fontSize: 10, offset: 2 }}
            />
            <Tooltip
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDateLabel || ''}
            />
            <Legend />
            <Bar dataKey="intake" name="Intake (ml)" fill="#3b82f6" />
            <Bar dataKey="output" name="Output (ml)" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-2">Daily Fluid Balance</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 10 }}
              label={{ value: 'Recorded day', position: 'insideBottom', offset: -12, fontSize: 10 }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={56}
              label={{ value: 'mL', angle: -90, position: 'insideLeft', fontSize: 10, offset: 2 }}
            />
            <Tooltip
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDateLabel || ''}
            />
            <Legend />
            <ReferenceLine y={0} stroke="#000" />
            <Bar dataKey="balance" name="Balance (ml)" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
