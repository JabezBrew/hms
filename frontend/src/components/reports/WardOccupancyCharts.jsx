import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HmsEChart } from '@/shared/components/charts/HmsEChart';
import {
  createBaseChartOption,
  createItemTooltip,
  escapeChartTooltipHtml,
  getChartTooltipDataParam,
  getChartTooltipParams,
} from '@/shared/components/charts/HmsEChartTheme';
import { cn } from '@/lib/utils';

const DEFAULT_EMPTY_ARRAY = [];
const MAX_COMPARISON_LINES = 5;

const PERCENT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

function isRustV2Snapshot(meta) {
  return meta?.mode === 'rust_v2_snapshot';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${PERCENT_FORMATTER.format(value)}%` : 'Not available';
}

function formatNumber(value, suffix = '') {
  return Number.isFinite(value) ? `${NUMBER_FORMATTER.format(value)}${suffix}` : 'Not available';
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getWardNameById(wards, wardId) {
  return wards.find((ward) => ward.id === wardId)?.name;
}

function getSnapshotRows(utilizationData) {
  return utilizationData
    .map((ward) => ({
      avgLos: numericValue(ward.avg_los),
      bedDays: numericValue(ward.bed_days),
      occupiedBeds: numericValue(ward.occupied_beds_count),
      occupancyRate: numericValue(ward.occupancy_rate),
      totalBeds: numericValue(ward.total_beds),
      turnoverRate: numericValue(ward.turnover_rate),
      ward: ward.ward,
    }))
    .toSorted((left, right) => (right.occupancyRate || 0) - (left.occupancyRate || 0));
}

function getAverage(values) {
  const validValues = values.filter(Number.isFinite);
  if (validValues.length === 0) return null;
  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function getFinitePointValues(points, key) {
  const values = [];
  for (const point of points) {
    const value = numericValue(point[key]);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function hasMetricValue(rows, key) {
  return rows.some((row) => row[key] !== null && row[key] !== undefined);
}

function MetricTile({ icon: Icon, label, meta, tone = 'default', value }) {
  const toneClass = {
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
    default: 'bg-muted text-muted-foreground',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200',
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 font-display text-2xl leading-none text-foreground">
            {value}
          </p>
          {meta ? (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{meta}</p>
          ) : null}
        </div>
        <span className={cn('rounded-md p-2', toneClass)}>
          <Icon className="size-4" />
        </span>
      </div>
    </div>
  );
}

function ChartCard({ children, description, title }) {
  return (
    <Card className="rounded-lg border-border shadow-sm">
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="font-display text-lg leading-tight">{title}</CardTitle>
        {description ? (
          <CardDescription className="font-mono text-xs">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyAnalyticsState({ body, title }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <CircleAlert className="mb-3 size-6 text-muted-foreground" />
      <p className="font-heading text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function SnapshotNotice({ meta }) {
  if (!isRustV2Snapshot(meta)) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
      Rust V2 currently provides a live ward capacity snapshot here. Historical
      occupancy, LOS, admissions, discharge, transfer, and revenue analytics are
      hidden until a real aggregate analytics contract exists.
    </div>
  );
}

function buildSnapshotBarOption(rows, title) {
  return (theme) => {
    const base = createBaseChartOption(theme, title);
    return {
      ...base,
      grid: { ...base.grid, bottom: 46, top: 16 },
      legend: { ...base.legend, show: false },
      tooltip: createItemTooltip(base.tooltip, {
        formatter: (params) => {
          const row = getChartTooltipDataParam(params)?.data?.record;
          const bedSummary = row?.totalBeds != null
            ? ` / ${formatNumber(row.totalBeds)}`
            : '';
          return `
            <div>
              <div style="font-weight:600;margin-bottom:4px;">${escapeChartTooltipHtml(row?.ward || '')}</div>
              <div>Occupancy: <strong>${escapeChartTooltipHtml(formatPercent(row?.occupancyRate))}</strong></div>
              <div style="color:${theme.muted};font-size:11px;margin-top:4px;">
                Beds occupied: ${escapeChartTooltipHtml(formatNumber(row?.occupiedBeds))}${escapeChartTooltipHtml(bedSummary)}
              </div>
            </div>
          `;
        },
      }),
      xAxis: {
        ...base.xAxis,
        axisLabel: { ...base.xAxis.axisLabel, interval: 0, rotate: rows.length > 4 ? 24 : 0 },
        data: rows.map((row) => row.ward),
        type: 'category',
      },
      yAxis: {
        ...base.yAxis,
        axisLabel: { ...base.yAxis.axisLabel, formatter: '{value}%' },
        max: 100,
        min: 0,
      },
      series: [{
        barMaxWidth: 42,
        data: rows.map((row, index) => ({
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: theme.palette[index % theme.palette.length],
          },
          record: row,
          value: row.occupancyRate ?? null,
        })),
        name: 'Occupancy',
        type: 'bar',
      }],
    };
  };
}

function buildTrendLineOption({ occupancyData, selectedWard, wards }) {
  return (theme) => {
    const base = createBaseChartOption(theme, 'Ward occupancy trend chart');
    const selectedWardName = selectedWard === 'all' ? null : getWardNameById(wards, selectedWard);
    const visibleWards = selectedWardName
      ? [selectedWardName]
      : wards.slice(0, MAX_COMPARISON_LINES).map((ward) => ward.name);
    const series = [
      ...(selectedWardName ? [] : ['Overall']),
      ...visibleWards,
    ];

    return {
      ...base,
      grid: { ...base.grid, bottom: 52, top: 18 },
      legend: { ...base.legend, show: true },
      tooltip: {
        ...base.tooltip,
        formatter: (params) => {
          const list = getChartTooltipParams(params);
          return `
            <div>
              <div style="color:${theme.muted};font-size:11px;margin-bottom:4px;">${escapeChartTooltipHtml(list[0]?.axisValue || '')}</div>
              ${list.map((param) => `
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${param.color};"></span>
                  <span>${escapeChartTooltipHtml(param.seriesName)}</span>
                  <strong style="margin-left:auto;">${escapeChartTooltipHtml(formatPercent(numericValue(param.value)))}</strong>
                </div>
              `).join('')}
            </div>
          `;
        },
      },
      xAxis: {
        ...base.xAxis,
        data: occupancyData.map((point) => point.date),
        type: 'category',
      },
      yAxis: {
        ...base.yAxis,
        axisLabel: { ...base.yAxis.axisLabel, formatter: '{value}%' },
        max: 100,
        min: 0,
      },
      series: series.map((name, index) => ({
        data: occupancyData.map((point) => numericValue(point[name])),
        lineStyle: {
          color: theme.palette[index % theme.palette.length],
          width: name === 'Overall' ? 3 : 2,
        },
        name,
        showSymbol: occupancyData.length < 16,
        smooth: 0.25,
        symbolSize: name === 'Overall' ? 8 : 6,
        type: 'line',
      })),
    };
  };
}

function TrendStatsTable({ occupancyData, rows, selectedWard, wards }) {
  if (occupancyData.length === 0) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ward</TableHead>
            <TableHead>Current Occupancy</TableHead>
            <TableHead>Occupied Beds</TableHead>
            <TableHead>Total Beds</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.ward}>
              <TableCell className="font-medium">{row.ward}</TableCell>
              <TableCell>{formatPercent(row.occupancyRate)}</TableCell>
              <TableCell>{formatNumber(row.occupiedBeds)}</TableCell>
              <TableCell>{formatNumber(row.totalBeds)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  const selectedWardName = selectedWard === 'all' ? null : getWardNameById(wards, selectedWard);
  const names = selectedWardName ? [selectedWardName] : [...wards.map((ward) => ward.name), 'Overall'];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ward</TableHead>
          <TableHead>Min</TableHead>
          <TableHead>Max</TableHead>
          <TableHead>Average</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {names.map((name) => {
          const values = getFinitePointValues(occupancyData, name);
          return (
            <TableRow key={name}>
              <TableCell className="font-medium">{name}</TableCell>
              <TableCell>{values.length ? formatPercent(Math.min(...values)) : 'Not available'}</TableCell>
              <TableCell>{values.length ? formatPercent(Math.max(...values)) : 'Not available'}</TableCell>
              <TableCell>{values.length ? formatPercent(getAverage(values)) : 'Not available'}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function OccupancyTrendsPanel({
  analyticsMeta,
  occupancyData = DEFAULT_EMPTY_ARRAY,
  utilizationData = DEFAULT_EMPTY_ARRAY,
  wards = DEFAULT_EMPTY_ARRAY,
  selectedWard,
}) {
  const snapshotRows = useMemo(() => getSnapshotRows(utilizationData), [utilizationData]);
  const averageOccupancy = getAverage(snapshotRows.map((row) => row.occupancyRate));
  const occupiedBeds = snapshotRows.reduce((sum, row) => sum + (row.occupiedBeds || 0), 0);
  const totalBeds = snapshotRows.reduce((sum, row) => sum + (row.totalBeds || 0), 0);
  const hasTrendData = occupancyData.length > 0;
  const chartOption = hasTrendData
    ? buildTrendLineOption({ occupancyData, selectedWard, wards })
    : buildSnapshotBarOption(snapshotRows, 'Current ward occupancy snapshot');

  return (
    <div className="space-y-5">
      <SnapshotNotice meta={analyticsMeta} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile icon={Bed} label="Wards In Scope" value={snapshotRows.length} />
        <MetricTile icon={Activity} label="Average Occupancy" tone="sky" value={formatPercent(averageOccupancy)} />
        <MetricTile
          icon={Users}
          label="Occupied Beds"
          meta={totalBeds ? `${totalBeds} total beds` : null}
          tone="emerald"
          value={formatNumber(occupiedBeds)}
        />
        <MetricTile
          icon={TrendingUp}
          label="Trend Coverage"
          meta={hasTrendData ? `${occupancyData.length} date points` : 'Current snapshot only'}
          tone={hasTrendData ? 'emerald' : 'amber'}
          value={hasTrendData ? 'Live' : 'Pending'}
        />
      </div>

      <ChartCard
        description={hasTrendData ? 'Historical occupancy rates over time' : 'Current ward capacity from the Rust V2 ward snapshot'}
        title={hasTrendData ? 'Occupancy Rate Trends' : 'Current Occupancy Snapshot'}
      >
        {snapshotRows.length === 0 && !hasTrendData ? (
          <EmptyAnalyticsState
            title="No ward capacity data"
            body="No aggregate ward capacity data is available for the current filters."
          />
        ) : (
          <HmsEChart
            ariaLabel={hasTrendData ? 'Ward occupancy trend chart' : 'Current ward occupancy snapshot chart'}
            height={360}
            option={chartOption}
          />
        )}
      </ChartCard>

      <ChartCard title={hasTrendData ? 'Occupancy Statistics' : 'Current Ward Snapshot'}>
        <ScrollArea className="max-h-[320px]">
          <TrendStatsTable
            occupancyData={occupancyData}
            rows={snapshotRows}
            selectedWard={selectedWard}
            wards={wards}
          />
        </ScrollArea>
      </ChartCard>
    </div>
  );
}

function buildLengthOfStayDistributionOption(lengthOfStayData) {
  return (theme) => {
    const base = createBaseChartOption(theme, 'Length of stay distribution chart');
    return {
      ...base,
      grid: { ...base.grid, bottom: 48, top: 18 },
      legend: { ...base.legend, show: true },
      tooltip: createItemTooltip(base.tooltip, {
        formatter: (params) => {
          const list = getChartTooltipParams(params);
          return `
            <div>
              <div style="color:${theme.muted};font-size:11px;margin-bottom:4px;">${escapeChartTooltipHtml(list[0]?.axisValue || list[0]?.name || '')}</div>
              ${list.map((param) => `
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${param.color};"></span>
                  <span>${escapeChartTooltipHtml(param.seriesName)}</span>
                  <strong style="margin-left:auto;">${escapeChartTooltipHtml(param.seriesName === 'Percentage' ? formatPercent(numericValue(param.value)) : formatNumber(numericValue(param.value)))}</strong>
                </div>
              `).join('')}
            </div>
          `;
        },
      }),
      xAxis: {
        ...base.xAxis,
        data: lengthOfStayData.map((point) => point.range),
        type: 'category',
      },
      yAxis: [
        { ...base.yAxis, name: 'Patients' },
        {
          ...base.yAxis,
          axisLabel: { ...base.yAxis.axisLabel, formatter: '{value}%' },
          max: 100,
          min: 0,
          name: 'Percent',
        },
      ],
      series: [
        {
          barMaxWidth: 34,
          data: lengthOfStayData.map((point) => numericValue(point.count) ?? 0),
          itemStyle: { color: theme.palette[3], borderRadius: [4, 4, 0, 0] },
          name: 'Patients',
          type: 'bar',
        },
        {
          data: lengthOfStayData.map((point) => numericValue(point.percentage) ?? 0),
          lineStyle: { color: theme.palette[0], width: 2 },
          name: 'Percentage',
          smooth: 0.25,
          type: 'line',
          yAxisIndex: 1,
        },
      ],
    };
  };
}

export function LengthOfStayPanel({
  analyticsMeta,
  lengthOfStayData = DEFAULT_EMPTY_ARRAY,
  utilizationData = DEFAULT_EMPTY_ARRAY,
}) {
  const snapshotRows = useMemo(() => getSnapshotRows(utilizationData), [utilizationData]);
  const hasDistribution = lengthOfStayData.length > 0;
  const hasWardLos = hasMetricValue(snapshotRows, 'avgLos');

  if (!hasDistribution && !hasWardLos) {
    return (
      <div className="space-y-5">
        <SnapshotNotice meta={analyticsMeta} />
        <EmptyAnalyticsState
          title="Length-of-stay analytics are not available yet"
          body="The current Rust V2 ward report adapter does not expose LOS distribution, median, min, or max aggregates. Those fields are hidden instead of derived from averages."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SnapshotNotice meta={analyticsMeta} />
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          description="Distribution of completed patient stays by duration"
          title="Length of Stay Distribution"
        >
          {hasDistribution ? (
            <HmsEChart
              ariaLabel="Length of stay distribution chart"
              height={320}
              option={buildLengthOfStayDistributionOption(lengthOfStayData)}
            />
          ) : (
            <EmptyAnalyticsState
              title="No LOS distribution"
              body="Distribution buckets are not present for the selected filters."
            />
          )}
        </ChartCard>

        <ChartCard title="Average Length of Stay by Ward">
          {hasWardLos ? (
            <HmsEChart
              ariaLabel="Average length of stay by ward chart"
              height={320}
              option={buildSnapshotMetricBarOption(snapshotRows, 'avgLos', 'Average LOS', 'days')}
            />
          ) : (
            <EmptyAnalyticsState
              title="No ward LOS aggregate"
              body="Average LOS by ward is not present for the selected filters."
            />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Length of Stay Analysis">
        <ScrollArea className="max-h-[320px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ward</TableHead>
                <TableHead>Avg LOS</TableHead>
                <TableHead>Bed Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshotRows.map((ward) => (
                <TableRow key={ward.ward}>
                  <TableCell className="font-medium">{ward.ward}</TableCell>
                  <TableCell>{formatNumber(ward.avgLos, ' days')}</TableCell>
                  <TableCell>{formatNumber(ward.bedDays)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </ChartCard>
    </div>
  );
}

function buildSnapshotMetricBarOption(rows, metricKey, title, unit = '') {
  return (theme) => {
    const base = createBaseChartOption(theme, `${title} chart`);
    return {
      ...base,
      grid: { ...base.grid, bottom: 46, top: 18 },
      legend: { ...base.legend, show: false },
      tooltip: createItemTooltip(base.tooltip, {
        formatter: (params) => {
          const row = getChartTooltipDataParam(params)?.data?.record;
          const value = formatNumber(row?.[metricKey], unit ? ` ${unit}` : '');
          return `
            <div>
              <div style="font-weight:600;margin-bottom:4px;">${escapeChartTooltipHtml(row?.ward || '')}</div>
              <div>${escapeChartTooltipHtml(title)}: <strong>${escapeChartTooltipHtml(value)}</strong></div>
            </div>
          `;
        },
      }),
      xAxis: {
        ...base.xAxis,
        axisLabel: { ...base.xAxis.axisLabel, interval: 0, rotate: rows.length > 4 ? 24 : 0 },
        data: rows.map((row) => row.ward),
        type: 'category',
      },
      yAxis: {
        ...base.yAxis,
        axisLabel: { ...base.yAxis.axisLabel, formatter: `{value}${unit ? ` ${unit}` : ''}` },
        scale: true,
      },
      series: [{
        barMaxWidth: 42,
        data: rows.map((row, index) => ({
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: theme.palette[index % theme.palette.length],
          },
          record: row,
          value: row[metricKey],
        })),
        name: title,
        type: 'bar',
      }],
    };
  };
}

export function UtilizationPanel({
  analyticsMeta,
  utilizationData = DEFAULT_EMPTY_ARRAY,
}) {
  const snapshotRows = useMemo(() => getSnapshotRows(utilizationData), [utilizationData]);
  const hasTurnover = hasMetricValue(snapshotRows, 'turnoverRate');

  return (
    <div className="space-y-5">
      <SnapshotNotice meta={analyticsMeta} />
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          description="Current capacity snapshot by ward"
          title="Occupancy by Ward"
        >
          {snapshotRows.length ? (
            <HmsEChart
              ariaLabel="Occupancy by ward chart"
              height={320}
              option={buildSnapshotBarOption(snapshotRows, 'Occupancy by ward')}
            />
          ) : (
            <EmptyAnalyticsState title="No utilization data" body="No ward utilization aggregates are available." />
          )}
        </ChartCard>

        <ChartCard
          description="Shown only when the backend provides turnover aggregates"
          title="Turnover Rate by Ward"
        >
          {hasTurnover ? (
            <HmsEChart
              ariaLabel="Turnover rate by ward chart"
              height={320}
              option={buildSnapshotMetricBarOption(snapshotRows, 'turnoverRate', 'Turnover Rate')}
            />
          ) : (
            <EmptyAnalyticsState
              title="Turnover rate unavailable"
              body="The current report data does not include turnover-rate aggregates."
            />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Ward Utilization Metrics">
        <ScrollArea className="max-h-[360px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ward</TableHead>
                <TableHead>Occupancy</TableHead>
                <TableHead>Occupied Beds</TableHead>
                <TableHead>Total Beds</TableHead>
                <TableHead>Turnover</TableHead>
                <TableHead>Avg LOS</TableHead>
                <TableHead>Bed Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshotRows.map((ward) => (
                <TableRow key={ward.ward}>
                  <TableCell className="font-medium">{ward.ward}</TableCell>
                  <TableCell>{formatPercent(ward.occupancyRate)}</TableCell>
                  <TableCell>{formatNumber(ward.occupiedBeds)}</TableCell>
                  <TableCell>{formatNumber(ward.totalBeds)}</TableCell>
                  <TableCell>{formatNumber(ward.turnoverRate)}</TableCell>
                  <TableCell>{formatNumber(ward.avgLos, ' days')}</TableCell>
                  <TableCell>{formatNumber(ward.bedDays)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </ChartCard>
    </div>
  );
}

function buildAdmissionsOption(admissionsByWard) {
  return (theme) => {
    const base = createBaseChartOption(theme, 'Admissions discharges and transfers by ward chart');
    return {
      ...base,
      grid: { ...base.grid, bottom: 48, top: 18 },
      legend: { ...base.legend, show: true },
      tooltip: createItemTooltip(base.tooltip, {
        formatter: (params) => {
          const list = getChartTooltipParams(params);
          return `
            <div>
              <div style="color:${theme.muted};font-size:11px;margin-bottom:4px;">${escapeChartTooltipHtml(list[0]?.axisValue || list[0]?.name || '')}</div>
              ${list.map((param) => `
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                  <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${param.color};"></span>
                  <span>${escapeChartTooltipHtml(param.seriesName)}</span>
                  <strong style="margin-left:auto;">${escapeChartTooltipHtml(formatNumber(numericValue(param.value)))}</strong>
                </div>
              `).join('')}
            </div>
          `;
        },
      }),
      xAxis: {
        ...base.xAxis,
        axisLabel: { ...base.xAxis.axisLabel, interval: 0, rotate: admissionsByWard.length > 4 ? 20 : 0 },
        data: admissionsByWard.map((ward) => ward.ward),
        type: 'category',
      },
      yAxis: {
        ...base.yAxis,
        minInterval: 1,
      },
      series: [
        {
          barMaxWidth: 28,
          data: admissionsByWard.map((ward) => numericValue(ward.admissions) ?? 0),
          itemStyle: { color: theme.palette[3], borderRadius: [4, 4, 0, 0] },
          name: 'Admissions',
          type: 'bar',
        },
        {
          barMaxWidth: 28,
          data: admissionsByWard.map((ward) => numericValue(ward.discharges) ?? 0),
          itemStyle: { color: theme.palette[1], borderRadius: [4, 4, 0, 0] },
          name: 'Discharges',
          type: 'bar',
        },
        {
          barMaxWidth: 28,
          data: admissionsByWard.map((ward) => numericValue(ward.transfers) ?? 0),
          itemStyle: { color: theme.palette[0], borderRadius: [4, 4, 0, 0] },
          name: 'Transfers',
          type: 'bar',
        },
      ],
    };
  };
}

export function AdmissionsPanel({
  admissionsByWard = DEFAULT_EMPTY_ARRAY,
  analyticsMeta,
  wards = DEFAULT_EMPTY_ARRAY,
}) {
  if (admissionsByWard.length === 0) {
    return (
      <div className="space-y-5">
        <SnapshotNotice meta={analyticsMeta} />
        <EmptyAnalyticsState
          title="Admissions analytics are not available yet"
          body="The current report data does not expose admissions, discharge, or transfer aggregates. The previous placeholder that treated occupied beds as admissions has been removed."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SnapshotNotice meta={analyticsMeta} />
      <ChartCard title="Admissions, Discharges, and Transfers by Ward">
        <HmsEChart
          ariaLabel="Admissions discharges and transfers by ward chart"
          height={360}
          option={buildAdmissionsOption(admissionsByWard)}
        />
      </ChartCard>

      <ChartCard title="Admission Statistics">
        <ScrollArea className="max-h-[320px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ward</TableHead>
                <TableHead>Admissions</TableHead>
                <TableHead>Discharges</TableHead>
                <TableHead>Transfers</TableHead>
                <TableHead>Net Change</TableHead>
                <TableHead>Admission Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admissionsByWard.map((ward) => {
                const netChange = (ward.admissions || 0) - (ward.discharges || 0);
                const matchingWard = wards.find((item) => item.name === ward.ward);
                const totalBeds = numericValue(matchingWard?.total_beds);
                const admissionRate = totalBeds ? ward.admissions / totalBeds : null;

                return (
                  <TableRow key={ward.ward}>
                    <TableCell className="font-medium">{ward.ward}</TableCell>
                    <TableCell>{formatNumber(ward.admissions)}</TableCell>
                    <TableCell>{formatNumber(ward.discharges)}</TableCell>
                    <TableCell>{formatNumber(ward.transfers)}</TableCell>
                    <TableCell className={cn(netChange > 0 && 'text-emerald-700', netChange < 0 && 'text-rose-700')}>
                      {netChange > 0 ? `+${netChange}` : netChange}
                    </TableCell>
                    <TableCell>{formatNumber(admissionRate)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </ChartCard>
    </div>
  );
}
