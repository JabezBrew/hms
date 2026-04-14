import { useMemo } from 'react';
import X from 'lucide-react/dist/esm/icons/x.js';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js';
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert.js';
import { format } from 'date-fns';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFluidBalanceTrends, useVitalSignsTrends } from '@/features/nursing/hooks';
import VitalsChart from '@/components/chronicle/ward-round-steps/ClinicalAssessmentVitalsChart';
import FluidBalanceTrendsChart from '@/components/nursing/FluidBalanceTrendsChart';

function getPatientId(patient) {
  return patient?.local_data?.id || patient?.id || null;
}

function getPatientName(patient) {
  const firstName = patient?.local_data?.user_details?.first_name || patient?.user_details?.first_name || '';
  const lastName = patient?.local_data?.user_details?.last_name || patient?.user_details?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || patient?.name || 'Patient';
}

function formatScopeLabel({ allHistory, encounterId, admissionId }) {
  if (allHistory) {
    return 'All history';
  }
  if (encounterId) {
    return 'Visit scoped';
  }
  if (admissionId) {
    return 'Admission scoped';
  }
  return 'Patient scoped';
}

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
        <CircleAlert className="h-5 w-5 text-muted-foreground" />
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

export default function TrendReviewSlideOver({
  open,
  onClose,
  patient,
  encounterId = null,
  admissionId = null,
  allHistory = false,
}) {
  const patientId = getPatientId(patient);
  const patientName = getPatientName(patient);

  const vitalsFilters = useMemo(() => {
    if (allHistory) {
      return {};
    }
    if (encounterId) {
      return { encounter_id: encounterId };
    }
    if (admissionId) {
      return { admission_id: admissionId };
    }
    return {};
  }, [admissionId, allHistory, encounterId]);

  const fluidFilters = useMemo(() => {
    if (allHistory || !admissionId) {
      return {};
    }
    return { admission_id: admissionId };
  }, [admissionId, allHistory]);

  const {
    data: vitalsData = [],
    isLoading: vitalsLoading,
  } = useVitalSignsTrends(patientId, vitalsFilters, {
    enabled: open && !!patientId,
  });

  const {
    data: fluidTrendData = [],
    isLoading: fluidLoading,
  } = useFluidBalanceTrends(patientId, fluidFilters, {
    enabled: open && !!patientId && (allHistory || !!admissionId),
  });

  const formattedVitals = useMemo(() => (
    vitalsData.map((entry) => {
      const recordedAt = entry.recorded_at ? new Date(entry.recorded_at) : null;
      return {
        time: recordedAt ? format(recordedAt, 'HH:mm') : '',
        date: recordedAt ? format(recordedAt, 'MMM d') : '',
        temperature: entry.temperature == null ? null : Number(entry.temperature),
        heartRate: entry.heart_rate == null ? null : Number(entry.heart_rate),
        systolic: entry.blood_pressure_systolic == null ? null : Number(entry.blood_pressure_systolic),
        diastolic: entry.blood_pressure_diastolic == null ? null : Number(entry.blood_pressure_diastolic),
        respiratoryRate: entry.respiratory_rate == null ? null : Number(entry.respiratory_rate),
        oxygenSaturation: entry.oxygen_saturation == null ? null : Number(entry.oxygen_saturation),
        painLevel: entry.pain_level == null ? null : Number(entry.pain_level),
      };
    })
  ), [vitalsData]);

  const latestVitals = formattedVitals[formattedVitals.length - 1] || null;

  const fluidSummary = useMemo(() => (
    fluidTrendData.reduce((acc, point) => ({
      totalIntake: acc.totalIntake + Number(point.intake || 0),
      totalOutput: acc.totalOutput + Number(point.output || 0),
      totalBalance: acc.totalBalance + Number(point.balance || 0),
    }), { totalIntake: 0, totalOutput: 0, totalBalance: 0 })
  ), [fluidTrendData]);

  const latestFluidPoint = fluidTrendData[fluidTrendData.length - 1] || null;
  const scopeLabel = formatScopeLabel({ allHistory, encounterId, admissionId });

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full border-l border-border bg-background shadow-2xl transition-transform duration-300 ease-in-out lg:w-1/2',
        'flex flex-col',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <BarChart3 className="h-5 w-5" />
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
            <X className="mr-1.5 h-4 w-4" />
            Close
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          <Tabs defaultValue="vitals" className="space-y-6">
            <TabsList className="grid w-full grid-cols-2 bg-muted/50">
              <TabsTrigger value="vitals" className="font-mono text-xs">
                <Activity className="mr-1.5 h-3.5 w-3.5" />
                Vitals
              </TabsTrigger>
              <TabsTrigger value="fluids" className="font-mono text-xs">
                <Droplets className="mr-1.5 h-3.5 w-3.5" />
                Fluid Balance
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vitals" className="space-y-6">
              {vitalsLoading ? (
                <LoadingState label="Loading vital-sign trends..." />
              ) : formattedVitals.length === 0 ? (
                <EmptyState
                  title="No vitals in this scope"
                  body="No vital-sign observations were found for the current visit scope. Record vitals first, then return here to review the trend."
                />
              ) : (
                <>
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

                  <div className="grid gap-4 xl:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="font-heading text-base">Temperature</CardTitle>
                        <CardDescription>Spot fever and hypothermia changes over time.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <VitalsChart
                          data={formattedVitals}
                          dataKey="temperature"
                          title="Temperature"
                          color="#dc2626"
                          unit="°C"
                          domain={['dataMin - 0.5', 'dataMax + 0.5']}
                          referenceLines={[
                            { value: 36, label: 'Low', color: '#f59e0b' },
                            { value: 39, label: 'High', color: '#dc2626' },
                          ]}
                        />
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="font-heading text-base">Blood Pressure</CardTitle>
                        <CardDescription>Systolic and diastolic are plotted separately.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <VitalsChart
                          data={formattedVitals}
                          dataKey="systolic"
                          secondaryKey="diastolic"
                          title="Systolic"
                          color="#1d4ed8"
                          secondaryColor="#60a5fa"
                          unit="mmHg"
                          domain={[40, 220]}
                          referenceLines={[
                            { value: 90, label: 'Low', color: '#f59e0b' },
                            { value: 180, label: 'High', color: '#dc2626' },
                          ]}
                        />
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="font-heading text-base">Cardiorespiratory</CardTitle>
                        <CardDescription>Heart rate and respiratory rate trends.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div>
                          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Heart Rate
                          </p>
                          <VitalsChart
                            data={formattedVitals}
                            dataKey="heartRate"
                            title="Heart Rate"
                            color="#be123c"
                            unit="bpm"
                            domain={[20, 220]}
                          />
                        </div>
                        <div>
                          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Respiratory Rate
                          </p>
                          <VitalsChart
                            data={formattedVitals}
                            dataKey="respiratoryRate"
                            title="Respiratory Rate"
                            color="#9333ea"
                            unit="/min"
                            domain={[0, 60]}
                          />
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="font-heading text-base">Oxygenation and Pain</CardTitle>
                        <CardDescription>SpO2 and pain scale over the same clinical window.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div>
                          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Oxygen Saturation
                          </p>
                          <VitalsChart
                            data={formattedVitals}
                            dataKey="oxygenSaturation"
                            title="SpO2"
                            color="#0f766e"
                            unit="%"
                            domain={[50, 100]}
                            referenceLines={[
                              { value: 92, label: 'Low', color: '#dc2626' },
                            ]}
                          />
                        </div>
                        <div>
                          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            Pain Score
                          </p>
                          <VitalsChart
                            data={formattedVitals}
                            dataKey="painLevel"
                            title="Pain"
                            color="#ea580c"
                            unit="/10"
                            domain={[0, 10]}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="fluids" className="space-y-6">
              {!allHistory && !admissionId ? (
                <EmptyState
                  title="Fluid balance is admission scoped"
                  body="This patient does not have an active admission in the current visit context, so there is no fluid-balance trend to review here."
                />
              ) : fluidLoading ? (
                <LoadingState label="Loading fluid-balance trends..." />
              ) : fluidTrendData.length === 0 ? (
                <EmptyState
                  title="No fluid-balance data in this scope"
                  body="No intake or output records were found for the current scope. Record fluid balance first, then return here to review the trend."
                />
              ) : (
                <>
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
                      value={latestFluidPoint?.date ? format(new Date(latestFluidPoint.date), 'MMM d') : '—'}
                      meta={latestFluidPoint ? `Intake ${latestFluidPoint.intake} mL • Output ${latestFluidPoint.output} mL` : null}
                    />
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="font-heading text-base">Fluid Balance Trend</CardTitle>
                      <CardDescription>
                        Review daily intake, output, and net balance without leaving the patient chronicle.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        <Clock3 className="h-4 w-4" />
                        Daily totals are aggregated from recorded intake and output entries.
                      </div>
                      <FluidBalanceTrendsChart data={fluidTrendData} />
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
