import { taskRoutingKnown } from './taskRouting';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';

const TASK_TYPES = new Set(['ward_round', 'observation', 'medication', 'handoff']);
const present = (value) => value !== undefined && value !== null && value !== '';

function instant(value) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) throw new Error('Choose a valid observation time range.');
  return time.toISOString();
}

function dayBoundary(value, next = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid UTC date.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Choose a valid UTC date.');
  if (next) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function range(filters, prefix) {
  const lower = filters[`${prefix}_from`] || (filters.date || filters.start_date ? dayBoundary(filters.date || filters.start_date) : null);
  const upper = filters[`${prefix}_before`] || (filters.date || filters.end_date ? dayBoundary(filters.date || filters.end_date, true) : null);
  if (lower && upper && Date.parse(lower) >= Date.parse(upper)) throw new Error('The end of the time range must follow its start.');
  return {
    ...(lower ? { [`${prefix}_from`]: instant(lower) } : {}),
    ...(upper ? { [`${prefix}_before`]: instant(upper) } : {}),
  };
}

function base(filters) {
  const limit = present(filters.limit) ? Number(filters.limit) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Choose a page size from 1 to 100.');
  if (present(filters.cursor) && (typeof filters.cursor !== 'string' || filters.cursor.length > 1024)) throw new Error('Refresh the nursing record page.');
  const patient = filters.patient_id || filters.patient;
  const admission = filters.admission_case_id || filters.admission_id || filters.admission;
  const ward = filters.ward_id || filters.ward;
  if (present(filters.descending) && typeof filters.descending !== 'boolean') throw new Error('Choose a valid nursing record order.');
  return {
    limit,
    ...(patient ? { patient_id: patient } : {}),
    ...(admission ? { admission_case_id: admission } : {}),
    ...(ward ? { ward_id: ward } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    descending: filters.descending ?? filters.ordering?.startsWith('-') ?? false,
  };
}

export function nursingTaskQuery(filters = {}) {
  if (filters.priority && filters.priority !== 'all') throw new Error('Task priority is not available for Rust nursing records.');
  const status = ['pending', 'in_progress', 'overdue'].includes(filters.status) ? 'open' : filters.status;
  if (status && !['all', 'open', 'completed', 'cancelled'].includes(status)) throw new Error('Choose an available task status.');
  if (filters.task_type && filters.task_type !== 'all' && !TASK_TYPES.has(filters.task_type)) throw new Error('Choose an available nursing task type.');
  const query = {
    ...base(filters), ...range(filters, 'due'),
    ...(status && status !== 'all' ? { status } : {}),
    ...(filters.task_type && filters.task_type !== 'all' ? { task_type: filters.task_type } : {}),
  };
  if (filters.status === 'overdue') {
    const now = new Date().toISOString();
    if (!query.due_before || Date.parse(query.due_before) > Date.parse(now)) query.due_before = now;
  }
  return query;
}

export function patientVitalsQuery(filters = {}) {
  const query = { ...base(filters), ...range(filters, 'recorded') };
  if ((filters.encounter_id || filters.encounter) && !query.admission_case_id) throw new Error('Visit-scoped vital signs are unavailable. Choose an admission or all patient history.');
  if (present(filters.days) && (!Number.isInteger(Number(filters.days)) || Number(filters.days) < 1)) throw new Error('Choose a valid vital-sign time window.');
  const requestedHours = filters.hours ?? (present(filters.days) ? Number(filters.days) * 24 : undefined);
  if (present(requestedHours)) {
    const hours = Number(requestedHours);
    if (!Number.isInteger(hours) || hours < 0 || hours > 65535) throw new Error('Choose a valid vital-sign time window.');
    query.hours = hours;
  }
  return query;
}

export function nursingRecordsCacheScope(kind, filters = {}) {
  // Cache time-window settings, not a changing "overdue now" boundary.
  try {
    const stable = kind === 'tasks' && filters.status === 'overdue' ? { ...filters, status: 'open', overdue: true } : filters;
    const query = kind === 'tasks' ? nursingTaskQuery(stable) : patientVitalsQuery(stable);
    return hashQueryValue(JSON.stringify([query, stable.overdue === true]));
  } catch { return 'invalid'; }
}

function validRow(row, query, kind) {
  const timestamp = kind === 'tasks' ? 'due_at' : 'recorded_at';
  const prefix = kind === 'tasks' ? 'due' : 'recorded';
  const time = Date.parse(row?.[timestamp]);
  return typeof row?.id === 'string' && row.id.length > 0
    && typeof row.patient_id === 'string' && row.patient_id.length > 0
    && typeof row.admission_case_id === 'string' && row.admission_case_id.length > 0
    && (!query.patient_id || row.patient_id === query.patient_id)
    && (!query.admission_case_id || row.admission_case_id === query.admission_case_id)
    && (!query.ward_id || (kind === 'tasks' ? row.service_ward_id === query.ward_id : row.ward_id === undefined || row.ward_id === query.ward_id))
    && (kind !== 'tasks' || (taskRoutingKnown(row) && typeof row.ward_id === 'string' && row.ward_id.length > 0
      && TASK_TYPES.has(row.task_type) && ['open', 'completed', 'cancelled'].includes(row.status)))
    && (!query.status || row.status === query.status)
    && (!query.task_type || row.task_type === query.task_type)
    && Number.isFinite(time)
    && (!query[`${prefix}_from`] || time >= Date.parse(query[`${prefix}_from`]))
    && (!query[`${prefix}_before`] || time < Date.parse(query[`${prefix}_before`]));
}

/** Complete bounded windows for existing array consumers; never return a partial chart. */
export async function loadNursingRecordWindow(operation, query, kind, { signal } = {}) {
  const rows = []; const ids = new Set(); const cursors = new Set();
  const params = { ...query };
  for (let page = 0; page < 100; page += 1) {
    const response = await operation({ query: params, signal });
    if (!Array.isArray(response?.data) || response.data.length > params.limit || typeof response?.page?.has_next !== 'boolean') throw new Error('The nursing record window could not be confirmed. Refresh this view.');
    for (const row of response.data) {
      if (!validRow(row, params, kind) || ids.has(row.id)) throw new Error('The requested nursing record scope could not be confirmed. Refresh this view.');
      ids.add(row.id); rows.push(row);
    }
    if (!response.page.has_next) return rows;
    const cursor = response.page.next_cursor;
    if (!response.data.length || typeof cursor !== 'string' || !cursor || cursor === params.cursor || cursors.has(cursor)) throw new Error('The nursing record window could not be fully loaded. Refresh this view.');
    cursors.add(cursor); params.cursor = cursor;
  }
  throw new Error('Too many nursing records for this view. Choose a shorter time range.');
}
