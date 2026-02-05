import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { StatCard, DashboardSection, DashboardGrid } from '@/components/dashboard';
import { TriageQueueList } from '@/components/visits/TriageQueueList';
import { TriageAssessmentDialog } from '@/components/visits/TriageAssessmentDialog';
import { TriageAssignDialog } from '@/components/visits/TriageAssignDialog';
import { useTriageQueue, useTriageActions } from '@/hooks/useVisitQueries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';

export default function TriagePage() {
  const navigate = useNavigate();
  const { facilityCode } = useAuth();
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [triageEntry, setTriageEntry] = useState(null);
  const [assignEntry, setAssignEntry] = useState(null);

  // Fetch triage queue
  const filters = priorityFilter !== 'all' ? { priority: priorityFilter } : {};
  const {
    data: queue,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useTriageQueue(filters);

  const { cancelEntry } = useTriageActions();

  // Calculate stats
  const stats = useMemo(() => {
    if (!queue?.results && !Array.isArray(queue)) {
      return { waiting: 0, triaged: 0, emergency: 0, urgent: 0 };
    }

    const entries = queue.results || queue;
    return {
      waiting: entries.filter((e) => e.status === 'waiting').length,
      triaged: entries.filter((e) => e.status === 'triaged').length,
      emergency: entries.filter((e) => e.priority === 'emergency').length,
      urgent: entries.filter((e) => e.priority === 'urgent').length,
    };
  }, [queue]);

  const handleTriage = (entry) => {
    setTriageEntry(entry);
  };

  const handleAssign = (entry) => {
    setAssignEntry(entry);
  };

  const handleCancel = (entry) => {
    if (window.confirm('Are you sure you want to cancel this triage entry?')) {
      cancelEntry.mutate(entry.id);
    }
  };

  const handlePatientClick = (entry) => {
    navigate(`/patients/${entry.patient}`);
  };

  const handleAddWalkIn = () => {
    // Navigate to patient registration with walk-in flag
    navigate('/patients/create?walkIn=true');
  };

  if (!facilityCode) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Triage Queue"
            description="Manage walk-in patients and clinic assignments"
            actions={(
              <div className="flex items-center gap-2">
                <Button variant="default" size="sm" onClick={handleAddWalkIn}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Walk-In
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            )}
          />
          <div className="p-4 sm:p-6">
            <FacilityRequiredPanel />
          </div>
        </PageShell>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Triage Queue"
            description="Manage walk-in patients and clinic assignments"
            actions={(
              <div className="flex items-center gap-2">
                <Button variant="default" size="sm" onClick={handleAddWalkIn}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Walk-In
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            )}
          />
          <PageState
            variant="error"
            title="Failed to load triage queue"
            description={error.message}
            action={() => refetch()}
            fullHeight={false}
            className="min-h-0"
          />
        </PageShell>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageShell>
        <PageHeader
          title="Triage Queue"
          description="Manage walk-in patients and clinic assignments"
          actions={(
            <div className="flex items-center gap-2">
              <Button variant="default" size="sm" onClick={handleAddWalkIn}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Walk-In
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          )}
        />

        <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
          {/* Statistics */}
          {isLoading ? (
            <DashboardGrid columns="4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </DashboardGrid>
          ) : (
            <DashboardGrid columns="4">
              <StatCard
                title="Waiting for Triage"
                value={stats.waiting}
                subtitle="Need assessment"
                icon={Clock}
                color="amber"
              />
              <StatCard
                title="Pending Assignment"
                value={stats.triaged}
                subtitle="Ready for clinic"
                icon={CheckCircle}
                color="sky"
              />
              <StatCard
                title="Emergency"
                value={stats.emergency}
                subtitle="High priority"
                icon={AlertTriangle}
                color="rose"
              />
              <StatCard
                title="Urgent"
                value={stats.urgent}
                subtitle="Moderate priority"
                icon={AlertCircle}
                color="amber"
              />
            </DashboardGrid>
          )}

          {/* Priority Filter */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">Filter by priority:</span>
            <Tabs value={priorityFilter} onValueChange={setPriorityFilter}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="emergency" className="text-rose-400">
                  Emergency
                </TabsTrigger>
                <TabsTrigger value="urgent" className="text-amber-400">
                  Urgent
                </TabsTrigger>
                <TabsTrigger value="routine">Routine</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Triage Queue */}
          <DashboardSection
            title="Patients"
            subtitle="Ordered by priority and arrival time"
          >
            <TriageQueueList
              filters={filters}
              onTriage={handleTriage}
              onAssign={handleAssign}
              onCancel={handleCancel}
              onPatientClick={handlePatientClick}
            />
          </DashboardSection>
        </div>

        {/* Triage Assessment Dialog */}
        <TriageAssessmentDialog
          open={Boolean(triageEntry)}
          onClose={() => setTriageEntry(null)}
          entry={triageEntry}
          onSuccess={() => {
            setTriageEntry(null);
            refetch();
          }}
        />

        {/* Triage Assign Dialog */}
        <TriageAssignDialog
          open={Boolean(assignEntry)}
          onClose={() => setAssignEntry(null)}
          entry={assignEntry}
          onSuccess={() => {
            setAssignEntry(null);
            refetch();
          }}
        />
      </PageShell>
    </Layout>
  );
}
