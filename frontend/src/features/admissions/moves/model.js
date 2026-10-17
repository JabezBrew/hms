const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL = '00000000-0000-0000-0000-000000000000';
const TOKEN = /^[0-9a-f]{64}$/;
const statuses = new Set(['ready_for_activation', 'admitted', 'discharge_pending', 'discharged', 'cancelled']);
const origins = new Set(['activation', 'move', 'legacy_current_observation']);
const reasons = new Set(['source_inactive', 'source_inconsistent', 'too_many_open_tasks', 'nursing_authority_required']);
export const MOVE_TASK_POLICY = 'route_all_clear_assignees';
export const moveUnavailableCopy = {
  source_inactive: 'Only an active admitted or discharge-pending case can move.',
  source_inconsistent: 'The current placement needs review before a move.',
  too_many_open_tasks: 'More than 500 open tasks require a separate reviewed routing workflow. No partial move is available.',
  nursing_authority_required: 'Routing these open tasks also requires current Nursing access and nursing task management authority.',
};
export const validId = value => typeof value === 'string' && UUID.test(value) && value !== NIL;
const text = value => typeof value === 'string' && value.trim().length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const nullableDate = value => value === null || date(value);
const nullableId = value => value === null || validId(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const invalid = () => new Error('The selected admission placement evidence could not be confirmed. Refresh the exact admission before continuing.');
export function moveScope(scope) {
  if (!validId(scope?.patientId) || !validId(scope.caseId)) throw invalid();
  return { patient_id: scope.patientId, admission_case_id: scope.caseId };
}
export function placementLabels(value) {
  if (!validId(value?.ward_id) || !text(value.ward_name) || !validId(value.bed_id) || !text(value.bed_code)
    || !nullableId(value.section_id) || !(value.section_name === null || text(value.section_name))
    || (value.section_id === null && value.section_name !== null)) throw invalid();
  return value;
}
export function placementSnapshot(value) {
  if (!validId(value?.id) || !count(value.placement_revision) || !date(value.started_at) || !origins.has(value.origin)
    || typeof value.legacy_unknown_prefix !== 'boolean' || value.legacy_unknown_prefix !== (value.origin === 'legacy_current_observation')) throw invalid();
  placementLabels(value.labels); return value;
}
export function placementContext(value, scope) {
  moveScope(scope);
  if (value?.patient_id !== scope.patientId || value.admission_case_id !== scope.caseId || !statuses.has(value.status)
    || !count(value.placement_revision) || !TOKEN.test(value.placement_token) || !validId(value.ward_id) || !text(value.ward_name)
    || !nullableId(value.bed_id) || !(value.bed_code === null || text(value.bed_code)) || (value.bed_id === null && value.bed_code !== null)
    || !nullableId(value.encounter_id) || !nullableId(value.visit_id) || !nullableDate(value.admitted_at)
    || typeof value.placement_history_partial !== 'boolean' || !nullableDate(value.placement_known_from)
    || !count(value.open_task_count) || !count(value.assigned_open_task_count) || value.assigned_open_task_count > value.open_task_count
    || value.max_open_tasks !== 500 || !count(value.source_cleaning_minutes) || typeof value.can_move !== 'boolean'
    || !(value.unavailable_reason === null || reasons.has(value.unavailable_reason))) throw invalid();
  if (value.current_placement !== null) {
    placementSnapshot(value.current_placement);
    if (value.current_placement.labels.ward_id !== value.ward_id || value.current_placement.labels.bed_id !== value.bed_id || value.current_placement.placement_revision !== value.placement_revision) throw invalid();
  }
  if (value.open_task_count > 500) {
    if (value.task_membership_token !== null || value.can_move || value.unavailable_reason === null) throw invalid();
  } else if (!TOKEN.test(value.task_membership_token)) throw invalid();
  if (value.can_move && (value.unavailable_reason !== null || !['admitted', 'discharge_pending'].includes(value.status) || !value.current_placement || !date(value.admitted_at))) throw invalid();
  if (!value.can_move && value.unavailable_reason === null) throw invalid();
  return value;
}
export function moveDestination(value) { placementLabels(value); if (!TOKEN.test(value.candidate_token)) throw invalid(); return value; }
export function moveHistoryItem(value, scope) {
  moveScope(scope);
  if (!validId(value?.id) || value.patient_id !== scope.patientId || value.admission_case_id !== scope.caseId || !count(value.placement_revision) || value.placement_revision < 1
    || !date(value.moved_at) || !validId(value.recorded_by_user_id) || !text(value.recorded_by_display_name)
    || !count(value.routed_task_count) || value.routed_task_count > 500 || !count(value.cleared_assignee_count) || value.cleared_assignee_count > value.routed_task_count) throw invalid();
  placementLabels(value.source); placementLabels(value.destination);
  if (value.source.bed_id === value.destination.bed_id) throw invalid();
  return value;
}
export function moveDetail(value, scope, moveId) {
  moveHistoryItem(value, scope);
  if ((moveId && value.id !== moveId) || !text(value.reason) || Array.from(value.reason).length > 1000 || value.reason !== value.reason.trim()
    || value.task_policy !== MOVE_TASK_POLICY || typeof value.placement_history_partial !== 'boolean' || value.can_move === true) throw invalid();
  const episode = value.episode;
  if (!episode || !nullableId(episode.encounter_id) || !nullableId(episode.visit_id) || !date(episode.admitted_at) || !['admitted', 'discharge_pending'].includes(episode.status)) throw invalid();
  placementSnapshot(value.source_placement); placementSnapshot(value.destination_placement);
  if (!same(value.source_placement.labels, value.source) || !same(value.destination_placement.labels, value.destination)
    || value.source_placement.placement_revision + 1 !== value.placement_revision || value.destination_placement.placement_revision !== value.placement_revision
    || value.destination_placement.origin !== 'move' || value.destination_placement.started_at !== value.moved_at) throw invalid();
  const task = value.task_result, release = value.source_bed_release;
  if (!task || task.open_task_count !== value.routed_task_count || task.routed_task_count !== value.routed_task_count || task.cleared_assignee_count !== value.cleared_assignee_count
    || !release || release.status !== 'cleaning' || !count(release.cleaning_minutes) || !date(release.cleaning_due_at)
    || Date.parse(release.cleaning_due_at) !== Date.parse(value.moved_at) + release.cleaning_minutes * 60000) throw invalid();
  return value;
}
export function moveCommand({ scope, source, destination, reason, requestId, actorId }) {
  placementContext(source, scope); moveDestination(destination);
  const normalized = typeof reason === 'string' ? reason.trim() : '';
  if (!source.can_move || !validId(requestId) || !validId(actorId) || destination.bed_id === source.bed_id || !normalized || Array.from(normalized).length > 1000) throw new Error('Choose an explicit different destination and enter a reason of 1 to 1,000 characters before reviewing the move.');
  return { ...scope, actorId, source, destination, payload: { client_request_id: requestId, expected_placement_token: source.placement_token, destination_bed_id: destination.bed_id, expected_destination_token: destination.candidate_token, expected_task_membership_token: source.task_membership_token, task_policy: MOVE_TASK_POLICY, reason: normalized } };
}
export function moveReceipt(value, command) {
  const movement = moveDetail(value?.movement, command), source = command.source, destination = command.destination;
  const labels = placementLabels(destination); const destinationLabels = Object.fromEntries(['ward_id', 'ward_name', 'bed_id', 'bed_code', 'section_id', 'section_name'].map(key => [key, labels[key]]));
  if (value.client_request_id !== command.payload.client_request_id || typeof value.replayed !== 'boolean' || value.recorded_at !== movement.moved_at
    || !same(value.reviewed_input, command.payload) || movement.recorded_by_user_id !== command.actorId || movement.placement_revision !== source.placement_revision + 1
    || !same(movement.source_placement, source.current_placement) || !same(movement.destination, destinationLabels)
    || !same(movement.episode, { encounter_id: source.encounter_id, visit_id: source.visit_id, admitted_at: source.admitted_at, status: source.status })
    || movement.reason !== command.payload.reason || movement.task_result.open_task_count !== source.open_task_count || movement.cleared_assignee_count !== source.assigned_open_task_count
    || movement.source_bed_release.cleaning_minutes !== source.source_cleaning_minutes || movement.placement_history_partial !== source.placement_history_partial || value.can_move === true) throw invalid();
  return value;
}
export function validateMoveCommand(command) {
  const expected = moveCommand({ scope: command, source: command.source, destination: command.destination, reason: command.payload?.reason, requestId: command.payload?.client_request_id, actorId: command.actorId });
  if (!same(command.payload, expected.payload)) throw invalid();
  return command;
}
export function destinationQuery(query = {}) {
  if (Object.keys(query).some(key => !['limit', 'ward_id', 'search', 'cursor'].includes(key))) throw invalid();
  if (query.search != null && typeof query.search !== 'string') throw invalid();
  const limit = query.limit ?? 25, search = query.search?.trim();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (query.ward_id != null && !validId(query.ward_id)) || (search != null && Array.from(search).length > 80) || (query.cursor != null && (typeof query.cursor !== 'string' || !query.cursor || query.cursor.length > 2048))) throw invalid();
  return { limit, ...(query.ward_id ? { ward_id: query.ward_id } : {}), ...(search ? { search } : {}), ...(query.cursor ? { cursor: query.cursor } : {}) };
}
export function historyQuery(query = {}) {
  if (Object.keys(query).some(key => !['limit', 'cursor'].includes(key))) throw invalid();
  const limit = query.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (query.cursor != null && (!/^v:[1-9][0-9]*$/.test(query.cursor) || !Number.isSafeInteger(Number(query.cursor.slice(2)))))) throw invalid();
  return { limit, ...(query.cursor ? { cursor: query.cursor } : {}) };
}
export function movePage(envelope, scope, query, kind) {
  const rows = envelope?.data, page = envelope?.page;
  if (!Array.isArray(rows) || rows.length > query.limit || !page || page.limit !== query.limit || typeof page.has_next !== 'boolean' || (page.has_next && (!rows.length || typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor === query.cursor)) || (!page.has_next && page.next_cursor !== null)) throw invalid();
  const seen = new Set(); let before = query.cursor && kind === 'history' ? Number(query.cursor.slice(2)) : Infinity;
  rows.forEach(row => { if (kind === 'history') { moveHistoryItem(row, scope); if (Object.hasOwn(row, 'reason') || row.placement_revision >= before) throw invalid(); before = row.placement_revision; } else moveDestination(row); const id = kind === 'history' ? row.id : row.bed_id; if (seen.has(id)) throw invalid(); seen.add(id); });
  if (kind === 'history' && page.has_next && (!/^v:[1-9][0-9]*$/.test(page.next_cursor) || page.next_cursor !== `v:${before}`)) throw invalid();
  return { rows, hasNext: page.has_next, cursor: page.next_cursor };
}
