import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { StatCard, DashboardSection, DashboardGrid } from '@/components/dashboard';
import { TriageQueueList } from '@/components/visits/TriageQueueList';
import { triagePatientPath } from '@/features/triage/utils/triagePatientPath';
import { TriageAssessmentDialog } from '@/components/visits/TriageAssessmentDialog';
import { TriageAssignDialog } from '@/components/visits/TriageAssignDialog';
import { useTriageQueue, useTriageActions } from '@/hooks/useVisitQueries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TablePagination } from '@/components/ui/table-pagination';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { useUrlEnumParam } from '@/shared/hooks/useUrlEnumParam';

const PRIORITIES = ['all', 'emergency', 'urgent', 'routine'];
const STATUSES = ['waiting', 'assigned', 'triaged', 'cancelled', 'all'];
const PAGE_SIZE = 50;

export default function TriagePage() {
  const navigate = useNavigate();
  const { facilityCode } = useAuth();
  const isRustV2 = isRustV2ApiMode();
  const [priority, setPriority] = useUrlEnumParam({ param: 'priority', values: PRIORITIES, defaultValue: 'all' });
  const [status, setStatus] = useUrlEnumParam({
    param: 'status', values: STATUSES, defaultValue: isRustV2 ? 'waiting' : 'all',
  });
  const filterKey = `${priority}:${status}`;
  const [pagination, setPagination] = useState({ filterKey, page: 1 });
  const page = pagination.filterKey === filterKey ? pagination.page : 1;
  const [triageEntry, setTriageEntry] = useState(null);
  const [assignEntry, setAssignEntry] = useState(null);
  const filters = {
    page, page_size: PAGE_SIZE,
    ...(priority !== 'all' ? { priority } : {}),
    ...(status !== 'all' ? { status } : {}),
  };
  const { data: queue, isLoading, error, refetch, isFetching } = useTriageQueue(filters);
  const { cancelEntry } = useTriageActions();
  const entries = Array.isArray(queue?.results) ? queue.results : Array.isArray(queue) ? queue : [];
  const stats = {
    waiting: entries.filter((entry) => entry.status === 'waiting').length,
    assigned: entries.filter((entry) => entry.status === (isRustV2 ? 'assigned' : 'triaged')).length,
    emergency: entries.filter((entry) => entry.priority === 'emergency').length,
    urgent: entries.filter((entry) => entry.priority === 'urgent').length,
  };
  const currentPage = queue?.resolved_page || queue?.page || page;

  function handleCancel(entry) {
    if (window.confirm('Cancel this waiting triage entry?')) cancelEntry.mutate(entry.id);
  }

  return (
    <Layout>
      <PageShell>
        <PageHeader
          title="Triage Queue"
          description="Assess emergency arrivals and coordinate staff assignments"
          actions={(
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => navigate('/patients/find-or-register?intent=emergency')} disabled={!facilityCode}>
                <UserPlus className="mr-2 size-4" />Add Walk-In
              </Button>
              <Button variant="outline" size="icon" aria-label="Refresh triage queue" onClick={() => refetch()} disabled={isFetching || !facilityCode}>
                <RefreshCw className={`size-4 ${isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              </Button>
            </div>
          )}
        />
        {!facilityCode ? (
          <div className="p-4 sm:p-6"><FacilityRequiredPanel /></div>
        ) : (
          <div className="space-y-6 p-4 sm:space-y-8 sm:p-6">
            {isLoading ? (
              <DashboardGrid columns="4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32" />)}</DashboardGrid>
            ) : !error ? (
              <DashboardGrid columns="4">
                <StatCard title="Waiting for Assessment" value={stats.waiting} subtitle="On this page" icon={Clock} color="amber" />
                <StatCard title={isRustV2 ? 'Assigned to Staff' : 'Pending Assignment'} value={stats.assigned} subtitle="On this page" icon={ClipboardCheck} color="sky" />
                <StatCard title="Emergency" value={stats.emergency} subtitle="On this page" icon={AlertTriangle} color="rose" />
                <StatCard title="Urgent" value={stats.urgent} subtitle="On this page" icon={AlertCircle} color="amber" />
              </DashboardGrid>
            ) : null}

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Assessment status</p>
                <Tabs value={status} onValueChange={(nextStatus) => {
                  setPagination({ filterKey: `${priority}:${nextStatus}`, page: 1 });
                  setStatus(nextStatus);
                }}>
                  <TabsList className="h-auto flex-wrap justify-start" aria-label="Filter by assessment status">
                    <TabsTrigger value="waiting">Waiting</TabsTrigger>
                    <TabsTrigger value="assigned">Assigned</TabsTrigger>
                    <TabsTrigger value="triaged">{isRustV2 ? 'Completed' : 'Triaged'}</TabsTrigger>
                    <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
                    <TabsTrigger value="all">All entries</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Priority</p>
                <Tabs value={priority} onValueChange={(nextPriority) => {
                  setPagination({ filterKey: `${nextPriority}:${status}`, page: 1 });
                  setPriority(nextPriority);
                }}>
                  <TabsList className="h-auto flex-wrap justify-start" aria-label="Filter by priority">
                    <TabsTrigger value="all">All priorities</TabsTrigger>
                    <TabsTrigger value="emergency">Emergency</TabsTrigger>
                    <TabsTrigger value="urgent">Urgent</TabsTrigger>
                    <TabsTrigger value="routine">Routine</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {error ? (
              <PageState variant="error" title="Failed to load triage queue" description={error.message} action={() => refetch()} fullHeight={false} className="min-h-0" />
            ) : (
              <DashboardSection title="Patients" subtitle="Ordered by arrival within the selected status and priority">
                <TriageQueueList
                  data={queue}
                  isLoading={isLoading}
                  onTriage={setTriageEntry}
                  onAssign={setAssignEntry}
                  onCancel={handleCancel}
                  onPatientClick={(entry) => navigate(triagePatientPath(entry))}
                />
                {!isLoading && (
                  <fieldset disabled={isFetching} aria-label="Triage queue pagination">
                    <TablePagination
                      currentPage={currentPage}
                      pageSize={queue?.page_size || PAGE_SIZE}
                      totalCount={queue?.count ?? entries.length}
                      countExact={queue?.count_exact !== false}
                      hasNextPage={Boolean(queue?.next)}
                      hasPrevPage={currentPage > 1}
                      canJumpToPage={!isRustV2}
                      itemLabel="triage entries"
                      onPageChange={(nextPage) => setPagination({ filterKey, page: nextPage })}
                    />
                  </fieldset>
                )}
              </DashboardSection>
            )}
          </div>
        )}
        <TriageAssessmentDialog open={Boolean(triageEntry)} onClose={() => setTriageEntry(null)} entry={triageEntry} onSuccess={() => { setTriageEntry(null); refetch(); }} />
        <TriageAssignDialog open={Boolean(assignEntry)} onClose={() => setAssignEntry(null)} entry={assignEntry} onSuccess={() => { setAssignEntry(null); refetch(); }} />
      </PageShell>
    </Layout>
  );
}
