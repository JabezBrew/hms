export const BOARD_VIEWS = [
  { value: 'by-patient', label: 'By Patient' },
  { value: 'by-urgency', label: 'By Urgency' },
  { value: 'results', label: 'Results' },
  { value: 'discharge', label: 'Discharge' },
  { value: 'my-work', label: 'My Work' },
];

export const DEFAULT_BOARD_VIEW = BOARD_VIEWS[0].value;
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 30, 50];

export const URGENCY_STYLES = {
  critical: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  high: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  urgent: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  moderate: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  stable: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  normal: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  info: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
};

export const TASK_STATUS_STYLES = {
  overdue: URGENCY_STYLES.critical,
  blocked: URGENCY_STYLES.critical,
  escalated: URGENCY_STYLES.critical,
  active: URGENCY_STYLES.moderate,
  pending: URGENCY_STYLES.moderate,
  acknowledged: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
  completed: URGENCY_STYLES.stable,
  cancelled: 'border-border bg-muted text-muted-foreground',
};

export function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.results)) {
    return value.results;
  }
  return [];
}

function asCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function compactParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

export function getBoardPatients(boardData) {
  return asArray(boardData?.results ?? boardData?.patients);
}

export function getBoardSummary(boardData, patients) {
  const summary = boardData?.summary || boardData?.metrics || boardData?.counts || {};
  const visiblePatients = patients.length;

  let openTasks = 0;
  let critical = 0;
  let pendingResults = 0;
  let dischargeReady = 0;

  patients.forEach((patient) => {
    openTasks += getPatientTaskCount(patient);
    if (['critical', 'urgent', 'high'].includes(getPatientUrgency(patient))) {
      critical += 1;
    }
    pendingResults += getPatientResultCount(patient);
    if (getPatientDischargeCount(patient) > 0 || patient?.discharge_ready) {
      dischargeReady += 1;
    }
  });

  return {
    totalPatients: summary.total_patients ?? summary.patients ?? boardData?.count ?? visiblePatients,
    visiblePatients,
    openTasks: summary.open_tasks ?? summary.tasks_open ?? openTasks,
    critical: summary.critical ?? summary.urgent ?? critical,
    pendingResults: summary.pending_results ?? summary.results_pending ?? pendingResults,
    dischargeReady: summary.discharge_ready ?? summary.discharges ?? dischargeReady,
    myWork: summary.my_work ?? summary.assigned_to_me ?? 0,
    lastUpdated: summary.last_updated ?? boardData?.last_updated ?? boardData?.generated_at,
  };
}

export function getPatientId(patient) {
  return patient?.patient_id ?? patient?.id ?? patient?.patient?.id ?? patient?.patient_uuid;
}

export function getPatientName(patient) {
  return patient?.patient_name ?? patient?.name ?? patient?.patient?.name ?? patient?.display_name ?? 'Unnamed patient';
}

export function getPatientMrn(patient) {
  return patient?.mrn ?? patient?.medical_record_number ?? patient?.patient?.medical_record_number ?? patient?.patient?.mrn;
}

export function getPatientBed(patient) {
  return patient?.bed_label ?? patient?.bed_name ?? patient?.bed?.label ?? patient?.bed?.name ?? patient?.bed_number ?? patient?.room_bed;
}

export function getWardLabel(patient) {
  return patient?.ward_name ?? patient?.ward?.name ?? patient?.ward_label ?? patient?.unit_name ?? patient?.location;
}

export function getPatientUrgency(patient) {
  const supplied = patient?.urgency ?? patient?.priority ?? patient?.risk_level ?? patient?.status;
  if (supplied) {
    return String(supplied).toLowerCase();
  }
  if (asCount(patient?.active_alert_count) > 0 || asCount(patient?.urgent_task_count) > 0) {
    return 'urgent';
  }
  if (asCount(patient?.overdue_task_count) > 0) {
    return 'high';
  }
  if (getPatientTaskCount(patient) > 0 || getPatientResultCount(patient) > 0) {
    return 'pending';
  }
  return 'stable';
}

export function getPatientTasks(patient) {
  return asArray(patient?.tasks ?? patient?.open_tasks ?? patient?.clinical_tasks);
}

export function getPatientTaskCount(patient) {
  const tasks = getPatientTasks(patient);
  if (tasks.length > 0) {
    return tasks.filter((task) => !isTerminalTask(task)).length;
  }
  return (
    asCount(patient?.open_task_count)
    + asCount(patient?.nursing_task_count)
    + asCount(patient?.active_alert_count)
  );
}

export function getPatientResults(patient) {
  return asArray(patient?.results ?? patient?.pending_results ?? patient?.lab_results);
}

export function getPatientResultCount(patient) {
  const results = getPatientResults(patient);
  return results.length > 0 ? results.length : asCount(patient?.open_lab_order_count);
}

export function getPatientDischargeItems(patient) {
  const value = patient?.discharge_tasks ?? patient?.discharge ?? patient?.discharge_plan;
  if (Array.isArray(value) || Array.isArray(value?.results)) {
    return asArray(value);
  }
  if (Array.isArray(value?.items)) {
    return value.items;
  }
  return value && typeof value === 'object' ? [value] : [];
}

export function getPatientDischargeCount(patient) {
  const items = getPatientDischargeItems(patient);
  return items.length > 0 ? items.length : asCount(patient?.discharge_task_count);
}

export function getPatientEvents(patient) {
  return asArray(patient?.events ?? patient?.timeline ?? patient?.audit_events);
}

export function getWatchlist(boardData, patients) {
  const supplied = asArray(boardData?.watchlist ?? boardData?.watch_list);
  if (supplied.length > 0) {
    return supplied;
  }
  return patients.filter((patient) => ['critical', 'urgent', 'high'].includes(getPatientUrgency(patient))).slice(0, 6);
}

export function getTaskId(task) {
  return task?.id ?? task?.task_id ?? task?.uuid;
}

export function getTaskTitle(task) {
  return task?.title ?? task?.label ?? task?.summary ?? task?.action_text ?? task?.type_display ?? task?.task_type ?? 'Clinical task';
}

export function getTaskStatus(task) {
  return String(task?.status ?? task?.state ?? 'pending').toLowerCase();
}

export function getTaskUrgency(task) {
  return String(task?.urgency ?? task?.priority ?? task?.risk_level ?? getTaskStatus(task)).toLowerCase();
}

export function isTerminalTask(task) {
  return ['completed', 'cancelled', 'done', 'closed'].includes(getTaskStatus(task));
}

export function formatTimestamp(value) {
  if (!value) {
    return 'Not timed';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function patientChronicleHref(patient) {
  const patientId = getPatientId(patient);
  return patientId ? `/patients/${patientId}` : '/patients';
}
