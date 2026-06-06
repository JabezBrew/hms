import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import { useMemo } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/layout/layout';
import { StatCard, DashboardSection, DashboardGrid } from '@/components/dashboard';
import { WaitingRoomQueue } from '@/components/visits/WaitingRoomQueue';
import { useWaitingRoom } from '@/hooks/useVisitQueries';
import { clinicsApi } from '@/features/clinics/api';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { keyWith } from '@/shared/lib/queryKeys';

const clinicKeys = {
  detail: (clinicId) => keyWith('clinics', clinicId),
};

export default function ClinicWaitingRoomPage() {
  const { clinicId } = useParams();
  const navigate = useNavigate();
  const { search: routeSearch } = useLocation();
  const { facilityCode } = useAuth();
  const targetVisitId = useMemo(
    () => new URLSearchParams(routeSearch).get('visit') || null,
    [routeSearch],
  );

  // Fetch clinic details
  const {
    data: clinic,
    isLoading: clinicLoading,
    error: clinicError,
  } = useQuery({
    queryKey: clinicKeys.detail(clinicId),
    queryFn: ({ signal }) => clinicsApi.get(clinicId, { signal }),
    enabled: Boolean(facilityCode) && Boolean(clinicId),
  });

  // Fetch waiting room queue
  const {
    data: queue,
    isLoading: queueLoading,
    refetch,
    isFetching,
  } = useWaitingRoom(clinicId);

  // Calculate stats
  const stats = useMemo(() => {
    if (!queue) return { waiting: 0, called: 0, readyCheckout: 0, total: 0 };

    const waiting = queue.filter((v) => v.visit_status === 'waiting').length;
    const called = queue.filter((v) => v.visit_status === 'called').length;
    const readyCheckout = queue.filter((v) => v.visit_status === 'ready_checkout').length;

    return {
      waiting,
      called,
      readyCheckout,
      total: queue.length,
    };
  }, [queue]);

  if (!facilityCode) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title={clinicLoading ? 'Loading...' : `${clinic?.name || 'Clinic'} Waiting Room`}
            description={clinic?.department?.name || 'Outpatient Clinic'}
            actions={(
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <LoadingSpinner className="h-4 w-8" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            )}
          />
          <div className="p-4 sm:p-6">
            <FacilityRequiredPanel />
          </div>
        </PageShell>
      </Layout>
    );
  }

  if (clinicError) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title={clinicLoading ? 'Loading...' : `${clinic?.name || 'Clinic'} Waiting Room`}
            description={clinic?.department?.name || 'Outpatient Clinic'}
            actions={(
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <LoadingSpinner className="h-4 w-8" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            )}
          />
          <PageState
            variant="error"
            title="Failed to load clinic"
            description={clinicError.message}
            action={() => refetch()}
            fullHeight={false}
            className="min-h-0"
          />
        </PageShell>
      </Layout>
    );
  }

  const handlePatientClick = (visit) => {
    const patientId = visit.patient_id || visit.patient;
    if (!patientId) {
      return;
    }
    const params = new URLSearchParams();
    if (visit.encounter_id) {
      params.set('visit', String(visit.encounter_id));
    }
    const query = params.toString();
    navigate(`/patients/${patientId}${query ? `?${query}` : ''}`);
  };

  return (
    <Layout>
      <PageShell>
        <PageHeader
          title={clinicLoading ? 'Loading...' : `${clinic?.name || 'Clinic'} Waiting Room`}
          description={clinic?.department?.name || 'Outpatient Clinic'}
          actions={(
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <LoadingSpinner className="h-4 w-8" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </Button>
          )}
        />

        <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
          {/* Statistics */}
          {queueLoading ? (
            <DashboardGrid columns="4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </DashboardGrid>
          ) : (
            <DashboardGrid columns="4">
              <StatCard
                title="Total in Queue"
                value={stats.total}
                subtitle="Patients waiting today"
                icon={Users}
                color="sky"
              />
              <StatCard
                title="Waiting"
                value={stats.waiting}
                subtitle="Ready to be called"
                icon={Clock}
                color="amber"
              />
              <StatCard
                title="Called"
                value={stats.called}
                subtitle="Awaiting consultation"
                icon={Phone}
                color="emerald"
              />
              <StatCard
                title="Ready Checkout"
                value={stats.readyCheckout}
                subtitle="Awaiting front-desk closeout"
                icon={Stethoscope}
                color="emerald"
              />
            </DashboardGrid>
          )}

          {/* Waiting Room Queue */}
          <DashboardSection
            title="Patient Queue"
            subtitle="Patients in order of check-in"
          >
            <WaitingRoomQueue
              clinicId={clinicId}
              showActions={true}
              onPatientClick={handlePatientClick}
              targetVisitId={targetVisitId}
            />
          </DashboardSection>
        </div>
      </PageShell>
    </Layout>
  );
}
