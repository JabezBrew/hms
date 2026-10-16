import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { userHasCapability } from '@/shared/lib/access';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { Button } from '@/components/ui/button';
import { useAppointmentSeries } from './hooks';
import { scopeIdentity } from './model';
import { SeriesMembers } from './SeriesMembers';
import { SeriesCancellationDialog } from './SeriesCancellationDialog';
function SeriesPageContent({ id, user }) {
  const query = useAppointmentSeries(id); const [cancel, setCancel] = useState(null); const [cancelOpen, setCancelOpen] = useState(false);
  const fresh = query.isFetchedAfterMount && !query.isError && !query.isFetching && Boolean(query.data);
  const series = query.data;
  const canCancel = userHasCapability(user, 'appointment.manage') && fresh && series.appointments.some((member) => member.status === 'scheduled' && Date.parse(member.starts_at) > Date.now());
  return <><PageHeader title="Appointment group" description="Review every saved appointment. Changes to one appointment remain part of this group's history." actions={<Button type="button" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh group</Button>} />
    <div className="grid gap-5 p-4 sm:p-6">{query.isError ? <PageState variant="error" title="Appointment group unavailable" description="The current group could not be confirmed. Check access and refresh before changing appointments." action={() => query.refetch()} fullHeight={false} /> : !fresh ? <PageState variant="loading" title="Loading current appointments" fullHeight={false} /> : <><SeriesMembers series={series} />{canCancel && !cancel && <div><Button type="button" variant="outline" onClick={() => { setCancel(structuredClone(series)); setCancelOpen(true); }}>Cancel future appointments</Button></div>}</>}{cancel && !cancelOpen && <div><Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>Review cancellation request</Button></div>}</div>
    {cancel && <SeriesCancellationDialog series={cancel} open={cancelOpen} onClose={({ preserve }) => { setCancelOpen(false); if (!preserve) setCancel(null); void query.refetch(); }} />}
  </>;
}
export default function AppointmentSeriesPage() {
  const { id } = useParams(); const { user } = useAuth();
  const pageMeta = usePageMeta({ title: 'Appointment group', breadcrumbs: [{ label: 'Appointments', path: '/appointments' }, { label: 'Appointment group' }] });
  return <PageShell>{pageMeta}<SeriesPageContent key={JSON.stringify([id, scopeIdentity(user)])} id={id} user={user} /></PageShell>;
}
