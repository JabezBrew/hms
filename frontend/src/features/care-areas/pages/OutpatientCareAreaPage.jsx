import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useDashboardModuleGates } from '@/features/dashboards/hooks';
import { useClinics } from '@/hooks/useOrganization';
import { normalizeApiResults } from '@/lib/utils';

import {
  CareAreaCard,
  CareAreaEmptyState,
  CareAreaGrid,
  CareAreaScaffold,
} from '../components/CareAreaScaffold';

export default function OutpatientCareAreaPage() {
  const moduleGate = useDashboardModuleGates();
  const {
    data: clinicsData,
    isLoading,
    error,
    refetch,
  } = useClinics({ is_active: true });
  const clinics = normalizeApiResults(clinicsData);

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
