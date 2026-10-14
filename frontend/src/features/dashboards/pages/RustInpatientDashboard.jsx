import { Link } from 'react-router-dom';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { Layout } from '@/components/layout/layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { useDashboardModuleGates, useInpatientDashboard, useInpatientDashboardLiveUpdates } from '@/features/dashboards/hooks';
import { DashboardPreview, PreviewCount } from '../components/DashboardPreview';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

const BOARD_FEATURES = ['ward_task_board', 'patient_chronicle', 'wards', 'inpatient_admissions', 'nursing_workflows'];

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumMeasured(rows, key) {
  return rows.every((row) => count(row[key]) !== null) ? rows.reduce((total, row) => total + row[key], 0) : null;
}

function patientHref(patient, action) {
  const params = new URLSearchParams();
  const admissionId = patient.admission_id || patient.admission_case_id;
  if (admissionId) params.set('admission', admissionId);
  if (action) params.set('action', action);
  return `/patients/${patient.patient_id}?${params.toString()}`;
}

function PatientSignals({ patient }) {
  const signals = [
    ['Critical alerts', patient.critical_alert_count, 'destructive'],
    ['Active alerts', patient.active_alert_count, 'secondary'],
    ['Critical unverified results', patient.critical_unverified_result_count, 'destructive'],
    ['Unverified results', patient.unverified_result_count, 'secondary'],
    ['Overdue nursing tasks', patient.overdue_nursing_task_count, 'secondary'],
    ['Medication doses due', patient.due_medication_count, 'secondary'],
  ];
  const measured = signals.filter(([, value]) => count(value) !== null);
  return measured.length ? (
    <div className="flex flex-wrap gap-2">{measured.map(([label, value, variant]) => (
      <Badge key={label} variant={value > 0 ? variant : 'outline'}>{label}: {value}</Badge>
    ))}</div>
  ) : <p className="text-sm text-muted-foreground">Board signals unavailable</p>;
}

export default function RustInpatientDashboard() {
  const { facilityCode } = useAuth();
  const gates = useDashboardModuleGates({ enabled: Boolean(facilityCode) });
  const canOpenBoard = gates.canUse(BOARD_FEATURES);
  const hasPreviews = canOpenBoard || gates.dischargeWorkflowsEnabled || gates.nursingWorkflowsEnabled;
  const enabled = Boolean(facilityCode && gates.hasFeatureMap && gates.inpatientAdmissionsEnabled && hasPreviews);
  const live = useInpatientDashboardLiveUpdates({ enabled });
  const query = useInpatientDashboard({
    enabled,
    sections: { ward_board: canOpenBoard, discharges: gates.dischargeWorkflowsEnabled, nursing_tasks: gates.nursingWorkflowsEnabled },
    refetchInterval: live.isConnected ? false : 30000,
  });
  const meta = usePageMeta({ title: 'Inpatient Dashboard | Hospital Management System', breadcrumbs: [{ label: 'Inpatient', path: '/dashboards/inpatient' }] });
  const patients = query.data?.my_patients || [];
  const discharges = query.data?.planned_discharges || [];
  const sections = query.data?.meta?.sections || {};
  const boardAvailable = sections.ward_board?.status === 'available';

  return (
    <Layout><PageShell>{meta}
      <PageHeader title="Inpatient Dashboard" description="Review available ward work, then open the ward or patient context to continue" actions={(
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/my-work">My Work</Link></Button>
          <Button variant="outline" size="icon" aria-label="Refresh inpatient previews" onClick={() => query.refetch()} disabled={!enabled || query.isFetching}><RefreshCw className="size-4" /></Button>
        </div>
      )} />
      <section className="space-y-6 p-4 sm:p-6">
        {!facilityCode ? <FacilityRequiredPanel /> : gates.isResolving ? <PageState variant="loading" fullHeight={false} /> : !gates.hasFeatureMap ? (
          <PageState variant="error" title="Work areas unavailable" description="Module capabilities could not be loaded." action={() => gates.refetch()} fullHeight={false} />
        ) : !gates.inpatientAdmissionsEnabled ? <PageState variant="empty" title="Inpatient work is not enabled" fullHeight={false} /> : !hasPreviews ? <PageState variant="empty" title="Open My Work to choose an inpatient workflow" fullHeight={false} /> : query.error ? (
          <PageState variant="error" title="Inpatient previews could not be loaded" description={query.error.message} action={() => query.refetch()} fullHeight={false} />
        ) : (
          <>
            {!query.isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {canOpenBoard && <><PreviewCount title="Patients in ward preview" value={boardAvailable ? patients.length : null} description="Patients shown below" />
              <PreviewCount title="Active alerts in preview" value={boardAvailable ? sumMeasured(patients, 'active_alert_count') : null} description="For the patients shown below" />
              <PreviewCount title="Unverified results in preview" value={boardAvailable ? sumMeasured(patients, 'unverified_result_count') : null} description="For the patients shown below" /></>}
              {gates.nursingWorkflowsEnabled && <PreviewCount title="Nursing tasks in preview" value={sections.nursing_tasks?.status === 'available' ? count(query.data?.pending?.nursing_tasks) : null} description="Tasks returned by the current work list" />}
            </div>}
            {canOpenBoard && <DashboardPreview title="Ward preview" description="Current ward patients and their reported alerts, results and due work." section={sections.ward_board} isLoading={query.isLoading} count={patients.length} emptyMessage="No patients shown in this ward preview." href="/care-areas/inpatient" linkLabel="Open assigned wards">
              <div className="space-y-4">{patients.map((patient) => (
                <article key={patient.id} className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h3 className="font-display text-xl">{patient.patient_name}</h3><p className="font-mono text-xs text-muted-foreground">{patient.ward_name || 'Ward unavailable'} · {patient.bed_number || 'Bed unassigned'}</p></div>
                    {gates.patientChronicleEnabled && <Button asChild variant="outline" size="sm"><Link to={patientHref(patient)}>Open Chronicle</Link></Button>}
                  </div>
                  <PatientSignals patient={patient} />
                </article>
              ))}</div>
            </DashboardPreview>}
            {gates.dischargeWorkflowsEnabled && <DashboardPreview title="Discharge records" description="Discharge records and their current workflow status." section={sections.discharges} isLoading={query.isLoading} count={discharges.length} emptyMessage="No discharge records in this preview." href={canOpenBoard ? '/care-areas/inpatient' : '/my-work'} linkLabel="Open inpatient work">
              <div className="divide-y divide-border">{discharges.map((discharge) => (
                <div key={discharge.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div><p className="font-medium">{discharge.patient_name}</p><p className="text-sm text-muted-foreground">{String(discharge.status || 'Status unavailable').replaceAll('_', ' ')}</p></div>
                  {gates.patientChronicleEnabled && <Button asChild size="sm" variant="outline"><Link to={patientHref(discharge)}>Open Chronicle</Link></Button>}
                </div>
              ))}</div>
            </DashboardPreview>}
          </>
        )}
      </section>
    </PageShell></Layout>
  );
}
