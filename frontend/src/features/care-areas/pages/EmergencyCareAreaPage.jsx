import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Siren from 'lucide-react/dist/esm/icons/siren.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useDashboardModuleGates } from '@/features/dashboards/hooks';

import {
  CareAreaCard,
  CareAreaGrid,
  CareAreaScaffold,
} from '../components/CareAreaScaffold';

export default function EmergencyCareAreaPage() {
  const moduleGate = useDashboardModuleGates();

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
    </CareAreaScaffold>
  );
}
