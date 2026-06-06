import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDashboardModuleGates } from '@/features/dashboards/hooks';
import { useWaitingRoom } from '@/hooks/useVisitQueries';
import { useClinics } from '@/hooks/useOrganization';
import { normalizeApiResults } from '@/lib/utils';

import {
  CareAreaCard,
  CareAreaEmptyState,
  CareAreaGrid,
  CareAreaScaffold,
} from '../components/CareAreaScaffold';
import {
  CareAreaSection,
  OutpatientVisitTable,
} from '../components/CareAreaWorkTables';

export default function OutpatientCareAreaPage() {
  const moduleGate = useDashboardModuleGates();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: clinicsData,
    isLoading,
    error,
    refetch,
  } = useClinics({ is_active: true });
  const clinics = normalizeApiResults(clinicsData);
  const selectedClinicId = searchParams.get('clinic') || clinics[0]?.id || null;
  const selectedClinic = useMemo(
    () => clinics.find((clinic) => String(clinic.id) === String(selectedClinicId)) || clinics[0] || null,
    [clinics, selectedClinicId],
  );
  const waitingRoomHref = selectedClinic ? `/clinics/${selectedClinic.id}/waiting-room` : null;
  const {
    data: queue = [],
    isLoading: isQueueLoading,
    error: queueError,
    refetch: refetchQueue,
  } = useWaitingRoom(selectedClinic?.id, {
    enabled: Boolean(selectedClinic?.id),
  });

  const handleClinicChange = (clinicId) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (clinicId) {
        next.set('clinic', clinicId);
      } else {
        next.delete('clinic');
      }
      return next;
    }, { replace: true });
  };

  return (
    <CareAreaScaffold
      title="Outpatient"
      description="Clinic sessions and waiting-room patient flow"
      breadcrumb={{ label: 'Outpatient', path: '/care-areas/outpatient' }}
      actions={moduleGate.appointmentsEnabled ? (
        <Button asChild size="sm" variant="outline" className="font-mono text-xs">
          <Link to="/appointments">Schedule</Link>
        </Button>
      ) : null}
    >
      {isLoading ? (
        <CareAreaEmptyState
          title="Loading clinics"
          description="Clinic access is being resolved."
        />
      ) : error ? (
        <CareAreaEmptyState
          title="Unable to load clinics"
          description={error.message || 'Clinic metadata could not be loaded.'}
        />
      ) : clinics.length === 0 ? (
        <CareAreaEmptyState
          title="No active clinics"
          description="Active outpatient clinics will appear here."
        />
      ) : (
        <CareAreaGrid>
          {clinics.map((clinic) => (
            <CareAreaCard
              key={clinic.id}
              title={clinic.name || 'Clinic'}
              description={clinic.department?.name || clinic.department_name || 'Outpatient clinic'}
              meta={clinic.code || null}
              to={`/clinics/${clinic.id}/waiting-room`}
              icon={Stethoscope}
              actionLabel="Waiting room"
            />
          ))}
        </CareAreaGrid>
      )}

      {clinics.length > 0 ? (
        <CareAreaSection
          title="Clinic Queue"
          description="Patients currently checked in for the selected clinic"
          action={(
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedClinic?.id || ''} onValueChange={handleClinicChange}>
                <SelectTrigger className="h-9 w-64 max-w-full font-mono text-xs">
                  <SelectValue placeholder="Select clinic" />
                </SelectTrigger>
                <SelectContent>
                  {clinics.map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name || clinic.code || 'Clinic'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {waitingRoomHref ? (
                <Button asChild size="sm" variant="outline" className="font-mono text-xs">
                  <Link to={waitingRoomHref}>Waiting room</Link>
                </Button>
              ) : null}
            </div>
          )}
        >
          {isQueueLoading ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">Loading clinic queue</p>
          ) : queueError ? (
            <div className="space-y-3 px-4 py-6">
              <p className="text-sm text-muted-foreground">{queueError.message || 'Clinic queue could not be loaded.'}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => refetchQueue()}>
                Retry
              </Button>
            </div>
          ) : (
            <OutpatientVisitTable
              visits={queue}
              clinicName={selectedClinic?.name || selectedClinic?.code || 'Clinic'}
              waitingRoomHref={waitingRoomHref}
            />
          )}
        </CareAreaSection>
      ) : null}

      {error ? (
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      ) : null}

      {moduleGate.appointmentsEnabled ? (
        <CareAreaCard
          title="Appointments"
          description="Clinic schedule and booked visits"
          to="/appointments"
          icon={CalendarClock}
          actionLabel="Open schedule"
        />
      ) : null}
    </CareAreaScaffold>
  );
}
