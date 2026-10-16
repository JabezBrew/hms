import { v2Api, v2Request } from '@/lib/api/v2/client';
import { handleV2ApiError } from '@/lib/api/v2/errors';

export const MAX_MONITORING_PAGE_SIZE = 50;
export const MAX_VITALS_PAGE_SIZE = 50;
const MAX_TASK_PAGE_SIZE = 50;
const MAX_ALERT_PAGE_SIZE = 50;
const MAX_MEDICATION_ADMIN_PAGE_SIZE = 50;
const MAX_MEDICATION_ADMIN_WINDOW_PAGES = 100;
const MAX_FLUID_BALANCE_PAGE_SIZE = 50;
const MAX_TREATMENT_SHEET_PAGE_SIZE = 50;
const MAX_WARD_STOCK_REQUEST_PAGE_SIZE = 50;
const MAX_HANDOFF_PAGE_SIZE = 50;
export const DEFAULT_FLUID_BALANCE_SETTINGS = {
  min_daily_intake_target: 1500,
  max_daily_output_threshold: 3000,
  negative_balance_alert_threshold: -500,
  positive_balance_alert_threshold: 2000,
  enable_intake_alerts: true,
  enable_output_alerts: true,
  enable_balance_alerts: true,
};
const RUST_V2_NURSING_TASK_TYPES = new Set(['ward_round', 'observation', 'medication', 'handoff']);

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

export function rethrowV2Error(error, message) {
  rethrowAbortError(error);
  throw new Error(handleV2ApiError(error, message));
}

function repeatedItems(count, factory) {
  const safeCount = Math.max(0, Number.parseInt(count, 10) || 0);
  return Array.from({ length: safeCount }, (_, index) => factory(index));
}

export function adaptV2WardBoardMonitoringItem(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || item.name || 'Unknown Patient';
  const bedNumber = item.bed_code || item.bed_number || '';
  const activeAlertCount = Math.max(0, Number.parseInt(item.active_alert_count, 10) || 0);
  const criticalAlertCount = Math.min(
    activeAlertCount,
    Math.max(0, Number.parseInt(item.critical_alert_count, 10) || 0),
  );
  const activeAlerts = [
    ...repeatedItems(criticalAlertCount, (index) => ({
      id: `${item.admission_id || item.patient_id}-critical-alert-${index + 1}`,
      severity: 'critical',
      status: 'open',
    })),
    ...repeatedItems(activeAlertCount - criticalAlertCount, (index) => ({
      id: `${item.admission_id || item.patient_id}-alert-${index + 1}`,
      severity: 'medium',
      status: 'open',
    })),
  ];

  return {
    patient_id: item.patient_id,
    patient_name: patientName,
    patient_mrn: item.patient_code || '',
    patient_code: item.patient_code || '',
    patient_display_name: patientName,
    ward_id: item.ward_id,
    ward_name: item.ward_name || '',
    admission_id: item.admission_id,
    bed_id: item.bed_id ?? null,
    bed_number: bedNumber,
    patient: {
      id: item.patient_id,
      medical_record_number: item.patient_code || '',
      user: {
        full_name: patientName,
      },
      user_details: {
        full_name: patientName,
      },
    },
    admission: {
      id: item.admission_id,
      status: item.admission_status,
      admitted_at: item.admitted_at,
      bed_details: {
        id: item.bed_id ?? null,
        bed_number: bedNumber,
        ward_details: {
          id: item.ward_id,
          name: item.ward_name || '',
        },
      },
    },
    latest_vitals: null,
    fluid_condition_count: Math.max(0, Number(item.fluid_condition_count) || 0),
    fluid_critical_count: Math.max(0, Number(item.fluid_critical_count) || 0),
    fluid_assessment_status: item.fluid_assessment_status || 'unconfigured',
    active_alert_count: activeAlertCount,
    critical_alert_count: criticalAlertCount,
    active_alerts: activeAlerts,
    pending_tasks: repeatedItems(item.open_nursing_task_count, (index) => ({
      id: `${item.admission_id || item.patient_id}-task-${index + 1}`,
      status: 'open',
    })),
    medications_due: repeatedItems(item.due_medication_count, (index) => ({
      id: `${item.admission_id || item.patient_id}-med-${index + 1}`,
      status: 'scheduled',
    })),
  };
}

export function adaptV2Handoff(item = {}) {
  return {
    ...item,
    ward: item.ward_id,
    ward_id: item.ward_id,
    ward_name: item.ward_name || '',
    from_nurse: item.from_user_id,
    from_user_id: item.from_user_id,
    to_nurse: item.to_user_id,
    to_user_id: item.to_user_id,
    shift_type: item.shift_label,
    shift_label: item.shift_label,
    shift_date: item.created_at ? String(item.created_at).slice(0, 10) : null,
  };
}

export function adaptV2NursingAlert(item = {}) {
  const patientName = item.patient_display_name || 'Unknown Patient';
  return {
    ...item,
    admission: item.admission_case_id,
    admission_case_id: item.admission_case_id,
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_mrn: item.patient_code || '',
    patient_code: item.patient_code || '',
    patient_name: patientName,
    patient_display_name: patientName,
    alert_type: 'nursing_alert',
    message: item.title || 'Nursing alert',
    acknowledged: Boolean(item.acknowledged_at) || item.status === 'acknowledged',
    resolved: item.status === 'resolved',
    patient_details: {
      id: item.patient_id,
      medical_record_number: item.patient_code || '',
      user_details: {
        full_name: patientName,
      },
    },
  };
}

function legacyTaskStatus(status) {
  if (status === 'open') return 'pending';
  return status || 'pending';
}

function rustTaskStatus(status) {
  if (status === 'pending' || status === 'in_progress' || status === 'overdue') return 'open';
  return status;
}

function rustTaskType(taskType) {
  if (RUST_V2_NURSING_TASK_TYPES.has(taskType)) {
    return taskType;
  }
  return null;
}

function requireRustTaskType(taskType) {
  const normalized = rustTaskType(taskType);
  if (!normalized) {
    throw new Error('Rust V2 nursing task type must be one of ward_round, observation, medication, or handoff.');
  }
  return normalized;
}

export function adaptV2NursingTask(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || 'Unknown Patient';
  const dueAt = item.due_at || item.scheduled_time || null;
  const taskType = item.task_type || 'observation';
  const taskTitle = item.title || item.description || `${taskType.replaceAll('_', ' ')} task`;
  const taskInstruction = item.instruction || item.instructions || '';
  return {
    ...item,
    admission: item.admission_case_id,
    admission_case_id: item.admission_case_id,
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_mrn: item.patient_code || '',
    patient_code: item.patient_code || '',
    patient_name: patientName,
    patient_display_name: patientName,
    description: taskInstruction ? `${taskTitle}: ${taskInstruction}` : taskTitle,
    title: item.title || taskTitle,
    instruction: taskInstruction,
    task_type: taskType,
    status: legacyTaskStatus(item.status),
    due_at: dueAt,
    scheduled_time: dueAt,
    priority: item.priority || 'medium',
    assigned_to_name: item.assigned_to_name || '',
  };
}

export function adaptV2MedicationAdministration(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || 'Unknown Patient';
  const scheduledAt = item.scheduled_at || item.scheduled_time || null;
  const medicationName = item.medication_name || item.prescription_name || 'Medication';
  const administeredAt = item.administered_at || item.administered_time || null;
  return {
    ...item,
    admission: item.admission_case_id,
    admission_case_id: item.admission_case_id,
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_mrn: item.patient_code || '',
    patient_code: item.patient_code || '',
    patient_name: patientName,
    patient_display_name: patientName,
    medication_name: medicationName,
    prescription_name: medicationName,
    scheduled_at: scheduledAt,
    scheduled_time: scheduledAt,
    administered_at: administeredAt,
    administered_time: administeredAt,
    dosage: item.dose ?? item.dosage ?? '',
    route: item.route || '',
    route_display: item.route_display || item.route || '',
    frequency_display: item.frequency_display || item.frequency || '',
    status_display: ({ scheduled: 'Scheduled', administered: 'Administered', missed: 'Missed', refused: 'Refused', held: 'Held' })[item.status] || item.status || 'Scheduled',
    administration_notes: item.administration_notes || '',
    reason_not_given: item.reason_not_given || '',
    notes: item.administration_notes || '',
    is_dispensed: item.is_dispensed ?? true,
    status: item.status || 'scheduled',
  };
}

export function adaptV2TreatmentSheet(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || 'Unknown Patient';
  return {
    ...item,
    admission: item.admission_case_id,
    admission_case_id: item.admission_case_id,
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_mrn: item.patient_code || '',
    patient_code: item.patient_code || '',
    patient_name: patientName,
    patient_display_name: patientName,
    date: item.sheet_date,
    sheet_date: item.sheet_date,
  };
}

export function adaptV2WardStockRequest(item = {}) {
  const legacyStatus = item.status === 'requested' ? 'pending' : item.status;
  return {
    ...item,
    ward: item.ward_id,
    ward_id: item.ward_id,
    ward_name: item.ward_name || '',
    item_name: item.requested_item,
    requested_item: item.requested_item,
    quantity: item.quantity_requested,
    quantity_requested: item.quantity_requested,
    quantity_dispensed: item.status === 'fulfilled' ? item.quantity_requested : 0,
    status: legacyStatus,
    rust_status: item.status,
  };
}

export function adaptV2FluidBalanceItem(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || 'Unknown Patient';
  const base = {
    source_id: item.id,
    admission: item.admission_case_id,
    admission_case_id: item.admission_case_id,
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_mrn: item.patient_code || '',
    patient_code: item.patient_code || '',
    patient_name: patientName,
    patient_display_name: patientName,
    recorded_at: item.recorded_at,
    net_ml: item.net_ml ?? ((item.intake_ml || 0) - (item.output_ml || 0)),
  };
  const records = [];
  if ((item.intake_ml || 0) > 0) {
    records.push({
      ...base,
      id: `${item.id}:intake`,
      entry_type: 'intake',
      volume_ml: item.intake_ml,
    });
  }
  if ((item.output_ml || 0) > 0) {
    records.push({
      ...base,
      id: `${item.id}:output`,
      entry_type: 'output',
      volume_ml: item.output_ml,
    });
  }
  return records.length ? records : [{
    ...base,
    id: item.id,
    entry_type: 'intake',
    volume_ml: 0,
  }];
}

export function adaptV2PatientVitals(item = {}) {
  return {
    ...item,
    patient: item.patient_id,
    admission: item.admission_case_id,
    temperature: item.temperature_c,
    heart_rate: item.pulse,
    spo2: item.oxygen_saturation,
    oxygen_saturation: item.oxygen_saturation,
    blood_pressure_systolic: item.systolic_bp,
    blood_pressure_diastolic: item.diastolic_bp,
  };
}

export function normalizeV2FluidBalancePayload(data = {}) {
  const admissionCaseId = data.admission_case_id || data.admission_id || data.admission;
  if (!admissionCaseId) {
    throw new Error('Admission case is required to record Rust V2 fluid balance');
  }
  const volume = Number(data.volume_ml ?? data.amount_ml ?? data.amount ?? 0);
  const intake = data.intake_ml ?? (data.entry_type === 'intake' ? volume : 0);
  const output = data.output_ml ?? (data.entry_type === 'output' ? volume : 0);
  if (![Number(intake), Number(output)].every((value) => Number.isInteger(value) && value >= 0 && value <= 2147483647)) {
    throw new Error('Fluid volumes must be whole, non-negative millilitres.');
  }
  return {
    admission_case_id: admissionCaseId,
    recorded_at: new Date(data.recorded_at || Date.now()).toISOString(),
    intake_ml: Number(intake),
    output_ml: Number(output),
  };
}

export function normalizeV2TreatmentSheetPayload(data = {}) {
  const admissionCaseId = data.admission_case_id || data.admission_id || data.admission;
  const sheetDate = data.sheet_date || data.date;
  if (!admissionCaseId) {
    throw new Error('Admission case is required to create a Rust V2 treatment sheet');
  }
  if (!sheetDate) {
    throw new Error('Sheet date is required to create a Rust V2 treatment sheet');
  }
  return {
    admission_case_id: admissionCaseId,
    sheet_date: sheetDate,
  };
}

export function normalizeV2WardStockRequestPayload(data = {}) {
  const wardId = data.ward_id || data.ward;
  const requestedItem = data.requested_item || data.item_name || data.item || data.medication_name;
  const quantity = Number.parseInt(data.quantity_requested ?? data.quantity ?? data.quantityDispensed, 10);
  if (!wardId) {
    throw new Error('Ward is required to create a Rust V2 ward stock request');
  }
  if (!requestedItem) {
    throw new Error('Requested item is required to create a Rust V2 ward stock request');
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new Error('Quantity is required to create a Rust V2 ward stock request');
  }
  return {
    ward_id: wardId,
    requested_item: requestedItem,
    quantity_requested: quantity,
  };
}

export function normalizeV2MedicationAdministrationPayload(data = {}) {
  const admissionCaseId = data.admission_case_id || data.admission_id || data.admission;
  const medicationName = data.medication_name || data.prescription_name || data.medication || data.name;
  const scheduledAt = data.scheduled_at || data.scheduled_time;
  if (!admissionCaseId) {
    throw new Error('Admission case is required to schedule a Rust V2 medication administration');
  }
  if (!medicationName) {
    throw new Error('Medication name is required to schedule a Rust V2 medication administration');
  }
  if (!scheduledAt) {
    throw new Error('Scheduled time is required to schedule a Rust V2 medication administration');
  }

  return {
    admission_case_id: admissionCaseId,
    medication_name: medicationName,
    scheduled_at: new Date(scheduledAt).toISOString(),
  };
}

export function normalizeV2MedicationAdministerPayload(data = {}) {
  const status = data.status || 'administered';
  if (!['administered', 'missed', 'refused', 'held'].includes(status)) {
    throw new Error('Choose a supported medication dose outcome.');
  }
  const text = (value, maxBytes, label) => {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || new TextEncoder().encode(value.trim()).length > maxBytes) {
      throw new Error(`${label} is too long or invalid.`);
    }
    return value.trim() || null;
  };
  const reason = status === 'administered' ? null : text(data.reason_not_given, 1000, 'Reason');
  if (status !== 'administered' && !reason) throw new Error('A reason is required when a dose is not given.');
  return {
    status,
    witness_user_id: status === 'administered' ? data.witness_user_id || data.witness || data.witnessUserId || null : null,
    reason_not_given: reason,
    administration_notes: text(data.administration_notes ?? data.notes, 2000, 'Notes'),
  };
}

export async function recordV2MedicationOutcome(medicationId, data, { signal } = {}) {
  const payload = normalizeV2MedicationAdministerPayload(data);
  try {
    const response = await v2Api.postMedicationAdministrationOutcome({ id: medicationId }, payload, { signal });
    if (response?.data?.id !== medicationId || response?.data?.status !== payload.status) {
      throw new Error('The response did not confirm the requested dose outcome.');
    }
    return adaptV2MedicationAdministration(response.data);
  } catch (error) {
    if (!(error?.status >= 400 && error?.status < 500) || error?.data?.error?.code === 'medication_outcome_unconfirmed') {
      const uncertain = new Error('The dose outcome may have been saved. Review the refreshed record before trying again.');
      uncertain.name = 'MedicationOutcomeUnconfirmedError';
      throw uncertain;
    }
    rethrowV2Error(error, 'The dose outcome could not be recorded.');
  }
}

export function normalizeV2TaskPayload(data = {}) {
  const admissionCaseId = data.admission_case_id || data.admission_id || data.admission;
  const dueAt = data.due_at || data.scheduled_time;
  if (!admissionCaseId) {
    throw new Error('Admission case is required to create a Rust V2 nursing task');
  }
  if (!dueAt) {
    throw new Error('Due time is required to create a Rust V2 nursing task');
  }

  const assignedTo = data.assigned_to_user_id || data.assigned_to || null;
  const title = String(data.title || data.description || '').trim();
  const instruction = String(data.instruction || data.instructions || data.description || '').trim();
  return {
    admission_case_id: admissionCaseId,
    task_type: requireRustTaskType(data.task_type),
    due_at: new Date(dueAt).toISOString(),
    assigned_to_user_id: assignedTo || null,
    title: title || null,
    instruction: instruction || null,
  };
}

export function normalizeV2HandoffPayload(data = {}) {
  const wardId = data.ward_id || data.ward;
  const toUserId = data.to_user_id || data.to_nurse;
  const shiftLabel = data.shift_label || data.shift_type;
  if (!wardId) {
    throw new Error('Ward is required to create a Rust V2 shift handoff');
  }
  if (!toUserId) {
    throw new Error('Receiving nurse is required to create a Rust V2 shift handoff');
  }
  if (!shiftLabel) {
    throw new Error('Shift label is required to create a Rust V2 shift handoff');
  }
  return {
    ward_id: wardId,
    to_user_id: toUserId,
    shift_label: shiftLabel,
  };
}

function handoffMatchesFilters(handoff, filters = {}) {
  const ward = filters.ward || filters.ward_id;
  if (ward && handoff.ward_id !== ward) {
    return false;
  }
  const shift = filters.shift || filters.shift_type || filters.shift_label;
  if (shift && handoff.shift_label !== shift) {
    return false;
  }
  if (filters.date && handoff.shift_date !== filters.date) {
    return false;
  }
  return true;
}

function taskMatchesFilters(task, filters = {}) {
  const patient = filters.patient || filters.patient_id;
  if (patient && task.patient_id !== patient) {
    return false;
  }
  const status = filters.status;
  if (status && status !== 'all' && rustTaskStatus(status) !== rustTaskStatus(task.status)) {
    return false;
  }
  const taskType = filters.task_type;
  if (taskType && taskType !== 'all') {
    const normalizedTaskType = rustTaskType(taskType);
    if (!normalizedTaskType || normalizedTaskType !== task.task_type) {
      return false;
    }
  }
  const priority = filters.priority;
  if (priority && priority !== 'all' && task.priority !== priority) {
    return false;
  }
  if (filters.date && task.scheduled_time?.slice(0, 10) !== filters.date) {
    return false;
  }
  return true;
}

function alertMatchesFilters(alert, filters = {}) {
  const patient = filters.patient || filters.patient_id;
  if (patient && alert.patient_id !== patient) {
    return false;
  }
  const severity = filters.severity;
  if (severity && severity !== 'all' && alert.severity !== severity) {
    return false;
  }
  const status = filters.status;
  if (status && status !== 'all' && alert.status !== status) {
    return false;
  }
  return true;
}

function medicationAdministrationMatchesFilters(item, filters = {}) {
  const patient = filters.patient || filters.patient_id;
  if (patient && item.patient_id !== patient) {
    return false;
  }
  const admission = filters.admission || filters.admission_id || filters.admission_case_id;
  if (admission && item.admission_case_id !== admission) {
    return false;
  }
  const status = filters.status;
  if (status && status !== 'all' && item.status !== status) {
    return false;
  }
  if (filters.date && item.scheduled_time?.slice(0, 10) !== filters.date) {
    return false;
  }
  if (filters.start_date && item.scheduled_time?.slice(0, 10) < filters.start_date) {
    return false;
  }
  if (filters.end_date && item.scheduled_time?.slice(0, 10) > filters.end_date) {
    return false;
  }
  return true;
}

function treatmentSheetMatchesFilters(item, filters = {}) {
  const id = filters.id || filters.entry_id;
  if (id && item.id !== id) {
    return false;
  }
  const admission = filters.admission || filters.admission_id || filters.admission_case_id;
  if (admission && item.admission_case_id !== admission) {
    return false;
  }
  if (filters.date && item.sheet_date !== filters.date) {
    return false;
  }
  return true;
}

function wardStockRequestMatchesFilters(item, filters = {}) {
  const id = filters.id || filters.request_id;
  if (id && item.id !== id) {
    return false;
  }
  const ward = filters.ward || filters.ward_id;
  if (ward && item.ward_id !== ward) {
    return false;
  }
  const status = filters.status;
  if (status && status !== 'all') {
    const rustStatus = status === 'pending' ? 'requested' : status;
    if (item.rust_status !== rustStatus && item.status !== status) {
      return false;
    }
  }
  return true;
}

function dateKey(value) {
  return value ? String(value).slice(0, 10) : null;
}

export function addDaysToDateKey(dateString, offset) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function normalizeDoseStatus(item) {
  if (item.status === 'scheduled' && item.scheduled_time && Date.parse(item.scheduled_time) <= Date.now()) {
    return 'due';
  }
  return item.status || 'scheduled';
}

export function buildPatientMAR(records = [], patientId, date = null) {
  const first = records[0] || {};
  return {
    patient_id: patientId || first.patient_id || null,
    patient: patientId || first.patient_id || null,
    patient_name: first.patient_name || first.patient_display_name || '',
    patient_mrn: first.patient_mrn || first.patient_code || '',
    date,
    medications: records.map((record) => ({
      ...record,
      status: record.status || 'scheduled',
      is_dispensed: record.is_dispensed ?? true,
      administered_time: record.administered_time || record.administered_at || null,
    })),
  };
}

export function buildMARGrid(records = [], admissionId, startDate = null, days = 7) {
  const safeDays = Math.max(1, Number.parseInt(days, 10) || 7);
  const firstDate = startDate || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const dateHeaders = Array.from({ length: safeDays }, (_, index) => {
    const date = addDaysToDateKey(firstDate, index);
    return {
      date,
      label: date,
      is_today: date === today,
    };
  });
  const allowedDates = new Set(dateHeaders.map((header) => header.date));
  const emptyDays = () => Object.fromEntries(dateHeaders.map((header) => [
    header.date,
    { doses: [], doses_given: 0, doses_required: 0 },
  ]));
  const rows = new Map();

  records.forEach((record) => {
    const date = dateKey(record.scheduled_time);
    if (!date || !allowedDates.has(date)) {
      return;
    }
    const key = record.prescription_id || record.medication_name || record.id;
    if (!rows.has(key)) {
      rows.set(key, {
        id: key,
        medication_name: record.medication_name || 'Medication',
        dosage: record.dosage || '',
        route_display: record.route_display || record.route || '',
        frequency_display: record.frequency_display || '',
        duration_days: null,
        progress_scope: 'selected_period',
        total_doses_required: 0,
        total_doses_administered: 0,
        course_complete: false,
        days: emptyDays(),
      });
    }

    const row = rows.get(key);
    const day = row.days[date];
    const dose = {
      id: record.id,
      prn_indication: record.prn_indication,
      prn_request_id: record.prn_request_id,
      dose_number: day.doses.length + 1,
      status: normalizeDoseStatus(record),
      scheduled_time: record.scheduled_time,
      administered_time: record.administered_time || record.administered_at || null,
      administered_by: record.administered_by || '',
      notes: record.administration_notes || record.notes || '',
      reason_not_given: record.reason_not_given || '',
      outcome_recorded_at: record.outcome_recorded_at,
      outcome_recorded_by_display_name: record.outcome_recorded_by_display_name,
      is_dispensed: record.is_dispensed,
      prescription_id: record.prescription_id,
      pharmacy_fulfillment_id: record.pharmacy_fulfillment_id,
    };
    day.doses.push(dose);
    day.doses_required += 1;
    if (dose.status === 'administered') {
      day.doses_given += 1;
    }
    row.total_doses_required += 1;
    if (dose.status === 'administered') {
      row.total_doses_administered += 1;
    }
  });

  const medications = Array.from(rows.values()).map((row) => ({
    ...row,
    course_complete: false,
    period_complete: Object.values(row.days).flatMap((day) => day.doses).every((dose) => ['administered', 'missed', 'refused', 'held'].includes(dose.status)),
  }));
  const first = records[0] || {};

  return {
    admission_id: admissionId,
    admission: admissionId,
    patient_id: first.patient_id || null,
    patient_name: first.patient_name || first.patient_display_name || '',
    patient_mrn: first.patient_mrn || first.patient_code || '',
    date_headers: dateHeaders,
    time_slots: [],
    medications,
  };
}

export function isDueMedicationAdministration(item) {
  return item.status === 'scheduled' && item.scheduled_time && Date.parse(item.scheduled_time) <= Date.now();
}

function adaptMatchingV2Items(items, adapt, matches) {
  const adaptedItems = [];
  for (const item of Array.isArray(items) ? items : []) {
    const adaptedItem = adapt(item);
    if (matches(adaptedItem)) {
      adaptedItems.push(adaptedItem);
    }
  }
  return adaptedItems;
}

function marDateBoundary(value, nextDay = false) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())
    || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Choose a valid medication schedule date.');
  }
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function marTimestamp(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid medication schedule time.');
  return date.toISOString();
}

export function medicationAdministrationQuery(filters = {}) {
  const status = filters.status && filters.status !== 'all' ? filters.status : undefined;
  if (status && !['scheduled', 'administered', 'missed', 'refused', 'held'].includes(status)) {
    throw new Error('This medication administration status is not supported in this deployment.');
  }
  const limit = Number.parseInt(filters.page_size || filters.limit, 10);
  return {
    limit: Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : MAX_MEDICATION_ADMIN_PAGE_SIZE,
    patient_id: filters.patient_id || filters.patient || undefined,
    admission_case_id: filters.admission_case_id || filters.admission_id || filters.admission || undefined,
    scheduled_from: marTimestamp(filters.scheduled_from) || marDateBoundary(filters.date || filters.start_date),
    scheduled_before: marTimestamp(filters.scheduled_before) || marDateBoundary(filters.date || filters.end_date, true),
    status,
    descending: filters.descending ?? (filters.ordering ? filters.ordering.startsWith('-') : undefined),
    cursor: filters.cursor || undefined,
  };
}

export function medicationAdministrationCacheScope(filters = {}) {
  try {
    return medicationAdministrationQuery(filters);
  } catch {
    // Invalid user filters become query errors; never put their raw input in
    // the cache key or throw during React rendering.
    return { invalid: true };
  }
}

export async function getV2MedicationAdministrationPage(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getMedicationAdministrations({
      query: medicationAdministrationQuery(filters),
      signal,
    });
    if (!Array.isArray(response?.data) || typeof response?.page?.has_next !== 'boolean'
      || (response.page.has_next && !response.page.next_cursor)) {
      throw new Error('Medication schedule pagination could not be confirmed. Reload this view.');
    }
    return {
      results: adaptMatchingV2Items(
        response.data,
        adaptV2MedicationAdministration,
        (item) => medicationAdministrationMatchesFilters(item, filters)
      ),
      has_next: response.page.has_next,
      next_cursor: response?.page?.next_cursor || null,
    };
  } catch (error) {
    rethrowV2Error(error, 'Failed to load medication administrations');
  }
}

// A date-window MAR is a complete clinical grid, not a preview of the first
// facility page. Follow the server's scoped cursors; never return partial data
// as a complete schedule when the safety bound or a later page fails.
export async function getV2MedicationAdministrations(filters = {}, { signal } = {}) {
  const results = [];
  const seenCursors = new Set();
  let cursor = filters.cursor;
  for (let page = 0; page < MAX_MEDICATION_ADMIN_WINDOW_PAGES; page += 1) {
    const response = await getV2MedicationAdministrationPage({ ...filters, cursor }, { signal });
    results.push(...response.results);
    if (!response.has_next) return results;
    if (!response.next_cursor || seenCursors.has(response.next_cursor)) {
      throw new Error('Medication schedule could not be fully loaded. Reload this view.');
    }
    seenCursors.add(response.next_cursor);
    cursor = response.next_cursor;
  }
  throw new Error('Too many medication doses for this view. Choose a shorter date range.');
}

export async function getV2TreatmentSheets(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getTreatmentSheets({
      query: { limit: MAX_TREATMENT_SHEET_PAGE_SIZE },
      signal,
    });
    return adaptMatchingV2Items(
      response?.data,
      adaptV2TreatmentSheet,
      (item) => treatmentSheetMatchesFilters(item, filters)
    );
  } catch (error) {
    rethrowV2Error(error, 'Failed to load treatment sheets');
  }
}

export async function getV2WardStockRequests(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getWardStockRequests({
      query: { limit: MAX_WARD_STOCK_REQUEST_PAGE_SIZE },
      signal,
    });
    return adaptMatchingV2Items(
      response?.data,
      adaptV2WardStockRequest,
      (item) => wardStockRequestMatchesFilters(item, filters)
    );
  } catch (error) {
    rethrowV2Error(error, 'Failed to load ward stock requests');
  }
}

function fluidBalanceMatchesFilters(item, patientId, filters = {}) {
  if (patientId && item.patient_id !== patientId) {
    return false;
  }
  const admission = filters.admission || filters.admission_id || filters.admission_case_id;
  if (admission && item.admission_case_id !== admission) {
    return false;
  }
  if (filters.date && item.recorded_at?.slice(0, 10) !== filters.date) {
    return false;
  }
  if (filters.start_date && item.recorded_at?.slice(0, 10) < filters.start_date) {
    return false;
  }
  if (filters.end_date && item.recorded_at?.slice(0, 10) > filters.end_date) {
    return false;
  }
  return true;
}

export function summarizeFluidBalance(records = []) {
  let totalIntake = 0;
  let totalOutput = 0;
  for (const record of records) {
    if (record.entry_type === 'intake') {
      totalIntake += Number(record.volume_ml) || 0;
    } else if (record.entry_type === 'output') {
      totalOutput += Number(record.volume_ml) || 0;
    }
  }
  return {
    total_intake: totalIntake,
    total_output: totalOutput,
    balance: totalIntake - totalOutput,
    intake_breakdown: {},
    output_breakdown: {},
  };
}

export function fluidBalanceTrendPoints(records = []) {
  const byDate = new Map();
  records.forEach((record) => {
    const date = record.recorded_at?.slice(0, 10);
    if (!date) return;
    const point = byDate.get(date) || { date, intake: 0, output: 0, balance: 0 };
    if (record.entry_type === 'intake') {
      point.intake += Number(record.volume_ml) || 0;
    } else if (record.entry_type === 'output') {
      point.output += Number(record.volume_ml) || 0;
    }
    point.balance = point.intake - point.output;
    byDate.set(date, point);
  });
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function deriveFluidBalanceAlerts(summary, settings = DEFAULT_FLUID_BALANCE_SETTINGS) {
  const alerts = [];
  if (settings.enable_intake_alerts && summary.total_intake < settings.min_daily_intake_target) {
    alerts.push({
      type: 'low_intake',
      severity: 'warning',
      message: 'Daily intake is below target',
    });
  }
  if (settings.enable_output_alerts && summary.total_output > settings.max_daily_output_threshold) {
    alerts.push({
      type: 'high_output',
      severity: 'warning',
      message: 'Daily output is above threshold',
    });
  }
  if (settings.enable_balance_alerts && summary.balance < settings.negative_balance_alert_threshold) {
    alerts.push({
      type: 'negative_balance',
      severity: 'warning',
      message: 'Fluid balance is below threshold',
    });
  }
  if (settings.enable_balance_alerts && summary.balance > settings.positive_balance_alert_threshold) {
    alerts.push({
      type: 'positive_balance',
      severity: 'warning',
      message: 'Fluid balance is above threshold',
    });
  }
  return alerts;
}

export function fluidBalanceQuery(patientId, filters = {}) {
  if (filters.entry_type && !['all', 'intake', 'output'].includes(filters.entry_type)) {
    throw new Error('Choose intake or output for the fluid balance entry type.');
  }
  const limit = Number.parseInt(filters.limit || filters.page_size, 10);
  return {
    patient_id: patientId || filters.patient_id || filters.patient || undefined,
    admission_case_id: filters.admission_case_id || filters.admission_id || filters.admission || undefined,
    recorded_from: marTimestamp(filters.recorded_from) || marDateBoundary(filters.date || filters.start_date),
    recorded_before: marTimestamp(filters.recorded_before) || marDateBoundary(filters.date || filters.end_date, true),
    cursor: filters.cursor || undefined,
    limit: Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : MAX_FLUID_BALANCE_PAGE_SIZE,
    descending: filters.descending ?? (filters.ordering ? filters.ordering.startsWith('-') : undefined),
  };
}

export function fluidBalanceCacheScope(patientId, filters = {}) {
  try {
    return { ...fluidBalanceQuery(patientId, filters), entry_type: filters.entry_type || 'all' };
  } catch {
    return { invalid: true };
  }
}

function requireFluidScope(query) {
  if (!query.patient_id && !query.admission_case_id) throw new Error('Patient or admission is required for fluid balance.');
}

async function loadFluidPages(operation, patientId, filters, signal) {
  const query = fluidBalanceQuery(patientId, filters);
  requireFluidScope(query);
  const rows = [];
  const cursors = new Set();
  for (let page = 0; page < 100; page += 1) {
    const response = await operation({ query, signal });
    if (!Array.isArray(response?.data) || typeof response?.page?.has_next !== 'boolean'
      || (response.page.has_next && !response.page.next_cursor)) {
      throw new Error('Fluid balance pagination could not be confirmed. Reload this view.');
    }
    rows.push(...response.data);
    if (!response.page.has_next) return rows;
    if (cursors.has(response.page.next_cursor)) throw new Error('Fluid balance could not be fully loaded. Reload this view.');
    cursors.add(response.page.next_cursor);
    query.cursor = response.page.next_cursor;
  }
  throw new Error('Too many fluid balance records for this view. Choose a shorter date range.');
}

export async function getV2FluidBalanceEntries(patientId, filters = {}, { signal } = {}) {
  try {
    const rows = await loadFluidPages(v2Api.getFluidBalanceEntries, patientId, filters, signal);
    return rows.flatMap((item) => fluidBalanceMatchesFilters(item, patientId, filters) ? adaptV2FluidBalanceItem(item) : [])
      .filter((entry) => !filters.entry_type || filters.entry_type === 'all' || filters.entry_type === entry.entry_type);
  } catch (error) {
    rethrowV2Error(error, 'Failed to load fluid balance entries');
  }
}

function validFluidAggregate(item) {
  return ['entry_count', 'total_intake_ml', 'total_output_ml', 'net_ml'].every((key) => Number.isSafeInteger(item?.[key]))
    && item.entry_count >= 0 && item.total_intake_ml >= 0 && item.total_output_ml >= 0
    && item.net_ml === item.total_intake_ml - item.total_output_ml;
}

export async function getV2FluidBalanceSummary(patientId, filters = {}, { signal } = {}) {
  try {
    const query = fluidBalanceQuery(patientId, filters);
    requireFluidScope(query);
    const response = await v2Api.getFluidBalanceSummary({ query, signal });
    const summary = response?.data;
    if (!validFluidAggregate(summary)) throw new Error('Fluid balance totals could not be confirmed. Reload this view.');
    return { total_intake: summary.total_intake_ml, total_output: summary.total_output_ml, balance: summary.net_ml,
      entry_count: summary.entry_count, intake_breakdown: {}, output_breakdown: {} };
  } catch (error) {
    rethrowV2Error(error, 'Failed to load fluid balance totals');
  }
}

export async function getV2FluidBalanceTrends(patientId, filters = {}, { signal } = {}) {
  try {
    const points = await loadFluidPages(v2Api.getFluidBalanceTrends, patientId, filters, signal);
    if (!points.every((point) => validFluidAggregate(point) && /^\d{4}-\d{2}-\d{2}$/.test(point.date))) {
      throw new Error('Fluid balance trends could not be confirmed. Reload this view.');
    }
    return points.map((point) => ({ date: point.date, intake: point.total_intake_ml, output: point.total_output_ml, balance: point.net_ml, entry_count: point.entry_count }));
  } catch (error) {
    rethrowV2Error(error, 'Failed to load fluid balance trends');
  }
}

export async function getV2NursingAlerts(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getNursingAlerts({
      query: { limit: MAX_ALERT_PAGE_SIZE },
      signal,
    });
    return adaptMatchingV2Items(
      response?.data,
      adaptV2NursingAlert,
      (alert) => alertMatchesFilters(alert, filters)
    );
  } catch (error) {
    rethrowV2Error(error, 'Failed to load nursing alerts');
  }
}

export async function getV2NursingTasks(filters = {}, { signal } = {}) {
  try {
    const patientId = filters.patient || filters.patient_id;
    const admissionCaseId = filters.admission || filters.admission_id || filters.admission_case_id;
    const response = await v2Api.getNursingTasks({
      query: {
        limit: MAX_TASK_PAGE_SIZE,
        ...(patientId ? { patient_id: patientId } : {}),
        ...(admissionCaseId ? { admission_case_id: admissionCaseId } : {}),
      },
      signal,
    });
    return adaptMatchingV2Items(
      response?.data,
      adaptV2NursingTask,
      (task) => taskMatchesFilters(task, filters)
    );
  } catch (error) {
    rethrowV2Error(error, 'Failed to load nursing tasks');
  }
}

export async function getV2Handoffs(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getHandoffs({
      query: { limit: MAX_HANDOFF_PAGE_SIZE },
      signal,
    });
    return adaptMatchingV2Items(
      response?.data,
      adaptV2Handoff,
      (handoff) => handoffMatchesFilters(handoff, filters)
    );
  } catch (error) {
    rethrowV2Error(error, 'Failed to load shift handoffs');
  }
}

function normalizeVitalSignsLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }
  return Math.min(parsed, MAX_VITALS_PAGE_SIZE);
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAdmissionCaseId(data = {}) {
  return data.admission_case_id
    || data.admissionCaseId
    || data.admission_id
    || data.admission?.id
    || null;
}

export function normalizeV2CreateVitalsPayload(data = {}) {
  const admissionCaseId = getAdmissionCaseId(data);
  if (!admissionCaseId) {
    throw new Error('Active admission is required to record vital signs in Rust V2');
  }

  return {
    admission_case_id: admissionCaseId,
    recorded_at: data.recorded_at || new Date().toISOString(),
    temperature_c: normalizeOptionalNumber(data.temperature_c ?? data.temperature),
    systolic_bp: normalizeOptionalNumber(data.systolic_bp ?? data.blood_pressure_systolic),
    diastolic_bp: normalizeOptionalNumber(data.diastolic_bp ?? data.blood_pressure_diastolic),
    pulse: normalizeOptionalNumber(data.pulse ?? data.heart_rate),
    respiratory_rate: normalizeOptionalNumber(data.respiratory_rate),
    oxygen_saturation: normalizeOptionalNumber(data.oxygen_saturation ?? data.spo2),
  };
}

export async function getV2PatientVitals(filters = {}, { signal } = {}) {
  const patientId = filters.patient_id || filters.patient;
  const query = {
    limit: normalizeVitalSignsLimit(filters.limit),
  };
  if (patientId) {
    query.patient_id = patientId;
  }
  const admissionCaseId = filters.admission_case_id || filters.admission_id || filters.admission;
  if (admissionCaseId) {
    query.admission_case_id = admissionCaseId;
  }
  if (filters.hours !== undefined && filters.hours !== null && filters.hours !== '') {
    query.hours = filters.hours;
  }
  try {
    const response = await v2Api.getPatientVitals({
      query,
      signal,
    });
    const rows = (response?.data ?? []).map(adaptV2PatientVitals);
    if (filters.ordering === '-recorded_at') {
      return rows.sort((left, right) => new Date(right.recorded_at) - new Date(left.recorded_at));
    }
    return rows;
  } catch (error) {
    rethrowV2Error(error, 'Failed to load patient vital signs');
  }
}

function adaptV2PharmacyQueueItem(item = {}) {
  const remainingDoseCount = Math.max(
    0,
    Number(item.requested_dose_count || 0) - Number(item.dispensed_dose_count || 0),
  );
  const doseCount = remainingDoseCount || Number(item.requested_dose_count || 1) || 1;
  const isOverdue = Number(item.overdue_count || 0) > 0;

  return {
    prn_policy: item.prn_policy || null,
    id: item.id,
    fulfillment_id: item.id,
    mar_entry_id: item.id,
    mar_entry_ids: [item.id],
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_name: item.patient_display_name || 'Unknown Patient',
    patient_display_name: item.patient_display_name || 'Unknown Patient',
    patient_mrn: item.patient_code || '',
    patient_code: item.patient_code || '',
    patient_ward: item.ward_name || 'Current admission',
    admission_case_id: item.admission_case_id,
    prescription_id: item.prescription_id,
    medication_course_id: item.medication_course_id,
    medication_name: item.medication_name || '',
    dosage: item.dose || '',
    dose: item.dose || '',
    route: item.route || '',
    frequency: item.frequency || '',
    status: item.status,
    scheduled_time: item.next_due_at || item.coverage_start,
    coverage_start: item.coverage_start,
    coverage_end: item.coverage_end,
    dose_count: doseCount,
    requested_dose_count: item.requested_dose_count,
    dispensed_dose_count: item.dispensed_dose_count,
    overdue_count: item.overdue_count,
    is_overdue: isOverdue,
    inventory_item_id: item.inventory_item_id,
    inventory_item_name: item.inventory_item_name,
    inventory_item_code: item.inventory_item_code,
    inventory_item_unit: item.inventory_item_unit,
    dispensing_location_id: item.dispensing_location_id,
  };
}

export async function getV2PendingPharmacyQueue({ patientId = null, signal } = {}) {
  try {
    const items = [];
    const cursors = new Set();
    let cursor;
    for (let page = 0; page < 100; page += 1) {
      // Omitting status uses the server's pending + partially-dispensed queue.
      const query = { limit: 50, ...(patientId ? { patient_id: patientId } : {}), ...(cursor ? { cursor } : {}) };
      const response = await v2Request({ method: 'GET', path: '/api/v2/pharmacy/dispensing-queue', query, signal });
      items.push(...(response?.data || []).map(adaptV2PharmacyQueueItem));
      if (!response?.page?.has_next) return items;
      const next = response.page.next_cursor;
      if (!next || cursors.has(next)) throw new Error('The dispensing queue could not be completely loaded. Reload before issuing stock.');
      cursors.add(next);
      cursor = next;
    }
    throw new Error('The dispensing queue is too large to load safely. Narrow the queue before issuing stock.');
  } catch (error) {
    rethrowV2Error(error, 'Failed to load pharmacy dispensing queue');
  }
}
