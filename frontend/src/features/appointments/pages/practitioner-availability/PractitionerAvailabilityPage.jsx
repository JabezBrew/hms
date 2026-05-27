import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

import PractitionerAvailabilityWorkspace from './PractitionerAvailabilityWorkspace';

const PractitionerAvailabilityPage = () => {
  const { search, state } = useLocation();
  const { user } = useAuth();
  const isDoctor = user?.role === 'doctor';
  const availabilityMutationsAvailable = !isRustV2ApiMode();
  const practitionerFromState = state?.practitionerId ? String(state.practitionerId) : null;
  const queryParams = useMemo(() => new URLSearchParams(search), [search]);
  const practitionerFromQuery = useMemo(() => queryParams.get('practitioner'), [queryParams]);

  const pageMeta = usePageMeta({
    title: isDoctor
      ? 'My Availability | Hospital Management System'
      : 'Practitioner Availability | Hospital Management System',
    breadcrumbs: [{ label: 'Availability', path: '/practitioner-availability' }],
  });

  const initialSelectedPractitioner = useMemo(() => {
    if (isDoctor && user?.practitionerId) {
      return String(user.practitionerId);
    }
    if (practitionerFromState) {
      return practitionerFromState;
    }
    if (practitionerFromQuery) {
      return String(practitionerFromQuery);
    }
    return null;
  }, [isDoctor, practitionerFromQuery, practitionerFromState, user?.practitionerId]);

  return (
    <PractitionerAvailabilityWorkspace
      key={initialSelectedPractitioner || 'unselected'}
      isDoctor={isDoctor}
      availabilityMutationsAvailable={availabilityMutationsAvailable}
      initialSelectedPractitioner={initialSelectedPractitioner}
      pageMeta={pageMeta}
    />
  );
};

export default PractitionerAvailabilityPage;
