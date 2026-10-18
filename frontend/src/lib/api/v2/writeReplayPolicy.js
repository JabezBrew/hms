// Exact command replay is consulted only during an actual write attempt.
const IDEMPOTENT = new Set(['POST /api/v2/inventory/storage-locations', 'POST /api/v2/inventory/storage-locations/:id/rename', 'POST /api/v2/inventory/storage-locations/:id/retire', 'POST /api/v2/inventory/storage-locations/:id/reactivate', 'POST /api/v2/admin/org-units', 'POST /api/v2/admin/org-units/:id/rename', 'POST /api/v2/admin/org-units/:id/retire', 'POST /api/v2/admin/org-units/:id/reactivate', 'POST /api/v2/nursing/fluid-observations', 'POST /api/v2/nursing/fluid-observations/:id/corrections', 'POST /api/v2/nursing/fluid-observations/:id/void', 'POST /api/v2/nursing/fluid-monitoring/rules', 'POST /api/v2/scheduling/appointment-series', 'POST /api/v2/scheduling/appointment-series/:id/cancel-future', 'POST /api/v2/nursing/prn-dose-requests', 'PUT /api/v2/admin/network-policy', 'PATCH /api/v2/clinical/prescriptions/:id/documentation', 'POST /api/v2/clinical/prescriptions/:id/new-course', 'POST /api/v2/nursing/patient-handovers', 'POST /api/v2/nursing/patient-handovers/:id/amend', 'POST /api/v2/nursing/patient-handovers/:id/void', 'POST /api/v2/patients/:id/clinical/notes/record', 'POST /api/v2/clinical/notes/:id/amendments', 'POST /api/v2/clinical/note-templates/record', 'POST /api/v2/clinical/note-templates/:id/changes', 'POST /api/v2/patients/:id/chronicle/ward-rounds/draft', 'POST /api/v2/patients/:id/chronicle/ward-rounds/:id/commit']);
export const supportsCommandReplay = (method, route) => IDEMPOTENT.has(`${method} ${route}`);

// Pure intent/reference preparation loads only for an actual write or recovery read.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])); return value; }
function identifiers(value, result = new Set(), key = '') {
  if (!value || result.size >= 100) return result;
  if (typeof value === 'string' && key !== 'client_request_id' && UUID.test(value) && /(^|_)ids?$/.test(key)) result.add(value);
  else if (value instanceof FormData) value.forEach((item, field) => identifiers(item, result, field));
  else if (Array.isArray(value)) value.forEach((item) => identifiers(item, result, key));
  else if (typeof value === 'object') Object.entries(value).forEach(([field, item]) => identifiers(item, result, field));
  return result;
}
function sensitive(value) { return value && typeof value === 'object' && Object.entries(value).some(([key, item]) => /password|^(access_token|refresh_token|secret|credential)$/i.test(key) || sensitive(item)); }
function template(path) { return String(path).replace(/\{[a-z_]+\}/g, ':id').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id'); }
export const referenceHashes = async (digest, ...values) => Promise.all([...values.reduce((found, value) => identifiers(value, found), new Set())].map((value) => digest(`reference:${value.toLowerCase()}`)));
export function prepareWriteIntent(request, method) {
  const route = template(request.path);
  const serializable = !request.unsupportedBody && !sensitive(request.body);
  // Compare the JSON actually sent, including Date.toJSON/undefined handling.
  // Large or credential-bearing commands are never eligible for replay.
  const wireBody = serializable ? JSON.stringify(request.body ?? null) : null;
  const replayable = serializable && wireBody.length <= 1000000;
  const input = replayable ? JSON.stringify(canonical([method, request.resolvedPath, request.query || null, JSON.parse(wireBody)])) : crypto.randomUUID();
  return { route, replayable, input };
}
