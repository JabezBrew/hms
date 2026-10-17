import { ChronicleClinicalPermissionsContext } from '@/features/patients/chronicle/clinicalPermissions';
import ReferralConsultationPanel from './ReferralConsultationPanel';

export default function ChronicleConsultationPreparation({ patientId, clinicalPermissions, preparationOnly, onResponse, ...props }) {
  return <ChronicleClinicalPermissionsContext.Provider value={clinicalPermissions}>
    <ReferralConsultationPanel {...props} patient={{ id: patientId }} preparationOnly={preparationOnly} onResponse={preparationOnly ? undefined : onResponse} />
  </ChronicleClinicalPermissionsContext.Provider>;
}
