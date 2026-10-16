import { Navigate, useParams } from 'react-router-dom';
import { useEncounter } from '@/features/encounters/hooks/useEncounterQueries';
import { PageState } from '@/shared/components/page/PageState';
import { validId } from '../model';

export default function ClinicalNoteHandoff() {
  const { id } = useParams(); const query = useEncounter(id);
  if (query.isError) return <PageState variant="error" title="Encounter unavailable" description="The authorized patient context could not be confirmed. Open the patient from the registry or your care list." action={() => query.refetch()} />;
  if (query.isLoading || !query.data) return <PageState variant="loading" title="Opening Patient Chronicle" />;
  const patientId = query.data.patient_id || query.data.patient?.id || query.data.patient;
  if (!validId(patientId) || !validId(id)) return <PageState variant="error" title="Patient context unavailable" description="Open the patient’s Chronicle from the registry or your care list." />;
  const action = query.data.v2_status === 'in_progress' ? '&action=add_note' : '';
  return <Navigate replace to={`/patients/${patientId}/chronicle?visit=${id}${action}`} />;
}
