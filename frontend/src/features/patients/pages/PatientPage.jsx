import { lazy, Suspense } from 'react';
import { useAuth } from '@/lib/auth';
import { PageLoader } from '@/shared/components/page/PageState';

const PatientChroniclePage = lazy(() => import('./PatientChroniclePage'));
const PatientDemographicsPage = lazy(() => import('./PatientDemographicsPage'));

/**
 * PatientPage - Role-based patient detail router
 *
 * Serves different patient views based on user role:
 * - Administrative staff (receptionist, billing) -> Demographics view
 * - Clinical staff (doctor, nurse, etc.) -> Full chronicle view
 * - Admin -> Full chronicle view (full access)
 *
 * This approach:
 * - Uses a single URL for all roles (/patients/:id)
 * - Prevents URL-based access bypass
 * - Backend still enforces API-level permissions
 *
 * @param {string} defaultAction - Optional action to trigger on mount (e.g., 'ward_round')
 */
const PatientPage = ({ defaultAction }) => {
  const { user } = useAuth();

  // Map default actions for specialized routes
  const actions = {
    ward_round: 'ward_round',
  };

  const resolvedAction = actions[defaultAction] || defaultAction;

  // Administrative roles see demographics-only view
  const administrativeRoles = ['receptionist', 'billing'];

  if (administrativeRoles.includes(user?.role)) {
    return (
      <Suspense fallback={<PageLoader />}>
        <PatientDemographicsPage />
      </Suspense>
    );
  }

  // Clinical roles and admin see full chronicle
  return (
    <Suspense fallback={<PageLoader />}>
      <PatientChroniclePage defaultAction={resolvedAction} />
    </Suspense>
  );
};

export default PatientPage;
