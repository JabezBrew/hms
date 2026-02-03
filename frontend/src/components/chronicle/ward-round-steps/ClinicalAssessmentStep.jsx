import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Thermometer from 'lucide-react/dist/esm/icons/thermometer.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Wind from 'lucide-react/dist/esm/icons/wind.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
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

import format from 'date-fns/format';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { nursingKeys } from '@/hooks/useNursingQueries';

/**
 * Fetch vital signs for a patient (last 48 hours)
 */
async function fetchVitalSigns(patientId) {
  const response = await apiClient.get(`/nursing/vital-signs/`, {
    params: {
      patient: patientId,
      hours: 48,
      ordering: '-recorded_at',
    },
  });
  return response.results || response || [];
}

/**
 * Prepare chart data from vitals array
 */
function prepareChartData(vitals) {
  if (!vitals || vitals.length === 0) return [];

  return vitals
    .slice()
    .reverse()
    .map((v) => ({
      time: format(new Date(v.recorded_at), 'HH:mm'),
      date: format(new Date(v.recorded_at), 'MMM d'),
      temperature: v.temperature ? parseFloat(v.temperature) : null,
      heart_rate: v.heart_rate,
      respiratory_rate: v.respiratory_rate,
      systolic: v.systolic_bp,
      diastolic: v.diastolic_bp,
      spo2: v.spo2,
      recorded_at: v.recorded_at,
    }));
}

/**
 * VitalsChart - Individual vital sign trend chart
 */
function VitalsChart({ data, dataKey, title, color, domain, unit, referenceLines = [], secondaryKey = null, secondaryColor = null }) {
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

/**
 * LatestVitalsCard - Shows the most recent vital signs
 */
function LatestVitalsCard({ vitals }) {
  const latest = vitals?.[0];

  if (!latest) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>No vital signs recorded in the last 48 hours.</AlertDescription>
      </Alert>
    );
  }

  const recordedAt = new Date(latest.recorded_at);
  const isRecent = (Date.now() - recordedAt.getTime()) < 8 * 60 * 60 * 1000; // Less than 8 hours

  return (
    <Card className={isRecent ? 'border-green-500/30' : 'border-amber-500/30'}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Latest Vitals</CardTitle>
          <Badge variant={isRecent ? 'default' : 'secondary'} className="font-mono text-xs">
            {format(recordedAt, 'MMM d, HH:mm')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-orange-500" />
            <div>
              <p className="text-xs text-muted-foreground">Temp</p>
              <p className="font-mono font-medium">
                {latest.temperature ? `${latest.temperature}°C` : '-'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-red-500" />
            <div>
              <p className="text-xs text-muted-foreground">HR</p>
              <p className="font-mono font-medium">
                {latest.heart_rate ? `${latest.heart_rate} bpm` : '-'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">BP</p>
              <p className="font-mono font-medium">
                {latest.systolic_bp && latest.diastolic_bp
                  ? `${latest.systolic_bp}/${latest.diastolic_bp}`
                  : '-'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Wind className="h-4 w-4 text-cyan-500" />
            <div>
              <p className="text-xs text-muted-foreground">RR</p>
              <p className="font-mono font-medium">
                {latest.respiratory_rate ? `${latest.respiratory_rate}/min` : '-'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Droplets className="h-4 w-4 text-purple-500" />
            <div>
              <p className="text-xs text-muted-foreground">SpO2</p>
              <p className="font-mono font-medium">
                {latest.spo2 ? `${latest.spo2}%` : '-'}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * ClinicalAssessmentStep - Step 2 of Ward Round Workflow
 *
 * Displays vital signs trends and captures:
 * - Vitals reviewed confirmation
 * - Examination findings
 */
export function ClinicalAssessmentStep({ formData, onChange, contextData, validationErrors, patientId }) {
  const [localData, setLocalData] = useState({
    examination_findings: formData?.examination_findings || '',
    vitals_reviewed: formData?.vitals_reviewed || false,
  });

  // Fetch vital signs
  const { data: vitals, isLoading: vitalsLoading } = useQuery({
    queryKey: nursingKeys.vitalSignsWindow(patientId, '48h'),
    queryFn: () => fetchVitalSigns(patientId),
    enabled: !!patientId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Sync with parent when local data changes
  useEffect(() => {
    onChange(localData);
  }, [localData, onChange]);

  // Update local data from props if they change externally
  useEffect(() => {
    if (formData) {
      setLocalData(prev => ({
        examination_findings: formData.examination_findings ?? prev.examination_findings,
        vitals_reviewed: formData.vitals_reviewed ?? prev.vitals_reviewed,
      }));
    }
  }, [formData?.examination_findings, formData?.vitals_reviewed]);

  const handleChange = (field, value) => {
    setLocalData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const chartData = prepareChartData(vitals);

  return (
    <div className="space-y-6">
      {/* Latest Vitals Summary */}
      <LatestVitalsCard vitals={vitals} />

      {/* Vitals Trends */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Vital Signs Trends (48 hours)
          </CardTitle>
          <CardDescription>
            Review trends before confirming vitals review
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {vitalsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-[180px] w-full" />
              <Skeleton className="h-[180px] w-full" />
            </div>
          ) : (
            <div className="grid gap-6">
              {/* Temperature */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Thermometer className="h-4 w-4 text-orange-500" />
                  Temperature (°C)
                </h4>
                <VitalsChart
                  data={chartData}
                  dataKey="temperature"
                  title="Temperature"
                  color="#f97316"
                  domain={[35, 40]}
                  unit="°C"
                  referenceLines={[
                    { value: 38, color: '#ef4444', label: 'Fever' },
                    { value: 36, color: '#3b82f6', label: 'Low' },
                  ]}
                />
              </div>

              {/* Blood Pressure */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-500" />
                  Blood Pressure (mmHg)
                </h4>
                <VitalsChart
                  data={chartData}
                  dataKey="systolic"
                  secondaryKey="diastolic"
                  title="Systolic"
                  color="#ef4444"
                  secondaryColor="#22c55e"
                  domain={[40, 200]}
                  unit="mmHg"
                  referenceLines={[
                    { value: 140, color: '#ef4444', label: 'High' },
                    { value: 90, color: '#3b82f6', label: 'Low' },
                  ]}
                />
              </div>

              {/* Heart Rate */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Heart className="h-4 w-4 text-red-500" />
                  Heart Rate (bpm)
                </h4>
                <VitalsChart
                  data={chartData}
                  dataKey="heart_rate"
                  title="Heart Rate"
                  color="#ef4444"
                  domain={[40, 150]}
                  unit="bpm"
                  referenceLines={[
                    { value: 100, color: '#f97316', label: 'Tachy' },
                    { value: 60, color: '#3b82f6', label: 'Brady' },
                  ]}
                />
              </div>

              {/* SpO2 */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Droplets className="h-4 w-4 text-purple-500" />
                  Oxygen Saturation (%)
                </h4>
                <VitalsChart
                  data={chartData}
                  dataKey="spo2"
                  title="SpO2"
                  color="#8b5cf6"
                  domain={[85, 100]}
                  unit="%"
                  referenceLines={[
                    { value: 92, color: '#ef4444', label: 'Low' },
                  ]}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vitals Reviewed Checkbox */}
      <div className="flex items-start space-x-3 p-4 rounded-lg border bg-muted/30">
        <Checkbox
          id="vitals_reviewed"
          checked={localData.vitals_reviewed}
          onCheckedChange={(checked) => handleChange('vitals_reviewed', checked)}
          className="mt-0.5"
        />
        <div className="space-y-1">
          <Label
            htmlFor="vitals_reviewed"
            className="text-sm font-medium cursor-pointer"
          >
            I have reviewed the patient's vital signs *
          </Label>
          <p className="text-xs text-muted-foreground">
            Confirm that you have reviewed the vital sign trends above before proceeding.
          </p>
        </div>
      </div>
      {validationErrors?.vitals_reviewed && (
        <p className="text-sm text-destructive">{validationErrors.vitals_reviewed}</p>
      )}

      {/* Examination Findings */}
      <div className="space-y-2">
        <Label htmlFor="examination_findings" className="text-sm font-medium">
          Examination Findings *
        </Label>
        <Textarea
          id="examination_findings"
          value={localData.examination_findings}
          onChange={(e) => handleChange('examination_findings', e.target.value)}
          placeholder="Document physical examination findings...&#10;&#10;General appearance, cardiovascular, respiratory, abdominal, neurological, etc."
          rows={8}
          className={`resize-none ${validationErrors?.examination_findings ? 'border-destructive' : ''}`}
        />
        {validationErrors?.examination_findings && (
          <p className="text-sm text-destructive">{validationErrors.examination_findings}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Include relevant positive and negative findings from your examination.
        </p>
      </div>
    </div>
  );
}

export default ClinicalAssessmentStep;
