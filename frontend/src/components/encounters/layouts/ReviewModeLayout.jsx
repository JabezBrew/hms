import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { usePatientTimeline, flattenTimelinePages } from '@/hooks/useTimelineQueries';
import { TimelineEntry } from '@/components/chronicle';
import {
  User,
  Calendar,
  FileText,
  Activity,
  AlertTriangle,
  ClipboardList,
  Pill,
  Stethoscope,
  Clock,
} from 'lucide-react';

/**
 * Review Mode Layout
 * 3-column layout for quick patient overview
 * Inspired by the EHR wireframe - Patient | Clinical Workflow | Live Data
 */
export function ReviewModeLayout({ encounter, formatDate, getStatusBadge, clinicalNotes }) {
  const getInitials = (name) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Fetch timeline entries filtered by this encounter
  const patientId = encounter?.patient;
  const encounterId = encounter?.id;

  const {
    data: timelineData,
    isLoading: isTimelineLoading,
  } = usePatientTimeline(patientId, {
    encounterId: encounterId,
    pageSize: 50,
    enabled: !!patientId && !!encounterId,
  });

  // Transform timeline entries
  const timelineEntries = useMemo(() => {
    if (!timelineData) return [];
    const flatEntries = flattenTimelinePages(timelineData);

    return flatEntries.map(entry => {
      let displayType = entry.type;
      if (entry.entry_type === 'prescription') {
        displayType = 'medication';
      }
      if (entry.entry_type === 'vitals' && entry.data) {
        return {
          ...entry,
          type: 'vitals',
          data: {
            temperature: entry.data.temperature,
            blood_pressure: entry.data.blood_pressure,
            heart_rate: entry.data.heart_rate,
            spo2: entry.data.oxygen_saturation,
            respiratory_rate: entry.data.respiratory_rate,
            pain_level: entry.data.pain_level,
          }
        };
      }
      if (entry.entry_type === 'prescription' && entry.data) {
        return {
          ...entry,
          type: 'medication',
          data: {
            name: entry.data.medication_name,
            dose: entry.data.dosage,
            route: entry.data.route_display,
            frequency: entry.data.frequency_display,
            notes: entry.data.instructions,
          }
        };
      }
      return { ...entry, type: displayType };
    });
  }, [timelineData]);

  // Mock data - replace with actual API calls
  const patientInfo = {
    name: encounter.patient_name || 'Unknown Patient',
    mrn: encounter.patient_medical_record_number || 'N/A',
    dob: '1985-06-12', // Mock - should come from patient data
    allergies: ['Penicillin'], // Mock
    activeProblems: ['Hypertension', 'Type 2 Diabetes'], // Mock
  };

  const vitals = {
    bp: '130/80',
    hr: '78',
    spo2: '98%',
    updatedAt: '14:30',
  };

  const clinicalAlerts = [
    {
      id: 1,
      severity: 'warning',
      message: 'Flag: Low Hb — consider iron studies and clinical correlation.',
    },
  ];

  const tasks = [
    { id: 1, description: 'Order iron studies', completed: false },
    { id: 2, description: 'Phone patient re: results', completed: false },
  ];

  const recentResults = [
    { test: 'Hb', value: '10.8 g/dL', flag: '(Low)', reference: '12-16', date: '2025-10-31', abnormal: true },
    { test: 'Glucose (Fasting)', value: '7.2 mmol/L', flag: '', reference: '3.9-5.5', date: '2025-10-30', abnormal: false },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* LEFT COLUMN: Patient Context */}
      <div className="lg:col-span-3 space-y-4">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 bg-primary text-primary-foreground">
                <AvatarFallback className="text-lg font-semibold">
                  {getInitials(patientInfo.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <CardTitle className="text-xl">{patientInfo.name}</CardTitle>
                <div className="flex flex-col gap-1 mt-1 text-sm text-muted-foreground">
                  <span>MRN {patientInfo.mrn}</span>
                  <span>DOB {patientInfo.dob}</span>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Allergies */}
            <div>
              <h4 className="text-sm font-medium mb-2">Allergies</h4>
              {patientInfo.allergies.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {patientInfo.allergies.map((allergy, idx) => (
                    <Badge key={idx} variant="destructive">
                      {allergy}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No known allergies</p>
              )}
            </div>

            <Separator />

            {/* Active Problems */}
            <div>
              <h4 className="text-sm font-medium mb-2">Active problems</h4>
              {patientInfo.activeProblems.length > 0 ? (
                <ul className="space-y-1">
                  {patientInfo.activeProblems.map((problem, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground">•</span>
                      <span>{problem}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No active problems</p>
              )}
            </div>

            <Separator />

            {/* Quick Actions */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Quick actions</h4>
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start" size="sm">
                  <FileText className="mr-2 h-4 w-4" />
                  Place Order
                </Button>
                <Button variant="outline" className="w-full justify-start" size="sm">
                  <Pill className="mr-2 h-4 w-4" />
                  Med Admin
                </Button>
                <Button variant="outline" className="w-full justify-start" size="sm">
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Lab Worklist
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CENTER COLUMN: Clinical Workflow */}
      <div className="lg:col-span-6 space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl">Encounter — Today</CardTitle>
                <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                  <span>Visit type: {encounter.encounter_type}</span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>Provider: {encounter.practitioner_name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Encounter status:</span>
                {getStatusBadge(encounter.status)}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Chief Complaint */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Chief complaint</h3>
              <p className="text-muted-foreground">
                {encounter.reason || 'Dizziness and fatigue x2 weeks'}
              </p>
            </div>

            <Separator />

            {/* Problem-Focused Note */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Problem-focused note</h3>
              <div className="space-y-3">
                <div>
                  <h4 className="font-medium mb-1">HPI:</h4>
                  <p className="text-sm text-muted-foreground">
                    {encounter.hpi || '...'}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Exam:</h4>
                  <p className="text-sm text-muted-foreground">
                    {encounter.physical_exam || '...'}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Assessment:</h4>
                  <p className="text-sm text-muted-foreground">
                    {encounter.assessment || '...'}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Plan:</h4>
                  <p className="text-sm text-muted-foreground">
                    {encounter.plan || '...'}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Orders & Tasks */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Orders & Tasks</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">• Order: FBC</span>
                  <Badge variant="outline" className="text-xs">pending</Badge>
                </div>
                <div className="text-sm">• Task: Follow-up in 2 weeks</div>
              </div>
            </div>

            <Separator />

            {/* Recent Results */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Recent Results</h3>
              <p className="text-sm text-muted-foreground mb-3">Last 30 days</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium">Test</th>
                      <th className="text-left py-2 font-medium">Result</th>
                      <th className="text-left py-2 font-medium">Ref</th>
                      <th className="text-left py-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentResults.map((result, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="py-2">{result.test}</td>
                        <td className="py-2">
                          {result.value}
                          {result.abnormal && (
                            <Badge variant="destructive" className="ml-2 text-xs">
                              {result.flag}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 text-muted-foreground">{result.reference}</td>
                        <td className="py-2 text-muted-foreground">
                          {new Date(result.date).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Separator />

            {/* Encounter Timeline */}
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Encounter Timeline
              </h3>
              {isTimelineLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : timelineEntries.length > 0 ? (
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                  {timelineEntries.map((entry, index) => (
                    <TimelineEntry
                      key={entry.id}
                      entry={entry}
                      index={index}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No timeline entries for this encounter yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* RIGHT COLUMN: Live Data & Alerts */}
      <div className="lg:col-span-3 space-y-4">
        {/* Vitals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-5 w-5" />
              Vitals
            </CardTitle>
            <p className="text-xs text-muted-foreground">Updated: {vitals.updatedAt}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium">BP:</span>
                <span className="text-sm">{vitals.bp}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">HR:</span>
                <span className="text-sm">{vitals.hr}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">SpO2:</span>
                <span className="text-sm">{vitals.spo2}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Decision Support */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5" />
              Decision Support
            </CardTitle>
          </CardHeader>
          <CardContent>
            {clinicalAlerts.map((alert) => (
              <Alert key={alert.id} variant="warning" className="mb-3">
                <AlertDescription className="text-sm">
                  {alert.message}
                </AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-5 w-5" />
              Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={task.completed}
                    readOnly
                  />
                  <span className="text-sm">{task.description}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
