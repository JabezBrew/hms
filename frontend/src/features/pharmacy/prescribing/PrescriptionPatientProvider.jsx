import { useMemo } from 'react';
import { PrescriptionPatientContext } from './prescriptionPatientContext';

export function PrescriptionPatientProvider({ patient, patientId, children }) {
  const value = useMemo(() => { const local = patient?.local_data || patient || {}; const user = local.user_details || {}; return { id: patientId || local.id, name: patient?.name || local.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Patient', code: local.patient_code || local.mrn || patient?.patient_code || patient?.mrn || patient?.code || null }; }, [patient, patientId]);
  return <PrescriptionPatientContext.Provider value={value}>{children}</PrescriptionPatientContext.Provider>;
}
