import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

const CLINICAL_PATIENT_ROLES = new Set([
  'admin',
  'doctor',
  'nurse',
  'head_nurse',
  'nurse_practitioner',
  'inpatient_doctor',
  'practitioner',
  'physician',
]);

/**
 * PatientPage - Role-aware compatibility redirect.
 *
 * Explicit surfaces are:
 * - /patients/:id/profile for administrative patient identity/profile work
 * - /patients/:id/chronicle for clinical Chronicle access
 *
 * @param {string} defaultAction - Optional action to trigger on mount (e.g., 'ward_round')
 */
const PatientPage = ({ defaultAction }) => {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const target = CLINICAL_PATIENT_ROLES.has(user?.role)
    ? `/patients/${id}/chronicle${location.search}`
    : `/patients/${id}/profile${location.search}`;

  return (
    <Navigate
      replace
      to={target}
      state={{ ...(location.state || {}), defaultAction }}
    />
  );
};

export default PatientPage;
