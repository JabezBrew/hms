import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { nursingKeys } from '@/hooks/nursing/nursingQueryKeys';
import { adaptV2NursingTask, adaptV2PatientVitals, normalizeV2CreateVitalsPayload, normalizeV2TaskPayload } from '@/hooks/nursingQueriesV2Bridge';
import { decideNursingTask, recordNursingTask, recordPatientVitals } from './api';

function invalidateTasks(client) {
  for (const key of [nursingKeys.nursingTasksAll(), nursingKeys.nursingTasksToday(), nursingKeys.patientMonitoringAll()]) client.invalidateQueries({ queryKey: key });
}

export function useCreateVitalSigns() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (data) => isRustV2ApiMode()
      ? adaptV2PatientVitals(await recordPatientVitals(normalizeV2CreateVitalsPayload(data), { patientId: data.patient_id || data.patient, signal: data.signal }))
      : apiClient.post('/nursing/vital-signs/', data),
    onSettled: (_data, _error, input) => {
      const patient = input?.patient_id || input?.patient;
      for (const key of [nursingKeys.vitalSignsAll(), nursingKeys.vitalSignsTrendsAll(), nursingKeys.patientMonitoringAll(), nursingKeys.patientDetail(patient)]) client.invalidateQueries({ queryKey: key });
    },
  });
}

export function useCreateNursingTask() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) return adaptV2NursingTask(await recordNursingTask(normalizeV2TaskPayload(data), { patientId: data.patient_id || data.patient, signal: data.signal }));
      return (await apiClient.post('/nursing/tasks/', data)).data;
    },
    onSettled: () => invalidateTasks(client),
  });
}

export function useCompleteTask() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ taskId, data, signal, patientId, admissionId }) => {
      if (!isRustV2ApiMode()) return (await apiClient.post(`/nursing/tasks/${taskId}/complete/`, data)).data;
      if (data?.completion_notes || data?.notes) throw new Error('Completion notes are unavailable for this task. No decision was submitted.');
      return adaptV2NursingTask(await decideNursingTask(taskId, 'completed', { signal: signal || data?.signal, patientId: patientId || data?.patient_id || data?.patient, admissionId: admissionId || data?.admission_case_id || data?.admission_id }));
    },
    onSettled: () => invalidateTasks(client),
  });
}

export function useUpdateTask() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ taskId, data, status, signal, patientId, admissionId }) => {
      if (!isRustV2ApiMode()) return (await apiClient.patch(`/nursing/tasks/${taskId}/`, data)).data;
      if (data?.completion_notes || data?.notes) throw new Error('Completion notes are unavailable for this task. No decision was submitted.');
      const requested = data?.complete === true ? 'completed' : data?.status || status;
      if (!['completed', 'cancelled'].includes(requested)) throw new Error('Rust V2 does not expose general nursing task edits yet.');
      return adaptV2NursingTask(await decideNursingTask(taskId, requested, { signal: signal || data?.signal, patientId: patientId || data?.patient_id || data?.patient, admissionId: admissionId || data?.admission_case_id || data?.admission_id }));
    },
    onSettled: () => invalidateTasks(client),
  });
}
