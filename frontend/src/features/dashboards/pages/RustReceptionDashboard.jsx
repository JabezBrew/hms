import { Link } from 'react-router-dom';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { Layout } from '@/components/layout/layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { useDashboardModuleGates, useReceptionistDashboard, useReceptionDashboardLiveUpdates, useDashboardActions } from '@/features/dashboards/hooks';
import { DashboardPreview, PreviewCount } from '../components/DashboardPreview';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function appointmentTime(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'Time unavailable';
}

export default function RustReceptionDashboard() {
  const { facilityCode } = useAuth();
  const gates = useDashboardModuleGates({ enabled: Boolean(facilityCode) });
  const hasModules = gates.appointmentsEnabled || gates.patientRegistrationEnabled || gates.billingEnabled;
  const enabled = Boolean(facilityCode && gates.hasFeatureMap && hasModules);
  const live = useReceptionDashboardLiveUpdates({ enabled });
  const query = useReceptionistDashboard({
    enabled,
    sections: { appointments: gates.appointmentsEnabled, patients: gates.patientRegistrationEnabled, invoices: gates.billingEnabled },
    refetchInterval: live.isConnected ? false : 30000,
  });
  const { checkInPatient } = useDashboardActions();
  const meta = usePageMeta({ title: 'Reception Dashboard | Hospital Management System', breadcrumbs: [{ label: 'Reception', path: '/dashboards/reception' }] });
  const sections = query.data?.meta?.sections || {};
  const appointments = query.data?.todays_appointments || [];
  const patients = query.data?.recent_registrations || [];
  const availableAppointments = sections.appointments?.status === 'available';

  function checkIn(appointment) {
    checkInPatient.mutate({ appointmentId: appointment.id, patientId: appointment.patient_id, clinicId: appointment.clinic_id });
  }

  return (
    <Layout><PageShell>{meta}
      <PageHeader title="Reception Dashboard" description="Check appointments and find patient records from the available workflow previews" actions={(
        <div className="flex flex-wrap gap-2">
          {gates.patientRegistrationEnabled && <Button asChild size="sm"><Link to="/patients/find-or-register">Find or register patient</Link></Button>}
          <Button variant="outline" size="icon" aria-label="Refresh reception previews" onClick={() => query.refetch()} disabled={!enabled || query.isFetching}><RefreshCw className="size-4" /></Button>
        </div>
      )} />
      <section className="space-y-6 p-4 sm:p-6">
        {!facilityCode ? <FacilityRequiredPanel /> : gates.isResolving ? <PageState variant="loading" fullHeight={false} /> : !gates.hasFeatureMap ? (
          <PageState variant="error" title="Reception work unavailable" description="Module capabilities could not be loaded." action={() => gates.refetch()} fullHeight={false} />
        ) : !hasModules ? <PageState variant="empty" title="Reception workflows are not enabled" fullHeight={false} /> : query.error ? (
          <PageState variant="error" title="Reception previews could not be loaded" description={query.error.message} action={() => query.refetch()} fullHeight={false} />
        ) : (
          <>
            {!query.isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {gates.appointmentsEnabled && <>
                <PreviewCount title="Appointments in preview" value={availableAppointments ? appointments.length : null} description="Appointments shown for today" />
                <PreviewCount title="Awaiting check-in in preview" value={availableAppointments ? number(query.data?.check_in_queue?.length) : null} description="Scheduled appointments shown below" />
              </>}
              {gates.patientRegistrationEnabled && <PreviewCount title="Patient records in preview" value={sections.patients?.status === 'available' ? patients.length : null} description="Patient Directory records" />}
              {gates.billingEnabled && <PreviewCount title="Open invoices" value={sections.invoices?.status === 'available' ? number(query.data?.stats?.pending_payments_count) : null} description="Current billing summary" />}
            </div>}
            {gates.appointmentsEnabled && <DashboardPreview title="Appointment preview" description="Appointments for today. Open scheduling for the complete list." section={sections.appointments} isLoading={query.isLoading} count={appointments.length} emptyMessage="No appointment records in this preview." href="/appointments" linkLabel="Open appointments">
              <div className="divide-y divide-border">{appointments.map((appointment) => (
                <article key={appointment.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div><h3 className="font-display text-xl">{appointment.patient_name}</h3><p className="font-mono text-xs text-muted-foreground">{appointmentTime(appointment.start_time)}{appointment.practitioner_name ? ` · ${appointment.practitioner_name}` : ''}</p><Badge className="mt-2" variant="outline">{String(appointment.status || 'Status unavailable').replaceAll('_', ' ')}</Badge></div>
                  <div className="flex gap-2">
                    {appointment.status === 'scheduled' && <Button size="sm" disabled={!appointment.patient_id || checkInPatient.isPending} onClick={() => checkIn(appointment)}>Check In</Button>}
                    <Button asChild size="sm" variant="outline"><Link to={`/appointments/${appointment.id}`}>View appointment</Link></Button>
                  </div>
                </article>
              ))}</div>
            </DashboardPreview>}
            {gates.patientRegistrationEnabled && <DashboardPreview title="Patient Directory preview" description="Find and confirm patient identity before starting care." section={sections.patients} isLoading={query.isLoading} count={patients.length} emptyMessage="No patient records in this preview." href="/patients" linkLabel="Open Patient Directory">
              <div className="divide-y divide-border">{patients.map((patient) => (
                <div key={patient.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{patient.full_name}</p><p className="font-mono text-xs text-muted-foreground">{patient.mrn}</p></div><Button asChild size="sm" variant="outline"><Link to={`/patients/${patient.id}/profile`}>Open profile</Link></Button></div>
              ))}</div>
            </DashboardPreview>}
          </>
        )}
      </section>
    </PageShell></Layout>
  );
}
