import { v2Api } from '@/lib/api/v2/client';
import { handleV2ApiError } from '@/lib/api/v2/errors';

export const MAX_MONITORING_PAGE_SIZE = 50;
export const MAX_VITALS_PAGE_SIZE = 50;
const MAX_TASK_PAGE_SIZE = 50;
const MAX_ALERT_PAGE_SIZE = 50;
const MAX_MEDICATION_ADMIN_PAGE_SIZE = 50;
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
    active_alerts: [],
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
    dosage: item.dosage || '',
    route: item.route || '',
    route_display: item.route_display || item.route || '',
    frequency_display: item.frequency_display || '',
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
  const volume = Number.parseInt(data.volume_ml ?? data.amount_ml ?? data.amount ?? 0, 10) || 0;
  const intake = data.intake_ml ?? (data.entry_type === 'intake' ? volume : 0);
  const output = data.output_ml ?? (data.entry_type === 'output' ? volume : 0);
  return {
    admission_case_id: admissionCaseId,
    recorded_at: new Date(data.recorded_at || Date.now()).toISOString(),
    intake_ml: Number.parseInt(intake, 10) || 0,
    output_ml: Number.parseInt(output, 10) || 0,
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
  return {
    witness_user_id: data.witness_user_id || data.witness || null,
  };
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
        duration_days: safeDays,
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
      dose_number: day.doses.length + 1,
      status: normalizeDoseStatus(record),
      scheduled_time: record.scheduled_time,
      administered_time: record.administered_time || record.administered_at || null,
      administered_by: record.administered_by || '',
      notes: record.notes || '',
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
    course_complete: row.total_doses_required > 0 && row.total_doses_administered >= row.total_doses_required,
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

export async function getV2MedicationAdministrations(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getMedicationAdministrations({
      query: { limit: MAX_MEDICATION_ADMIN_PAGE_SIZE },
      signal,
    });
    return adaptMatchingV2Items(
      response?.data,
      adaptV2MedicationAdministration,
      (item) => medicationAdministrationMatchesFilters(item, filters)
    );
  } catch (error) {
    rethrowV2Error(error, 'Failed to load medication administrations');
  }
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

export async function getV2FluidBalanceEntries(patientId, filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getFluidBalanceEntries({
      query: { limit: MAX_FLUID_BALANCE_PAGE_SIZE },
      signal,
    });
    const entries = [];
    for (const item of Array.isArray(response?.data) ? response.data : []) {
      if (fluidBalanceMatchesFilters(item, patientId, filters)) {
        entries.push(...adaptV2FluidBalanceItem(item));
      }
    }
    return entries;
  } catch (error) {
    rethrowV2Error(error, 'Failed to load fluid balance entries');
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
    const response = await v2Api.getNursingTasks({
      query: { limit: MAX_TASK_PAGE_SIZE },
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

export async function getV2PendingPharmacyQueue({ signal } = {}) {
  try {
    await v2Api.getPharmacyDispenses({
      query: { limit: 50 },
      signal,
    });
    // Rust V2 currently exposes completed pharmacy dispenses, not a pending
    // prescription dispensing queue. Do not surface completed dispenses as work.
    return [];
  } catch (error) {
    rethrowV2Error(error, 'Failed to load pharmacy dispensing queue');
  }
}
