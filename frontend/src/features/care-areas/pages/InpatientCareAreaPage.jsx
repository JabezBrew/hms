import Bed from 'lucide-react/dist/esm/icons/bed.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import FileStack from 'lucide-react/dist/esm/icons/files.js';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useWards } from '@/features/wards/hooks/useWardQueries';
import { normalizeApiResults } from '@/lib/utils';

import {
  CareAreaCard,
  CareAreaEmptyState,
  CareAreaGrid,
  CareAreaScaffold,
} from '../components/CareAreaScaffold';

export default function InpatientCareAreaPage() {
  const {
    data: wardsData,
    isLoading,
    error,
    refetch,
  } = useWards({ is_active: true });
  const wards = normalizeApiResults(wardsData);

  return (
    <CareAreaScaffold
      title="Inpatient"
      description="Ward census, admissions, and discharge work"
      breadcrumb={{ label: 'Inpatient', path: '/care-areas/inpatient' }}
      actions={(
        <Button asChild size="sm" variant="outline" className="font-mono text-xs">
          <Link to="/ward-board">Ward Board</Link>
        </Button>
      )}
    >
      <CareAreaGrid>
        <CareAreaCard
          title="Ward Board"
          description="Facility-wide inpatient board"
          to="/ward-board"
          icon={ClipboardList}
          actionLabel="Open board"
        />
        <CareAreaCard
          title="Admission Requests"
          description="Admission placement and activation"
          to="/admissions/requests"
          icon={FileStack}
          actionLabel="Open queue"
        />
      </CareAreaGrid>

      {isLoading ? (
        <CareAreaEmptyState
          title="Loading wards"
          description="Ward access is being resolved."
        />
      ) : error ? (
        <CareAreaEmptyState
          title="Unable to load wards"
          description={error.message || 'Ward metadata could not be loaded.'}
        />
      ) : wards.length === 0 ? (
        <CareAreaEmptyState
          title="No active wards"
          description="Active inpatient wards will appear here."
        />
      ) : (
        <CareAreaGrid>
          {wards.map((ward) => (
            <CareAreaCard
              key={ward.id}
              title={ward.name || 'Ward'}
              description={ward.department?.name || ward.unit_name || ward.ward_type || 'Inpatient ward'}
              meta={ward.code || null}
              to={`/wards/${ward.id}/board`}
              icon={Bed}
              actionLabel="Ward board"
            />
          ))}
        </CareAreaGrid>
      )}

      {error ? (
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      ) : null}
    </CareAreaScaffold>
  );
}
