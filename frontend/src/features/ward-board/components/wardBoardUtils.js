const SHORT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const BOARD_VIEWS = [
  { value: 'by-patient', label: 'Patients' },
  { value: 'by-urgency', label: 'Attention' },
  { value: 'results', label: 'Results' },
  { value: 'discharge', label: 'Discharges' },
  { value: 'my-work', label: 'Due Work' },
];

export const DEFAULT_BOARD_VIEW = BOARD_VIEWS[0].value;
export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50];

export const URGENCY_STYLES = {
  critical: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  high: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  urgent: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  moderate: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  routine: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
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
  open: URGENCY_STYLES.moderate,
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
  let overdueTasks = 0;
  let safety = 0;
  let criticalSafety = 0;
  let dueMedications = 0;
  let pendingResults = 0;
  let criticalResults = 0;
  let pendingLabOrders = 0;
  let dischargeBlockers = 0;
  let attentionRows = 0;

  patients.forEach((patient) => {
    openTasks += getPatientTaskCount(patient);
    overdueTasks += getPatientOverdueTaskCount(patient);
    safety += asCount(patient?.active_alert_count);
    criticalSafety += asCount(patient?.critical_alert_count);
    dueMedications += getPatientDueMedicationCount(patient);
    pendingResults += getPatientResultCount(patient);
    criticalResults += asCount(patient?.critical_unverified_result_count);
    pendingLabOrders += getPatientPendingLabOrderCount(patient);
    dischargeBlockers += getPatientDischargeCount(patient);
    if (patientNeedsAttention(patient)) {
      attentionRows += 1;
    }
  });
  const dueWork = openTasks + dueMedications;

  return {
    totalPatients: summary.total_patients ?? summary.patients ?? boardData?.count ?? visiblePatients,
    visiblePatients,
    openTasks: summary.open_tasks ?? summary.tasks_open ?? openTasks,
    overdueTasks: summary.overdue ?? summary.overdue_tasks ?? overdueTasks,
    dueMedications: summary.due_medications ?? summary.medications_due ?? dueMedications,
    safety,
    criticalSafety: summary.critical ?? summary.urgent ?? criticalSafety,
    pendingResults: summary.pending_results ?? summary.results_pending ?? pendingResults,
    criticalResults,
    pendingLabOrders,
    dischargeBlockers: summary.discharge_blockers ?? summary.discharge_ready ?? summary.discharges ?? dischargeBlockers,
    attentionRows: summary.attention ?? summary.needs_attention ?? attentionRows,
    dueWork: summary.due_work ?? summary.my_work ?? summary.reviews ?? dueWork,
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

export function getPatientWardName(patient) {
  return patient?.ward_name ?? patient?.ward?.name ?? patient?.ward_label ?? null;
}

export function getPatientStatus(patient) {
  const raw = patient?.admission_status ?? patient?.status ?? patient?.patient_status ?? patient?.state;
  if (!raw) return 'admitted';
  return String(raw).replace(/_/g, ' ');
}

export function getPatientUrgency(patient) {
  if (asCount(patient?.critical_alert_count) > 0 || asCount(patient?.critical_unverified_result_count) > 0) {
    return 'critical';
  }
  if (asCount(patient?.active_alert_count) > 0 || getPatientOverdueTaskCount(patient) > 0) {
    return 'urgent';
  }
  if (getPatientDueMedicationCount(patient) > 0) {
    return 'high';
  }
  if (getPatientTaskCount(patient) > 0
    || getPatientResultCount(patient) > 0
    || getPatientDischargeCount(patient) > 0
    || getPatientPendingLabOrderCount(patient) > 0) {
    return 'pending';
  }
  return 'stable';
}

export function patientNeedsAttention(patient) {
  return asCount(patient?.active_alert_count) > 0
    || getPatientTaskCount(patient) > 0
    || getPatientDueMedicationCount(patient) > 0
    || getPatientResultCount(patient) > 0
    || getPatientPendingLabOrderCount(patient) > 0
    || Boolean(patient?.discharge_case_id)
    || getPatientDischargeCount(patient) > 0;
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
  );
}

export function getPatientOverdueTaskCount(patient) {
  return asCount(patient?.overdue_nursing_task_count ?? patient?.overdue_task_count ?? patient?.overdue_tasks);
}

export function getPatientDueMedicationCount(patient) {
  return asCount(patient?.due_medication_count ?? patient?.medication_due_count);
}

export function getPatientResults(patient) {
  return asArray(patient?.results ?? patient?.pending_results ?? patient?.lab_results);
}

export function getPatientResultCount(patient) {
  const results = getPatientResults(patient);
  return results.length > 0
    ? results.length
    : asCount(patient?.unverified_result_count ?? patient?.pending_results_count);
}

export function getPatientPendingLabOrderCount(patient) {
  return asCount(patient?.pending_lab_order_count ?? patient?.open_lab_order_count);
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
  return items.length > 0
    ? items.length
    : asCount(patient?.open_discharge_blocker_count ?? patient?.discharge_blocker_count ?? patient?.discharge_task_count);
}

export function getPatientNextAction(patient) {
  const tasks = getPatientTasks(patient).filter((task) => !isTerminalTask(task));
  if (tasks.length > 0) {
    const task = tasks.toSorted((left, right) => {
      const leftTime = new Date(left?.due_at ?? left?.due_time ?? left?.target_time ?? 0).getTime();
      const rightTime = new Date(right?.due_at ?? right?.due_time ?? right?.target_time ?? 0).getTime();
      return (Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER)
        - (Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER);
    })[0];
    const due = formatTime(task?.due_at ?? task?.due_time ?? task?.target_time);
    return {
      label: getTaskTitle(task),
      meta: due ? `Due ${due}` : getTaskCategory(task),
      tone: getTaskStatus(task) === 'overdue' || task?.is_overdue ? 'critical' : getTaskPriority(task),
    };
  }

  if (asCount(patient?.critical_alert_count) > 0) {
    return {
      label: 'Review safety alert',
      meta: `${asCount(patient?.critical_alert_count)} critical`,
      tone: 'critical',
    };
  }

  if (getPatientOverdueTaskCount(patient) > 0) {
    return {
      label: 'Overdue nursing task',
      meta: formatTime(patient?.next_nursing_task_due_at),
      tone: 'critical',
    };
  }

  if (getPatientDueMedicationCount(patient) > 0) {
    return {
      label: 'Medication due',
      meta: formatTime(patient?.next_due_medication_at),
      tone: 'high',
    };
  }

  if (getPatientResultCount(patient) > 0) {
    return {
      label: 'Review lab result',
      meta: `${getPatientResultCount(patient)} unverified`,
      tone: 'info',
    };
  }

  if (getPatientDischargeCount(patient) > 0) {
    return {
      label: 'Clear discharge blocker',
      meta: `${getPatientDischargeCount(patient)} open`,
      tone: 'moderate',
    };
  }

  if (getPatientTaskCount(patient) > 0) {
    return {
      label: 'Nursing task',
      meta: formatTime(patient?.next_nursing_task_due_at),
      tone: 'pending',
    };
  }

  if (getPatientPendingLabOrderCount(patient) > 0) {
    return {
      label: 'Lab order pending',
      meta: `${getPatientPendingLabOrderCount(patient)} ordered`,
      tone: 'info',
    };
  }

  return null;
}

export function getWatchlist(boardData, patients) {
  const supplied = asArray(boardData?.watchlist ?? boardData?.watch_list);
  if (supplied.length > 0) {
    return supplied;
  }
  return patients
    .filter((patient) => asCount(patient?.critical_alert_count) > 0 || asCount(patient?.critical_unverified_result_count) > 0)
    .slice(0, 6);
}

export function getOverdueTaskList(boardData, patients) {
  const supplied = asArray(boardData?.overdue_tasks);
  if (supplied.length > 0) return supplied;
  const list = [];
  patients.forEach((p) => {
    const tasks = getPatientTasks(p).filter((t) => getTaskStatus(t) === 'overdue');
    tasks.slice(0, 2).forEach((t) => {
      list.push({
        ...t,
        _patient_name: getPatientName(p),
        _patient_id: getPatientId(p),
        _bed: getPatientBed(p),
      });
    });
    if (tasks.length === 0 && getPatientOverdueTaskCount(p) > 0) {
      list.push({
        id: `${getPatientId(p)}:overdue-task`,
        title: 'Overdue nursing task',
        due_at: p?.next_nursing_task_due_at,
        _patient_name: getPatientName(p),
        _patient_id: getPatientId(p),
        _bed: getPatientBed(p),
      });
    }
  });
  return list.slice(0, 7);
}

export function getAbnormalResults(boardData, patients) {
  const supplied = asArray(boardData?.abnormal_results);
  if (supplied.length > 0) return supplied;
  const list = [];
  patients.forEach((p) => {
    const results = getPatientResults(p).filter((r) => r?.is_critical || r?.is_abnormal || r?.flag === 'critical');
    results.slice(0, 2).forEach((r) => {
      list.push({
        ...r,
        _bed: getPatientBed(p),
        _patient_name: getPatientName(p),
        _patient_id: getPatientId(p),
      });
    });
    if (results.length === 0 && getPatientResultCount(p) > 0) {
      list.push({
        id: `${getPatientId(p)}:result-review`,
        name: asCount(p?.critical_unverified_result_count) > 0 ? 'Critical result review' : 'Result review',
        _bed: getPatientBed(p),
        _patient_name: getPatientName(p),
        _patient_id: getPatientId(p),
      });
    }
  });
  return list.slice(0, 5);
}

export function getDischargeBlockerList(boardData, patients) {
  const supplied = asArray(boardData?.discharge_blockers ?? boardData?.discharge_items);
  if (supplied.length > 0) return supplied;
  const list = [];
  patients.forEach((p) => {
    getPatientDischargeItems(p).slice(0, 2).forEach((item) => {
      list.push({
        ...item,
        _bed: getPatientBed(p),
        _patient_name: getPatientName(p),
        _patient_id: getPatientId(p),
      });
    });
    if (getPatientDischargeItems(p).length === 0 && getPatientDischargeCount(p) > 0) {
      list.push({
        id: `${getPatientId(p)}:discharge-blockers`,
        title: 'Discharge blockers',
        _bed: getPatientBed(p),
        _patient_name: getPatientName(p),
        _patient_id: getPatientId(p),
      });
    }
  });
  return list.slice(0, 7);
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
  return getTaskPriority(task);
}

export function getTaskPriority(task) {
  const supplied = task?.urgency ?? task?.priority ?? task?.risk_level;
  if (supplied) {
    return String(supplied).toLowerCase();
  }
  const status = getTaskStatus(task);
  if (['overdue', 'blocked', 'escalated'].includes(status) || task?.is_overdue) {
    return 'critical';
  }
  return 'routine';
}

export function getTaskCategory(task) {
  return task?.category ?? task?.task_category ?? task?.type ?? null;
}

export function getTaskOwner(task) {
  return task?.assignee_name ?? task?.assigned_to ?? task?.owner_role ?? task?.owner ?? null;
}

export function isTerminalTask(task) {
  return ['completed', 'cancelled', 'done', 'closed'].includes(getTaskStatus(task));
}

export function isAcknowledged(task) {
  return task?.acknowledged === true || task?.ack === true || Boolean(task?.acknowledged_at);
}

export function formatTimestamp(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return SHORT_DATE_TIME_FORMATTER.format(date);
}

export function formatTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return TIME_FORMATTER.format(date);
}

export function patientChronicleHref(patient) {
  const patientId = getPatientId(patient);
  if (!patientId) {
    return '/patients';
  }
  const params = new URLSearchParams();
  const admissionId = patient?.admission_id || patient?.admission_case_id || patient?.current_admission_id;
  if (admissionId) {
    params.set('admission', String(admissionId));
  }
  const query = params.toString();
  return `/patients/${patientId}${query ? `?${query}` : ''}`;
}
