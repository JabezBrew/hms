import { useAuth } from '@/lib/auth';
import PatientChroniclePage from './PatientChroniclePage';
import PatientDemographicsPage from './PatientDemographicsPage';

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

  // Administrative roles see demographics-only view
  const administrativeRoles = ['receptionist', 'billing'];

  if (administrativeRoles.includes(user?.role)) {
    return <PatientDemographicsPage />;
  }

  // Clinical roles and admin see full chronicle
  return <PatientChroniclePage defaultAction={defaultAction} />;
};

export default PatientPage;
