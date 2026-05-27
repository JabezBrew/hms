import X from 'lucide-react/dist/esm/icons/x.js';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js';
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert.js';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ClinicalTrendLineChart from '@/components/chronicle/ClinicalTrendLineChart';
import FluidBalanceTrendsChart from '@/components/nursing/FluidBalanceTrendsChart';

function TrendStatCard({ label, value, accent = 'text-foreground', meta = null }) {
  return (
    <Card className="border-border/70 bg-card/80">
      <CardContent className="space-y-1 p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p className={cn('font-display text-2xl leading-none', accent)}>
          {value}
        </p>
        {meta ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            {meta}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, body }) {
  return (
    <Card className="border-dashed border-border/70 bg-muted/20">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <CircleAlert className="size-5 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-heading text-sm text-foreground">{title}</p>
          <p className="max-w-md text-sm text-muted-foreground">{body}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingState({ label }) {
  return (
    <div className="space-y-3">
      <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
      <div className="h-72 animate-pulse rounded-xl bg-muted/40" />
      <p className="font-mono text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function TrendReviewHeader({
  admissionId,
  allHistory,
  encounterId,
  onClose,
  patientName,
  scopeLabel,
}) {
  return (
    <header className="border-b border-border bg-card px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <BarChart3 className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-xl text-foreground">Trend Review</h2>
              <p className="font-mono text-xs text-muted-foreground">{patientName}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[11px] uppercase tracking-[0.16em]">
              {scopeLabel}
            </Badge>
            {encounterId && !allHistory ? (
              <Badge variant="secondary" className="font-mono text-[11px]">Vitals follow the selected visit</Badge>
            ) : null}
            {admissionId && !allHistory ? (
              <Badge variant="secondary" className="font-mono text-[11px]">Fluid balance follows the admission</Badge>
            ) : null}
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs"
        >
          <X className="mr-1.5 size-4" />
          Close
        </Button>
      </div>
    </header>
  );
}

function VitalsSummary({ latestVitals }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <TrendStatCard
        label="Latest Temperature"
        value={latestVitals?.temperature != null ? `${latestVitals.temperature.toFixed(1)} °C` : '—'}
      />
      <TrendStatCard
        label="Latest Heart Rate"
        value={latestVitals?.heartRate != null ? `${latestVitals.heartRate} bpm` : '—'}
      />
      <TrendStatCard
        label="Latest Blood Pressure"
        value={latestVitals?.systolic != null && latestVitals?.diastolic != null
          ? `${latestVitals.systolic}/${latestVitals.diastolic}`
          : '—'}
      />
      <TrendStatCard
        label="Latest SpO2"
        value={latestVitals?.oxygenSaturation != null ? `${latestVitals.oxygenSaturation}%` : '—'}
        meta={latestVitals ? `Last captured ${latestVitals.date} ${latestVitals.time}` : null}
      />
    </div>
  );
}

function VitalsChartCard({ title, description, children }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function VitalsCharts({ formattedVitals }) {
  return (
    <div className="space-y-4">
      <VitalsChartCard title="Temperature" description="Normal range 36.1 – 38.0 °C">
        <ClinicalTrendLineChart
          data={formattedVitals}
          series={[{ key: 'temperature', label: 'Temperature', color: '#dc2626' }]}
          unit="°C"
          yAxisLabel="°C"
          normalRange={{ low: 36.1, high: 38.0 }}
        />
      </VitalsChartCard>

      <VitalsChartCard
        title="Blood Pressure"
        description="Systolic normal 90 – 140 mmHg · Diastolic normal 60 – 90 mmHg"
      >
        <ClinicalTrendLineChart
          data={formattedVitals}
          series={[
            { key: 'systolic', label: 'Systolic', color: '#1d4ed8' },
            { key: 'diastolic', label: 'Diastolic', color: '#60a5fa' },
          ]}
          unit="mmHg"
          yAxisLabel="mmHg"
          normalRange={{ low: 60, high: 140 }}
          showLegend
        />
      </VitalsChartCard>

      <VitalsChartCard title="Heart Rate" description="Normal range 60 – 100 bpm">
        <ClinicalTrendLineChart
          data={formattedVitals}
          series={[{ key: 'heartRate', label: 'Heart Rate', color: '#be123c' }]}
          unit="bpm"
          yAxisLabel="bpm"
          normalRange={{ low: 60, high: 100 }}
        />
      </VitalsChartCard>

      <VitalsChartCard title="Respiratory Rate" description="Normal range 12 – 20 /min">
        <ClinicalTrendLineChart
          data={formattedVitals}
          series={[{ key: 'respiratoryRate', label: 'Respiratory Rate', color: '#9333ea' }]}
          unit="/min"
          yAxisLabel="/min"
          normalRange={{ low: 12, high: 20 }}
        />
      </VitalsChartCard>

      <VitalsChartCard title="Oxygen Saturation" description="Normal range 94 – 100%">
        <ClinicalTrendLineChart
          data={formattedVitals}
          series={[{ key: 'oxygenSaturation', label: 'SpO2', color: '#0f766e' }]}
          unit="%"
          yAxisLabel="%"
          normalRange={{ low: 94, high: 100 }}
        />
      </VitalsChartCard>

      <VitalsChartCard title="Pain Score" description="Subjective 0 – 10 scale">
        <ClinicalTrendLineChart
          data={formattedVitals}
          series={[{ key: 'painLevel', label: 'Pain', color: '#ea580c' }]}
          unit="/10"
          yAxisLabel="/10"
        />
      </VitalsChartCard>
    </div>
  );
}

function VitalsTrendTab({
  formattedVitals,
  latestVitals,
  scopeLabel,
  vitalsLoading,
}) {
  if (vitalsLoading) {
    return <LoadingState label="Loading vital-sign trends..." />;
  }

  if (formattedVitals.length === 0) {
    return (
      <EmptyState
        title="No vitals in this scope"
        body={`No vital-sign observations were found for ${scopeLabel.toLowerCase()}. Record vitals in the chronicle, then return here to review the trend.`}
      />
    );
  }

  return (
    <>
      <VitalsSummary latestVitals={latestVitals} />
      <VitalsCharts formattedVitals={formattedVitals} />
    </>
  );
}

function FluidSummary({ fluidSummary, latestFluidPoint }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <TrendStatCard
        label="Total Intake"
        value={`${fluidSummary.totalIntake} mL`}
        accent="text-sky-700 dark:text-sky-300"
      />
      <TrendStatCard
        label="Total Output"
        value={`${fluidSummary.totalOutput} mL`}
        accent="text-amber-700 dark:text-amber-300"
      />
      <TrendStatCard
        label="Net Balance"
        value={`${fluidSummary.totalBalance} mL`}
        accent={fluidSummary.totalBalance < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}
      />
      <TrendStatCard
        label="Latest Day"
        value={latestFluidPoint?.fullDateLabel || '—'}
        meta={latestFluidPoint ? `Intake ${latestFluidPoint.intake} mL • Output ${latestFluidPoint.output} mL` : null}
      />
    </div>
  );
}

function FluidTrendCard({ formattedFluidTrendData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">Fluid Balance Trend</CardTitle>
        <CardDescription>
          Review daily intake, output, and net balance without leaving the patient chronicle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          <Clock3 className="size-4" />
          Daily totals are aggregated from recorded intake and output entries.
        </div>
        <FluidBalanceTrendsChart data={formattedFluidTrendData} />
      </CardContent>
    </Card>
  );
}

function FluidBalanceTab({
  fluidLoading,
  fluidSummary,
  formattedFluidTrendData,
  latestFluidPoint,
  scopeLabel,
}) {
  if (fluidLoading) {
    return <LoadingState label="Loading fluid-balance trends..." />;
  }

  if (formattedFluidTrendData.length === 0) {
    return (
      <EmptyState
        title="No fluid-balance data in this scope"
        body={`No intake or output records were found for ${scopeLabel.toLowerCase()}. Record fluid balance in the chronicle, then return here to review the trend.`}
      />
    );
  }

  return (
    <>
      <FluidSummary fluidSummary={fluidSummary} latestFluidPoint={latestFluidPoint} />
      <FluidTrendCard formattedFluidTrendData={formattedFluidTrendData} />
    </>
  );
}

export function TrendReviewSlideOverPanel({
  activeTab,
  admissionId,
  allHistory,
  encounterId,
  fluidLoading,
  fluidSummary,
  formattedFluidTrendData,
  formattedVitals,
  latestFluidPoint,
  latestVitals,
  onClose,
  onTabChange,
  patientName,
  scopeLabel,
  showFluidTab,
  vitalsLoading,
}) {
  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full border-l border-border bg-background shadow-2xl transition-transform duration-300 ease-in-out lg:w-1/2',
        'flex flex-col',
        'translate-x-0',
      )}
    >
      <TrendReviewHeader
        admissionId={admissionId}
        allHistory={allHistory}
        encounterId={encounterId}
        onClose={onClose}
        patientName={patientName}
        scopeLabel={scopeLabel}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        <div className="space-y-6 pb-8">
          <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
            <TabsList className={cn('grid w-full bg-muted/50', showFluidTab ? 'grid-cols-2' : 'grid-cols-1')}>
              <TabsTrigger value="vitals" className="font-mono text-xs">
                <Activity className="mr-1.5 size-3.5" />
                Vitals
              </TabsTrigger>
              {showFluidTab ? (
                <TabsTrigger value="fluids" className="font-mono text-xs">
                  <Droplets className="mr-1.5 size-3.5" />
                  Fluid Balance
                </TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent value="vitals" className="space-y-6">
              <VitalsTrendTab
                formattedVitals={formattedVitals}
                latestVitals={latestVitals}
                scopeLabel={scopeLabel}
                vitalsLoading={vitalsLoading}
              />
            </TabsContent>

            {showFluidTab ? (
              <TabsContent value="fluids" className="space-y-6">
                <FluidBalanceTab
                  fluidLoading={fluidLoading}
                  fluidSummary={fluidSummary}
                  formattedFluidTrendData={formattedFluidTrendData}
                  latestFluidPoint={latestFluidPoint}
                  scopeLabel={scopeLabel}
                />
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
