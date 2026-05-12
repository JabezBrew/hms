import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { v2Api } from '@/lib/api/v2/client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { keyWith } from '@/shared/lib/queryKeys';

const MAX_MONITORING_PAGE_SIZE = 50;
const MAX_VITALS_PAGE_SIZE = 50;
const MAX_TASK_PAGE_SIZE = 50;
const MAX_ALERT_PAGE_SIZE = 50;
const MAX_MEDICATION_ADMIN_PAGE_SIZE = 50;
const MAX_FLUID_BALANCE_PAGE_SIZE = 50;
const MAX_TREATMENT_SHEET_PAGE_SIZE = 50;
const MAX_WARD_STOCK_REQUEST_PAGE_SIZE = 50;
const MAX_HANDOFF_PAGE_SIZE = 50;
const DEFAULT_FLUID_BALANCE_SETTINGS = {
  min_daily_intake_target: 1500,
  max_daily_output_threshold: 3000,
  negative_balance_alert_threshold: -500,
  positive_balance_alert_threshold: 2000,
  enable_intake_alerts: true,
  enable_output_alerts: true,
  enable_balance_alerts: true,
};

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function rethrowV2Error(error, message) {
  rethrowAbortError(error);
  throw new Error(handleV2ApiError(error, message));
}

function repeatedItems(count, factory) {
  const safeCount = Math.max(0, Number.parseInt(count, 10) || 0);
  return Array.from({ length: safeCount }, (_, index) => factory(index));
}

function adaptV2WardBoardMonitoringItem(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || item.name || 'Unknown Patient';
  const bedNumber = item.bed_code || item.bed_number || '';

  return {
    patient_id: item.patient_id,
    patient_name: patientName,
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

function adaptV2Handoff(item = {}) {
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

function adaptV2NursingAlert(item = {}) {
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
  if (
    taskType === 'ward_round' ||
    taskType === 'observation' ||
    taskType === 'medication' ||
    taskType === 'handoff'
  ) {
    return taskType;
  }
  return 'observation';
}

function adaptV2NursingTask(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || 'Unknown Patient';
  const dueAt = item.due_at || item.scheduled_time || null;
  const taskType = item.task_type || 'observation';
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
    description: item.description || `${taskType.replaceAll('_', ' ')} task`,
    task_type: taskType,
    status: legacyTaskStatus(item.status),
    due_at: dueAt,
    scheduled_time: dueAt,
    priority: item.priority || 'medium',
    assigned_to_name: item.assigned_to_name || '',
  };
}

function adaptV2MedicationAdministration(item = {}) {
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

function adaptV2TreatmentSheet(item = {}) {
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

function adaptV2WardStockRequest(item = {}) {
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

function adaptV2FluidBalanceItem(item = {}) {
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

function adaptV2PatientVitals(item = {}) {
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

function normalizeV2FluidBalancePayload(data = {}) {
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

function normalizeV2TreatmentSheetPayload(data = {}) {
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

function normalizeV2WardStockRequestPayload(data = {}) {
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

function normalizeV2MedicationAdministrationPayload(data = {}) {
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

function normalizeV2MedicationAdministerPayload(data = {}) {
  return {
    witness_user_id: data.witness_user_id || data.witness || null,
  };
}

function normalizeV2TaskPayload(data = {}) {
  const admissionCaseId = data.admission_case_id || data.admission_id || data.admission;
  const dueAt = data.due_at || data.scheduled_time;
  if (!admissionCaseId) {
    throw new Error('Admission case is required to create a Rust V2 nursing task');
  }
  if (!dueAt) {
    throw new Error('Due time is required to create a Rust V2 nursing task');
  }

  const assignedTo = data.assigned_to_user_id || data.assigned_to || null;
  return {
    admission_case_id: admissionCaseId,
    task_type: rustTaskType(data.task_type),
    due_at: new Date(dueAt).toISOString(),
    assigned_to_user_id: assignedTo || null,
  };
}

function normalizeV2HandoffPayload(data = {}) {
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
  if (taskType && taskType !== 'all' && rustTaskType(taskType) !== rustTaskType(task.task_type)) {
    return false;
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

function addDaysToDateKey(dateString, offset) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function normalizeDoseStatus(item) {
  if (item.status === 'scheduled' && item.scheduled_time && Date.parse(item.scheduled_time) <= Date.now()) {
    return 'due';
  }
  return item.status || 'scheduled';
}

function buildPatientMAR(records = [], patientId, date = null) {
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

function buildMARGrid(records = [], admissionId, startDate = null, days = 7) {
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

function isDueMedicationAdministration(item) {
  return item.status === 'scheduled' && item.scheduled_time && Date.parse(item.scheduled_time) <= Date.now();
}

async function getV2MedicationAdministrations(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getMedicationAdministrations({
      query: { limit: MAX_MEDICATION_ADMIN_PAGE_SIZE },
      signal,
    });
    return (Array.isArray(response?.data) ? response.data : [])
      .map(adaptV2MedicationAdministration)
      .filter((item) => medicationAdministrationMatchesFilters(item, filters));
  } catch (error) {
    rethrowV2Error(error, 'Failed to load medication administrations');
  }
}

async function getV2TreatmentSheets(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getTreatmentSheets({
      query: { limit: MAX_TREATMENT_SHEET_PAGE_SIZE },
      signal,
    });
    return (Array.isArray(response?.data) ? response.data : [])
      .map(adaptV2TreatmentSheet)
      .filter((item) => treatmentSheetMatchesFilters(item, filters));
  } catch (error) {
    rethrowV2Error(error, 'Failed to load treatment sheets');
  }
}

async function getV2WardStockRequests(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getWardStockRequests({
      query: { limit: MAX_WARD_STOCK_REQUEST_PAGE_SIZE },
      signal,
    });
    return (Array.isArray(response?.data) ? response.data : [])
      .map(adaptV2WardStockRequest)
      .filter((item) => wardStockRequestMatchesFilters(item, filters));
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

function summarizeFluidBalance(records = []) {
  const totalIntake = records
    .filter((record) => record.entry_type === 'intake')
    .reduce((sum, record) => sum + (Number(record.volume_ml) || 0), 0);
  const totalOutput = records
    .filter((record) => record.entry_type === 'output')
    .reduce((sum, record) => sum + (Number(record.volume_ml) || 0), 0);
  return {
    total_intake: totalIntake,
    total_output: totalOutput,
    balance: totalIntake - totalOutput,
    intake_breakdown: {},
    output_breakdown: {},
  };
}

function fluidBalanceTrendPoints(records = []) {
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

function deriveFluidBalanceAlerts(summary, settings = DEFAULT_FLUID_BALANCE_SETTINGS) {
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

async function getV2FluidBalanceEntries(patientId, filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getFluidBalanceEntries({
      query: { limit: MAX_FLUID_BALANCE_PAGE_SIZE },
      signal,
    });
    return (Array.isArray(response?.data) ? response.data : [])
      .filter((item) => fluidBalanceMatchesFilters(item, patientId, filters))
      .flatMap(adaptV2FluidBalanceItem);
  } catch (error) {
    rethrowV2Error(error, 'Failed to load fluid balance entries');
  }
}

async function getV2NursingAlerts(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getNursingAlerts({
      query: { limit: MAX_ALERT_PAGE_SIZE },
      signal,
    });
    return (Array.isArray(response?.data) ? response.data : [])
      .map(adaptV2NursingAlert)
      .filter((alert) => alertMatchesFilters(alert, filters));
  } catch (error) {
    rethrowV2Error(error, 'Failed to load nursing alerts');
  }
}

async function getV2NursingTasks(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getNursingTasks({
      query: { limit: MAX_TASK_PAGE_SIZE },
      signal,
    });
    return (Array.isArray(response?.data) ? response.data : [])
      .map(adaptV2NursingTask)
      .filter((task) => taskMatchesFilters(task, filters));
  } catch (error) {
    rethrowV2Error(error, 'Failed to load nursing tasks');
  }
}

async function getV2Handoffs(filters = {}, { signal } = {}) {
  try {
    const response = await v2Api.getHandoffs({
      query: { limit: MAX_HANDOFF_PAGE_SIZE },
      signal,
    });
    return (Array.isArray(response?.data) ? response.data : [])
      .map(adaptV2Handoff)
      .filter((handoff) => handoffMatchesFilters(handoff, filters));
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

function normalizeV2CreateVitalsPayload(data = {}) {
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

async function getV2PatientVitals(filters = {}, { signal } = {}) {
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

async function getV2PendingPharmacyQueue({ signal } = {}) {
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

export const nursingKeys = {
  patientMonitoring: (wardId, page, pageSize) => keyWith('patient-monitoring', wardId, page, pageSize),
  patientMonitoringAll: () => keyWith('patient-monitoring'),
  patientDetail: (patientId) => keyWith('patient-detail', patientId),
  vitalSigns: (patient, admission, encounter, date, startDate, endDate) =>
    keyWith('vital-signs', patient, admission, encounter, date, startDate, endDate),
  vitalSignsWindow: (patientId, window) => keyWith('vital-signs', patientId, window),
  vitalSignsAll: () => keyWith('vital-signs'),
  vitalSignsTrends: (patientId, days, encounterId, admissionId, startDate, endDate) =>
    keyWith('vital-signs-trends', patientId, days, encounterId, admissionId, startDate, endDate),
  vitalSignsTrendsByPatient: (patientId) => keyWith('vital-signs-trends', patientId),
  nursingTasks: (patient, status, ward, date, taskType, priority) =>
    keyWith('nursing-tasks', patient, status, ward, date, taskType, priority),
  nursingTasksAll: () => keyWith('nursing-tasks'),
  nursingTasksToday: () => keyWith('nursing-tasks-today'),
  nursingAlerts: (patient, ward, severity, status) => keyWith('nursing-alerts', patient, ward, severity, status),
  nursingAlertsAll: () => keyWith('nursing-alerts'),
  nursingAlertsActive: () => keyWith('nursing-alerts-active'),
  medicationAdministrations: (patient, admission, date, status) =>
    keyWith('medication-administrations', patient, admission, date, status),
  medicationAdministrationsAll: () => keyWith('medication-administrations'),
  medicationsDueNow: () => keyWith('medications-due-now'),
  medicationsOverdue: () => keyWith('medications-overdue'),
  medicationAdministrationHistory: (patient, status, startDate, endDate, ordering, page, pageSize) =>
    keyWith('medication-administration-history', patient, status, startDate, endDate, ordering, page, pageSize),
  patientMar: (patientId, date) => keyWith('patient-mar', patientId, date),
  patientMarAll: () => keyWith('patient-mar'),
  marGrid: (admissionId, startDate, days) => keyWith('mar-grid', admissionId, startDate, days),
  marGridAll: () => keyWith('mar-grid'),
  pendingDispensing: (patientId) => keyWith('pending-dispensing', patientId),
  pendingDispensingAll: () => keyWith('pending-dispensing'),
  pendingDispensingGrouped: (patientId) => keyWith('pending-dispensing', 'grouped', patientId),
  readyForAdmin: (patientId) => keyWith('ready-for-admin', patientId),
  readyForAdminAll: () => keyWith('ready-for-admin'),
  shiftHandoffs: (ward, date, shift) => keyWith('shift-handoffs', ward, date, shift),
  shiftHandoffsAll: () => keyWith('shift-handoffs'),
  shiftHandoffsToday: () => keyWith('shift-handoffs-today'),
  treatmentSheet: (admissionId) => keyWith('treatment-sheet', admissionId),
  treatmentSheetAll: () => keyWith('treatment-sheet'),
  treatmentSheetEntry: (entryId) => keyWith('treatment-sheet-entry', entryId),
  treatmentSheetLowSupply: () => keyWith('treatment-sheet-low-supply'),
  supplyStatus: (entryId) => keyWith('supply-status', entryId),
  supplyRequests: (status) => keyWith('supply-requests', status),
  supplyRequestsAll: () => keyWith('supply-requests'),
  supplyRequest: (requestId) => keyWith('supply-request', requestId),
  fluidBalance: (patientId, admissionId, entryType, date, startDate, endDate) =>
    keyWith('fluid-balance', patientId, admissionId, entryType, date, startDate, endDate),
  fluidBalanceAll: () => keyWith('fluid-balance'),
  fluidBalanceTrends: (patientId, admissionId, startDate, endDate) =>
    keyWith('fluid-balance-trends', patientId, admissionId, startDate, endDate),
  fluidBalanceSummary: (patientId, date) => keyWith('fluid-balance-summary', patientId, date),
  fluidBalanceSummaryAll: () => keyWith('fluid-balance-summary'),
  fluidBalanceToday: (patientId) => keyWith('fluid-balance-today', patientId),
  fluidBalanceTodayAll: () => keyWith('fluid-balance-today'),
  fluidBalanceSettings: () => keyWith('fluid-balance-settings'),
  fluidBalanceAlerts: (patientId, date) => keyWith('fluid-balance-alerts', patientId, date),
};

// ========== Patient Monitoring ==========

export const usePatientMonitoring = (wardId = null, page = 1, pageSize = 20) => {
  const normalizedPageSize = Math.max(1, Math.min(pageSize, MAX_MONITORING_PAGE_SIZE));

  return useQuery({
    queryKey: nursingKeys.patientMonitoring(wardId, page, normalizedPageSize),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.getWardBoard({
            query: {
              limit: normalizedPageSize,
              ...(wardId ? { ward_id: wardId } : {}),
            },
            signal,
          });
          const results = Array.isArray(response?.data)
            ? response.data.map(adaptV2WardBoardMonitoringItem)
            : [];
          const hasNext = Boolean(response?.page?.has_next);
          return {
            count: results.length + (hasNext ? 1 : 0),
            page,
            page_size: normalizedPageSize,
            total_pages: hasNext ? page + 1 : Math.max(1, page),
            results,
          };
        } catch (error) {
          rethrowV2Error(error, 'Failed to load patient monitoring data');
        }
      }

      const params = new URLSearchParams();
      if (wardId) params.append('ward', wardId);
      params.append('page', page.toString());
      params.append('page_size', normalizedPageSize.toString());

      // Use getWithPagination to get the full paginated response, not just results
      const data = await apiClient.getWithPagination(`/nursing/monitoring/dashboard/?${params.toString()}`);

      // Handle both array and paginated object responses
      if (!data) {
        return {
          count: 0,
          page: 1,
          page_size: normalizedPageSize,
          total_pages: 0,
          results: []
        };
      }

      // If backend returns array directly (not paginated), wrap it
      if (Array.isArray(data)) {
        return {
          count: data.length,
          page: page,
          page_size: normalizedPageSize,
          total_pages: Math.ceil(data.length / normalizedPageSize),
          results: data
        };
      }

      // If backend returns paginated object, use it directly
      return data;
    },
    // Provide placeholder data while loading to prevent undefined
    placeholderData: {
      count: 0,
      page: 1,
      page_size: normalizedPageSize,
      total_pages: 0,
      results: []
    },
    refetchInterval: () => {
      // Only refetch if window is focused
      if (!document.hidden) {
        return 60000; // 1 minute when focused
      }
      return false; // Don't refetch when tab is not visible
    },
    refetchOnWindowFocus: true, // Refetch when user comes back to tab
    refetchIntervalInBackground: false, // Don't refetch in background
    staleTime: 30000, // Consider data stale after 30 seconds
    retry: 1, // Retry once on failure
  });
};

export const usePatientDetail = (patientId) => {
  return useQuery({
    queryKey: nursingKeys.patientDetail(patientId),
    queryFn: async () => {
      const response = await apiClient.get(`/nursing/monitoring/patient_detail/?patient=${patientId}`);
      // Ensure we always return an object
      const data = response?.data ?? response;
      return data || {};
    },
    enabled: !!patientId,
    placeholderData: {},
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: 30000,
  });
};

// ========== Vital Signs ==========

export const useVitalSigns = (filters = {}, options = {}) => {
  const { enabled = true } = options;
  // Extract filter values to use as stable primitives in query key
  const {
    patient,
    admission,
    encounter,
    encounter_id,
    date,
    start_date,
    end_date,
    hours,
    ordering,
    limit,
  } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.vitalSigns(
      patient,
      admission,
      encounter_id || encounter,
      date,
      start_date,
      end_date,
      hours,
      ordering,
      limit,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2PatientVitals(filters, { signal });
      }
      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/vital-signs/?${params.toString()}`, { signal });
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? [];
    },
    enabled,
    placeholderData: [],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useVitalSignsTrends = (patientId, filters = {}, options = {}) => {
  const { enabled = true } = options;
  const {
    days,
    encounter_id,
    admission_id,
    start_date,
    end_date,
  } = filters;

  return useQuery({
    queryKey: nursingKeys.vitalSignsTrends(
      patientId,
      days,
      encounter_id,
      admission_id,
      start_date,
      end_date,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const daysAsHours = Math.max(1, Number.parseInt(days, 10) || 7) * 24;
        return getV2PatientVitals({
          patient: patientId,
          admission_case_id: admission_id,
          hours: daysAsHours,
          ordering: '-recorded_at',
          limit: MAX_VITALS_PAGE_SIZE,
        }, { signal });
      }
      const params = new URLSearchParams();
      params.append('patient', patientId);
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value);
        }
      });
      const response = await apiClient.get(`/nursing/vital-signs/patient_trends/?${params.toString()}`, { signal });
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? [];
    },
    enabled: !!patientId && enabled,
    placeholderData: [],
  });
};

export const useCreateVitalSigns = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postPatientVitals(normalizeV2CreateVitalsPayload(data));
          return adaptV2PatientVitals(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to record vital signs');
        }
      }
      // apiClient.post returns data directly, not wrapped in response.data
      const result = await apiClient.post('/nursing/vital-signs/', data);
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.vitalSignsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.vitalSignsTrendsByPatient(data?.patient) });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientDetail(data?.patient) });
    },
  });
};

// ========== Nursing Tasks ==========

export const useNursingTasks = (filters = {}) => {
  // Extract filter values to use as stable primitives in query key
  const { patient, status, ward, date, task_type, priority } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.nursingTasks(patient, status, ward, date, task_type, priority),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2NursingTasks(filters, { signal });
      }

      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/tasks/?${params.toString()}`);
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useTodayTasks = () => {
  return useQuery({
    queryKey: nursingKeys.nursingTasksToday(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2NursingTasks({ date: new Date().toISOString().slice(0, 10) }, { signal });
      }

      const response = await apiClient.get('/nursing/tasks/today/');
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    refetchInterval: 60000, // Refetch every minute
  });
};

export const useCreateNursingTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postNursingTasks(normalizeV2TaskPayload(data));
          return adaptV2NursingTask(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to create nursing task');
        }
      }

      const response = await apiClient.post('/nursing/tasks/', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksToday() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

export const useCompleteTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, data }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postNursingTaskComplete({ id: taskId });
          return adaptV2NursingTask(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to complete nursing task');
        }
      }

      const response = await apiClient.post(`/nursing/tasks/${taskId}/complete/`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksToday() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

export const useUpdateTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, data }) => {
      if (isRustV2ApiMode()) {
        if (data?.status === 'completed' || data?.complete === true) {
          try {
            const response = await v2Api.postNursingTaskComplete({ id: taskId });
            return adaptV2NursingTask(response?.data);
          } catch (error) {
            rethrowV2Error(error, 'Failed to complete nursing task');
          }
        }
        throw new Error('Rust V2 does not expose general nursing task edits yet.');
      }

      const response = await apiClient.patch(`/nursing/tasks/${taskId}/`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksToday() });
    },
  });
};

// ========== Nursing Alerts ==========

export const useNursingAlerts = (filters = {}) => {
  // Extract filter values to use as stable primitives in query key
  const { patient, ward, severity, status } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.nursingAlerts(patient, ward, severity, status),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2NursingAlerts(filters, { signal });
      }

      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/alerts/?${params.toString()}`);
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    refetchInterval: false, // Disable automatic polling - manually refresh when needed
    refetchOnWindowFocus: false,
    staleTime: 20000,
  });
};

export const useActiveAlerts = () => {
  return useQuery({
    queryKey: nursingKeys.nursingAlertsActive(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const alerts = await getV2NursingAlerts({}, { signal });
        return alerts.filter((alert) => !alert.acknowledged && alert.status !== 'resolved');
      }

      // Use getWithPagination to avoid auto-extraction of results
      const data = await apiClient.getWithPagination('/nursing/alerts/active/');

      // Ensure we always return an array
      if (!data) {
        return [];
      }

      // Handle both array and object responses
      return Array.isArray(data) ? data : [];
    },
    // Provide placeholder data while loading to prevent undefined
    placeholderData: [],
    refetchInterval: () => !document.hidden ? 45000 : false, // 45 seconds when focused
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: 20000,
    retry: 1,
  });
};

export const useAcknowledgeAlert = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ alertId, notes }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postNursingAlertAcknowledge({ id: alertId });
          return adaptV2NursingAlert(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to acknowledge nursing alert');
        }
      }

      const response = await apiClient.post(`/nursing/alerts/${alertId}/acknowledge/`, {
        resolution_notes: notes,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingAlertsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingAlertsActive() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

// ========== Medication Administration ==========

export const useMedicationAdministrations = (filters = {}) => {
  // Extract filter values to use as stable primitives in query key
  const { patient, admission, date, status } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.medicationAdministrations(patient, admission, date, status),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2MedicationAdministrations(filters, { signal });
      }

      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/medications/?${params.toString()}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useMedicationAdministrationHistory = (filters = {}, options = {}) => {
  const {
    patient,
    status,
    start_date,
    end_date,
    ordering = '-scheduled_time',
    page = 1,
    page_size = 20,
  } = filters;
  const { enabled = true } = options;

  return useQuery({
    queryKey: nursingKeys.medicationAdministrationHistory(
      patient,
      status,
      start_date,
      end_date,
      ordering,
      page,
      page_size,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const results = await getV2MedicationAdministrations({
          patient,
          status,
          start_date,
          end_date,
        }, { signal });
        return {
          count: results.length,
          results,
          page,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        };
      }

      const params = new URLSearchParams();
      if (patient) params.append('patient', patient);
      if (status && status !== 'all') params.append('status', status);
      if (start_date) params.append('start_date', start_date);
      if (end_date) params.append('end_date', end_date);
      if (ordering) params.append('ordering', ordering);
      params.append('page', String(page));
      params.append('page_size', String(page_size));

      const response = await apiClient.getWithPagination(`/nursing/medications/?${params.toString()}`);

      if (Array.isArray(response)) {
        return {
          count: response.length,
          results: response,
          page,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        };
      }

      return response ?? {
        count: 0,
        results: [],
        page,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      };
    },
    enabled: !!patient && enabled,
    placeholderData: {
      count: 0,
      results: [],
      page,
      total_pages: 1,
      has_next: false,
      has_previous: false,
    },
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useMedicationsDueNow = () => {
  return useQuery({
    queryKey: nursingKeys.medicationsDueNow(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const rows = await getV2MedicationAdministrations({ status: 'scheduled' }, { signal });
        return rows.filter(isDueMedicationAdministration);
      }

      const response = await apiClient.get('/nursing/medications/due_now/');
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    refetchInterval: 60000, // Refetch every minute
  });
};

export const useOverdueMedications = () => {
  return useQuery({
    queryKey: nursingKeys.medicationsOverdue(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const rows = await getV2MedicationAdministrations({ status: 'scheduled' }, { signal });
        return rows.filter(isDueMedicationAdministration);
      }

      const response = await apiClient.get('/nursing/medications/overdue/');
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    refetchInterval: 60000, // Refetch every minute
  });
};

export const useCreateMedicationAdministration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postMedicationAdministrations(
            normalizeV2MedicationAdministrationPayload(data),
          );
          return adaptV2MedicationAdministration(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to schedule medication administration');
        }
      }

      const response = await apiClient.post('/nursing/medications/', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsDueNow() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

export const useAdministerMedication = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ medicationId, data }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postMedicationAdministrationAdminister(
            { id: medicationId },
            normalizeV2MedicationAdministerPayload(data),
          );
          return adaptV2MedicationAdministration(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to administer medication');
        }
      }

      const response = await apiClient.post(`/nursing/medications/${medicationId}/administer/`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsDueNow() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsOverdue() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.marGridAll() });
    },
  });
};

export const useCreateAndAdminister = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const created = await v2Api.postMedicationAdministrations(
            normalizeV2MedicationAdministrationPayload(data),
          );
          const createdAdministration = adaptV2MedicationAdministration(created?.data);
          const administered = await v2Api.postMedicationAdministrationAdminister(
            { id: createdAdministration.id },
            normalizeV2MedicationAdministerPayload(data),
          );
          return adaptV2MedicationAdministration(administered?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to create and administer medication');
        }
      }

      // data: { patient_id, prescription_id, scheduled_time, notes? }
      const response = await apiClient.post('/nursing/medications/create-and-administer/', data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsDueNow() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsOverdue() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.marGridAll() });
    },
  });
};

// ========== Patient MAR (Medication Administration Record) ==========

export const usePatientMAR = (patientId, date = null) => {
  return useQuery({
    queryKey: nursingKeys.patientMar(patientId, date),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const records = await getV2MedicationAdministrations({ patient: patientId, date }, { signal });
        return buildPatientMAR(records, patientId, date);
      }

      const params = new URLSearchParams();
      params.append('patient', patientId);
      if (date) params.append('date', date);
      const response = await apiClient.getWithPagination(`/nursing/medications/patient_mar/?${params.toString()}`);
      return response;
    },
    enabled: !!patientId,
    refetchInterval: 60000,
    staleTime: 30000,
  });
};

export const useGenerateMAR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ prescriptionId, days = 7, startDate = null }) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose MAR generation yet.');
      }

      const data = { days };
      if (startDate) data.start_date = startDate;
      const response = await apiClient.post(`/clinical-notes/prescriptions/${prescriptionId}/generate_mar/`, data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMarAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsDueNow() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

// ========== Pharmacy Dispensing ==========
// These endpoints use the pharmacy module at /api/pharmacy/dispensing/

export const usePendingDispensing = (patientId = null) => {
  return useQuery({
    queryKey: nursingKeys.pendingDispensing(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2PendingPharmacyQueue({ signal });
      }
      const params = patientId ? `?patient=${patientId}` : '';
      const response = await apiClient.get(`/pharmacy/dispensing/pending/${params}`);
      return response;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const usePendingDispensingGrouped = (patientId = null) => {
  return useQuery({
    queryKey: nursingKeys.pendingDispensingGrouped(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2PendingPharmacyQueue({ signal });
      }
      const params = patientId ? `?patient=${patientId}` : '';
      const response = await apiClient.get(`/pharmacy/dispensing/pending-grouped/${params}`);
      return response;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useReadyForAdmin = (patientId = null) => {
  return useQuery({
    queryKey: nursingKeys.readyForAdmin(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2PendingPharmacyQueue({ signal });
      }
      const params = patientId ? `?patient=${patientId}` : '';
      const response = await apiClient.get(`/pharmacy/dispensing/ready-for-admin/${params}`);
      return response;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useDispenseMedication = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (medicationId) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose pharmacy dispense actions from the nursing queue yet.');
      }

      const response = await apiClient.post(`/pharmacy/dispensing/${medicationId}/dispense/`, {});
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.pendingDispensingAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.readyForAdminAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMarAll() });
    },
  });
};

export const useBulkDispense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (medicationIds) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose pharmacy bulk dispense actions from the nursing queue yet.');
      }

      const response = await apiClient.post('/pharmacy/dispensing/bulk-dispense/', {
        medication_ids: medicationIds,
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.pendingDispensingAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.readyForAdminAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMarAll() });
    },
  });
};

// ========== Shift Handoffs ==========

export const useShiftHandoffs = (filters = {}) => {
  // Extract filter values to use as stable primitives in query key
  const { ward, date, shift } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.shiftHandoffs(ward, date, shift),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2Handoffs(filters, { signal });
      }

      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/handoffs/?${params.toString()}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useTodayHandoffs = () => {
  return useQuery({
    queryKey: nursingKeys.shiftHandoffsToday(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2Handoffs({ date: new Date().toISOString().slice(0, 10) }, { signal });
      }

      const response = await apiClient.get('/nursing/handoffs/today/');
      // apiClient.get returns data directly or response.data depending on implementation
      // Ensure we always return an array (not undefined)
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
  });
};

export const useCreateShiftHandoff = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postHandoffs(normalizeV2HandoffPayload(data));
          return adaptV2Handoff(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to create shift handoff');
        }
      }

      const response = await apiClient.post('/nursing/handoffs/', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsToday() });
    },
  });
};

export const useUpdateShiftHandoff = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ handoffId, data }) => {
      if (isRustV2ApiMode()) {
        if (data?.status === 'completed' || data?.complete === true) {
          try {
            const response = await v2Api.postHandoffComplete({ id: handoffId });
            return adaptV2Handoff(response?.data);
          } catch (error) {
            rethrowV2Error(error, 'Failed to complete shift handoff');
          }
        }
        throw new Error('Rust V2 does not expose general shift handoff edits yet.');
      }

      const response = await apiClient.patch(`/nursing/handoffs/${handoffId}/`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsToday() });
    },
  });
};

// ========== MAR Grid ==========

export const useMARGrid = (admissionId, startDate = null, days = 7) => {
  return useQuery({
    queryKey: nursingKeys.marGrid(admissionId, startDate, days),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const firstDate = startDate || new Date().toISOString().slice(0, 10);
        const lastDate = addDaysToDateKey(firstDate, Math.max(1, Number.parseInt(days, 10) || 7) - 1);
        const records = await getV2MedicationAdministrations({
          admission: admissionId,
          start_date: firstDate,
          end_date: lastDate,
        }, { signal });
        return buildMARGrid(records, admissionId, firstDate, days);
      }

      const params = new URLSearchParams();
      params.append('admission_id', admissionId);
      if (startDate) params.append('start_date', startDate);
      params.append('days', days.toString());

      const response = await apiClient.get(`/nursing/medications/mar-grid/?${params.toString()}`);
      return response || { medications: [], date_headers: [], time_slots: [] };
    },
    enabled: !!admissionId,
    refetchInterval: () => !document.hidden ? 60000 : false, // 1 minute
    refetchOnWindowFocus: true,
    staleTime: 30000, // 30 seconds
  });
};

// ========== Treatment Sheet ==========

export const useTreatmentSheetByAdmission = (admissionId) => {
  return useQuery({
    queryKey: nursingKeys.treatmentSheet(admissionId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2TreatmentSheets({ admission: admissionId }, { signal });
      }

      const response = await apiClient.get(`/nursing/treatment-sheet/by-admission/?admission_id=${admissionId}`);
      // Ensure we always return an array
      return response.data || response || [];
    },
    enabled: !!admissionId,
    refetchInterval: () => !document.hidden ? 120000 : false, // 2 minutes
    refetchOnWindowFocus: true,
    staleTime: 60000, // 1 minute
  });
};

export const useTreatmentSheetEntry = (entryId) => {
  return useQuery({
    queryKey: nursingKeys.treatmentSheetEntry(entryId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const entries = await getV2TreatmentSheets({ id: entryId }, { signal });
        return entries[0] || {};
      }

      const response = await apiClient.get(`/nursing/treatment-sheet/${entryId}/`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? {};
    },
    enabled: !!entryId,
    placeholderData: {},
  });
};

export const useLowSupplyEntries = () => {
  return useQuery({
    queryKey: nursingKeys.treatmentSheetLowSupply(),
    queryFn: async () => {
      if (isRustV2ApiMode()) {
        return [];
      }

      const response = await apiClient.get('/nursing/treatment-sheet/low-supply/');
      return response.data || response || [];
    },
    refetchInterval: () => !document.hidden ? 120000 : false, // 2 minutes
    refetchOnWindowFocus: true,
  });
};

export const useSupplyStatus = (entryId) => {
  return useQuery({
    queryKey: nursingKeys.supplyStatus(entryId),
    queryFn: async () => {
      if (isRustV2ApiMode()) {
        return {
          supported: false,
          status: 'unsupported',
          available: false,
        };
      }

      const response = await apiClient.get(`/nursing/treatment-sheet/${entryId}/supply-status/`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? {};
    },
    enabled: !!entryId,
    placeholderData: {},
  });
};

export const useCreateTreatmentEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postTreatmentSheets(normalizeV2TreatmentSheetPayload(data));
          return adaptV2TreatmentSheet(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to create treatment sheet');
        }
      }

      const response = await apiClient.post('/nursing/treatment-sheet/', data);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheet(data.admission) });
    },
  });
};

export const useDiscontinueTreatmentEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entryId, reason }) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose treatment-sheet discontinuation yet.');
      }

      const response = await apiClient.post(`/nursing/treatment-sheet/${entryId}/discontinue/`, { reason });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetEntry(data.id) });
    },
  });
};

export const useRequestSupply = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables) => {
      const { entryId, quantity, notes } = variables;
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postWardStockRequests(
            normalizeV2WardStockRequestPayload(variables),
          );
          return adaptV2WardStockRequest(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to request ward stock');
        }
      }

      const response = await apiClient.post(`/nursing/treatment-sheet/${entryId}/request-supply/`, {
        quantity,
        notes
      });
      return response.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetEntry(variables.entryId) });
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequestsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyStatus(variables.entryId) });
    },
  });
};

// ========== Supply Requests ==========

export const usePendingSupplyRequests = () => {
  return useQuery({
    queryKey: nursingKeys.supplyRequests('pending'),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2WardStockRequests({ status: 'pending' }, { signal });
      }

      const response = await apiClient.get('/nursing/supply-requests/pending-queue/');
      return response.data || response || [];
    },
    refetchInterval: () => !document.hidden ? 60000 : false, // 1 minute for pharmacy
    refetchOnWindowFocus: true,
  });
};

export const useSupplyRequest = (requestId) => {
  return useQuery({
    queryKey: nursingKeys.supplyRequest(requestId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const requests = await getV2WardStockRequests({ id: requestId }, { signal });
        return requests[0] || {};
      }

      const response = await apiClient.get(`/nursing/supply-requests/${requestId}/`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? {};
    },
    enabled: !!requestId,
    placeholderData: {},
  });
};

export const useDispenseSupply = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ requestId, quantityDispensed }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postWardStockRequestFulfill({ id: requestId });
          return adaptV2WardStockRequest(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to fulfill ward stock request');
        }
      }

      const response = await apiClient.post(`/nursing/supply-requests/${requestId}/dispense/`, {
        quantity_dispensed: quantityDispensed
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequestsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequest(data.id) });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetLowSupply() });
    },
  });
};

export const useRejectSupplyRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ requestId, reason }) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose ward stock request rejection yet.');
      }

      const response = await apiClient.post(`/nursing/supply-requests/${requestId}/reject/`, { reason });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequestsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequest(data.id) });
    },
  });
};

export const useBulkDispenseSupply = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestIds) => {
      if (isRustV2ApiMode()) {
        try {
          const results = [];
          for (const requestId of requestIds) {
            const response = await v2Api.postWardStockRequestFulfill({ id: requestId });
            results.push(adaptV2WardStockRequest(response?.data));
          }
          return {
            dispensed_count: results.length,
            results,
          };
        } catch (error) {
          rethrowV2Error(error, 'Failed to fulfill ward stock requests');
        }
      }

      const response = await apiClient.post('/nursing/supply-requests/bulk-dispense/', {
        request_ids: requestIds
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequestsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetLowSupply() });
    },
  });
};

// ========== Fluid Balance ==========

/**
 * Get fluid balance entries for a patient
 * @param {string} patientId - Patient ID
 * @param {Object} filters - Optional filters (entry_type, date, start_date, end_date)
 * @param {Object} options - Query options including enabled
 */
export const useFluidBalance = (patientId, filters = {}, options = {}) => {
  const { enabled = true } = options;
  // Extract filter values to use as stable primitives in query key
  const { admission, admission_id, entry_type, date, start_date, end_date } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls from object reference changes
    queryKey: nursingKeys.fluidBalance(
      patientId,
      admission_id || admission,
      entry_type,
      date,
      start_date,
      end_date,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2FluidBalanceEntries(patientId, filters, { signal });
      }

      const params = new URLSearchParams();
      if (patientId) params.append('patient', patientId);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
      const response = await apiClient.get(`/nursing/fluid-balance/?${params.toString()}`, { signal });
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      // Handle paginated response (results array) or direct array
      return data?.results ?? data ?? [];
    },
    enabled: !!patientId && enabled,
    refetchInterval: false, // Disable polling - manually refresh when needed
    refetchOnWindowFocus: false,
    staleTime: 30000,
    placeholderData: [],
  });
};

/**
 * Get fluid balance summary/totals for a patient on a specific date
 * @param {string} patientId - Patient ID
 * @param {string} date - Optional date (YYYY-MM-DD format, defaults to today)
 * @param {Object} options - Query options including enabled
 */
export const useFluidBalanceSummary = (patientId, date = null, options = {}) => {
  const { enabled = true } = options;
  return useQuery({
    queryKey: nursingKeys.fluidBalanceSummary(patientId, date),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const records = await getV2FluidBalanceEntries(patientId, { date }, { signal });
        return summarizeFluidBalance(records);
      }

      const params = new URLSearchParams();
      params.append('patient', patientId);
      if (date) params.append('date', date);
      const response = await apiClient.get(`/nursing/fluid-balance/patient_summary/?${params.toString()}`, { signal });
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? { total_intake: 0, total_output: 0, balance: 0 };
    },
    enabled: !!patientId && enabled,
    refetchInterval: false, // Disable polling - manually refresh when needed
    refetchOnWindowFocus: false,
    staleTime: 30000,
    placeholderData: {
      total_intake: 0,
      total_output: 0,
      balance: 0,
      intake_breakdown: {},
      output_breakdown: {},
    },
  });
};

/**
 * Get today's fluid balance for a patient
 * @param {string} patientId - Patient ID
 * @param {Object} options - Query options including enabled
 */
export const useTodayFluidBalance = (patientId, options = {}) => {
  const { enabled = true } = options;
  return useQuery({
    queryKey: nursingKeys.fluidBalanceToday(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const today = new Date().toISOString().slice(0, 10);
        const records = await getV2FluidBalanceEntries(patientId, { date: today }, { signal });
        return summarizeFluidBalance(records);
      }

      const response = await apiClient.get(`/nursing/fluid-balance/today_balance/?patient=${patientId}`, { signal });
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? { total_intake: 0, total_output: 0, balance: 0 };
    },
    enabled: !!patientId && enabled,
    refetchInterval: false, // Disable polling - manually refresh when needed
    refetchOnWindowFocus: false,
    staleTime: 30000,
    placeholderData: {
      total_intake: 0,
      total_output: 0,
      balance: 0,
    },
  });
};

/**
 * Get aggregated fluid-balance trend points for a patient.
 * @param {string} patientId - Patient ID
 * @param {Object} filters - Optional filters (admission_id, start_date, end_date)
 * @param {Object} options - Query options including enabled
 */
export const useFluidBalanceTrends = (patientId, filters = {}, options = {}) => {
  const { enabled = true } = options;
  const { admission, admission_id, start_date, end_date } = filters;

  return useQuery({
    queryKey: nursingKeys.fluidBalanceTrends(
      patientId,
      admission_id || admission,
      start_date,
      end_date,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const records = await getV2FluidBalanceEntries(patientId, {
          admission: admission_id || admission,
          start_date,
          end_date,
        }, { signal });
        return fluidBalanceTrendPoints(records);
      }

      const params = new URLSearchParams();
      params.append('patient', patientId);
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value);
        }
      });
      const response = await apiClient.get(`/nursing/fluid-balance/trends/?${params.toString()}`, { signal });
      const data = response?.data ?? response;
      return data ?? [];
    },
    enabled: !!patientId && enabled,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: 30000,
    placeholderData: [],
  });
};

/**
 * Create a new fluid balance entry
 */
export const useCreateFluidBalance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postFluidBalanceEntries(normalizeV2FluidBalancePayload(data));
          return adaptV2FluidBalanceItem(response?.data)[0];
        } catch (error) {
          rethrowV2Error(error, 'Failed to record fluid balance');
        }
      }

      const response = await apiClient.post('/nursing/fluid-balance/', data);
      // apiClient.post returns data directly, not response.data
      return response?.data ?? response;
    },
    onSuccess: (data) => {
      // Invalidate all fluid balance queries for this patient
      if (data?.patient) {
        queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceAll() });
        queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceSummaryAll() });
        queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceTodayAll() });
      }
      // Also invalidate general fluid balance queries
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceAll() });
    },
  });
};

/**
 * Delete a fluid balance entry
 */
export const useDeleteFluidBalance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (entryId) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose fluid balance deletion yet.');
      }

      await apiClient.delete(`/nursing/fluid-balance/${entryId}/`);
      return entryId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceSummaryAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceTodayAll() });
    },
  });
};

/**
 * Get fluid balance alert settings (facility-level thresholds)
 */
export const useFluidBalanceSettings = () => {
  return useQuery({
    queryKey: nursingKeys.fluidBalanceSettings(),
    queryFn: async () => {
      if (isRustV2ApiMode()) {
        return DEFAULT_FLUID_BALANCE_SETTINGS;
      }

      const response = await apiClient.get('/settings/fluid-balance/');
      const data = response?.data ?? response;
      return data ?? DEFAULT_FLUID_BALANCE_SETTINGS;
    },
    staleTime: 300000, // 5 minutes - settings don't change often
    refetchOnWindowFocus: false,
  });
};

/**
 * Check fluid balance alerts for a patient
 * @param {string} patientId - Patient ID
 * @param {string} date - Optional date (YYYY-MM-DD format, defaults to today)
 */
export const useFluidBalanceAlerts = (patientId, date = null) => {
  return useQuery({
    queryKey: nursingKeys.fluidBalanceAlerts(patientId, date),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const records = await getV2FluidBalanceEntries(patientId, { date }, { signal });
        const summary = summarizeFluidBalance(records);
        return {
          alerts: deriveFluidBalanceAlerts(summary),
          thresholds: DEFAULT_FLUID_BALANCE_SETTINGS,
          summary,
        };
      }

      const params = new URLSearchParams();
      params.append('patient', patientId);
      if (date) params.append('date', date);
      const response = await apiClient.get(`/nursing/fluid-balance/check_alerts/?${params.toString()}`);
      const data = response?.data ?? response;
      return data ?? { alerts: [], thresholds: {}, summary: {} };
    },
    enabled: !!patientId,
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
    staleTime: 30000,
  });
};
