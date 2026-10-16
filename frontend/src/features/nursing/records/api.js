import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';

const VITALS = ['temperature_c', 'systolic_bp', 'diastolic_bp', 'pulse', 'respiratory_rate', 'oxygen_saturation'];
const text = (value) => typeof value === 'string' && value.length > 0;
const sameTime = (left, right) => Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right);
const patientRow = (row) => text(row?.id) && text(row.patient_id) && text(row.admission_case_id);

async function write(operation, validate) {
  let response;
  try {
    response = await operation();
    if (!validate(response?.data)) throw new Error('Unconfirmed nursing receipt');
    acknowledgeWriteResponse(response);
    return response.data;
  } catch (error) {
    const code = error?.data?.error?.code || error?.code;
    if (error?.status >= 400 && error.status < 500 && code !== 'nursing_write_unconfirmed') throw error;
    markWriteResponseUncertain(response || error);
    const uncertain = copyWriteResponseMetadata(new Error('This observation or task decision may have been saved. Review the refreshed record before submitting another change.'), response || error);
    uncertain.name = 'NursingRecordUnconfirmedError';
    uncertain.code = 'nursing_write_unconfirmed';
    throw uncertain;
  }
}

export function recordPatientVitals(payload, { patientId, signal } = {}) {
  if (patientId && payload.patient_id && patientId !== payload.patient_id) throw new Error('Patient context changed. Refresh before recording observations.');
  const expectedPatient = patientId || payload.patient_id;
  const command = expectedPatient ? { ...payload, patient_id: expectedPatient } : payload;
  return write(() => v2Api.postPatientVitals(command, { signal }), (row) => patientRow(row)
    && (!expectedPatient || row.patient_id === expectedPatient)
    && row.admission_case_id === payload.admission_case_id
    && sameTime(row.recorded_at, payload.recorded_at)
    // Rust stores temperature as f32. This tolerance covers its representation,
    // not a different observed value or an invented clinical conversion.
    && VITALS.every((field) => payload[field] == null ? row[field] == null
      : typeof row[field] === 'number' && Number.isFinite(row[field])
        && Math.abs(row[field] - payload[field]) <= (field === 'temperature_c' ? 0.0001 : 0)));
}

export function recordNursingTask(payload, { patientId, signal } = {}) {
  if (patientId && payload.patient_id && patientId !== payload.patient_id) throw new Error('Patient context changed. Refresh before recording tasks.');
  const expectedPatient = patientId || payload.patient_id;
  const command = expectedPatient ? { ...payload, patient_id: expectedPatient } : payload;
  return write(() => v2Api.postNursingTasks(command, { signal }), (row) => patientRow(row)
    && (!expectedPatient || row.patient_id === expectedPatient)
    && row.admission_case_id === payload.admission_case_id
    && text(row.ward_id) && row.task_type === payload.task_type && row.status === 'open'
    && sameTime(row.due_at, payload.due_at)
    && (row.assigned_to_user_id ?? null) === (payload.assigned_to_user_id ?? null)
    && (row.title ?? null) === (payload.title ?? null)
    && (row.instruction ?? null) === (payload.instruction ?? null));
}

export function decideNursingTask(taskId, status, { signal, patientId, admissionId } = {}) {
  const operation = status === 'completed' ? v2Api.postNursingTaskComplete : v2Api.postNursingTaskCancel;
  if (!['completed', 'cancelled'].includes(status)) throw new Error('Choose a supported nursing task decision.');
  return write(() => operation({ id: taskId }, { signal }), (row) => patientRow(row)
    && row.id === taskId && text(row.ward_id) && row.status === status
    && (!patientId || row.patient_id === patientId)
    && (!admissionId || row.admission_case_id === admissionId)
    // Historical actor/time may be unknown. Never fabricate them from this caller.
    && ['completed_at', 'completed_by_user_id', 'cancelled_at', 'cancelled_by_user_id'].every((field) => Object.hasOwn(row, field))
    && [row.completed_at, row.cancelled_at].every((value) => value === null || Number.isFinite(Date.parse(value)))
    && [row.completed_by_user_id, row.cancelled_by_user_id].every((value) => value === null || text(value))
    && (status === 'completed' ? row.cancelled_at === null && row.cancelled_by_user_id === null
      : row.completed_at === null && row.completed_by_user_id === null));
}
