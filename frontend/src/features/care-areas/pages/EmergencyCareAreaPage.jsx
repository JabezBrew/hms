import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Siren from 'lucide-react/dist/esm/icons/siren.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useDashboardModuleGates } from '@/features/dashboards/hooks';
import { useTriageQueue } from '@/hooks/useVisitQueries';

import {
  CareAreaCard,
  CareAreaGrid,
  CareAreaScaffold,
} from '../components/CareAreaScaffold';
import {
  CareAreaSection,
  EmergencyQueueTable,
} from '../components/CareAreaWorkTables';

export default function EmergencyCareAreaPage() {
  const moduleGate = useDashboardModuleGates();
  const {
    data: triageQueue,
    isLoading,
    error,
    refetch,
  } = useTriageQueue({ status: 'waiting', page_size: 25 });
  const triageEntries = Array.isArray(triageQueue?.results) ? triageQueue.results : [];

  return (
    <CareAreaScaffold
      title="Emergency"
      description="Triage and emergency patient flow"
      breadcrumb={{ label: 'Emergency', path: '/care-areas/emergency' }}
      actions={(
        <Button asChild size="sm" className="font-mono text-xs">
          <Link to="/triage">Open triage</Link>
        </Button>
      )}
    >
      <CareAreaGrid>
        <CareAreaCard
          title="Triage Queue"
          description="Waiting triage, acuity, assignment"
          to="/triage"
          icon={Siren}
          actionLabel="Open queue"
        />
        {moduleGate.patientRegistrationEnabled && moduleGate.patientChronicleEnabled ? (
          <CareAreaCard
            title="Add Walk-In"
            description="Register an emergency walk-in"
            to="/patients/create?walkIn=true"
            icon={UserPlus}
            actionLabel="Start"
          />
        ) : null}
        {moduleGate.emergencyEncountersEnabled && moduleGate.outpatientEncountersEnabled ? (
          <CareAreaCard
            title="Emergency Encounters"
            description="Current emergency encounter list"
            to="/encounters?tab=emergency"
            icon={Activity}
            actionLabel="Open list"
          />
        ) : null}
      </CareAreaGrid>

      <CareAreaSection
        title="Emergency Queue"
        description="Waiting triage patients ordered by arrival"
        action={(
          <Button type="button" size="sm" variant="outline" className="font-mono text-xs" onClick={() => refetch()}>
            Refresh
          </Button>
        )}
      >
        {isLoading ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">Loading emergency queue</p>
        ) : error ? (
          <div className="space-y-3 px-4 py-6">
            <p className="text-sm text-muted-foreground">{error.message || 'Emergency queue could not be loaded.'}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <EmergencyQueueTable entries={triageEntries} />
        )}
      </CareAreaSection>
    </CareAreaScaffold>
  );
}
