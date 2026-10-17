// Loaded only for admission-scoped writes or recovery evidence. These are
// protocol classifiers, never patient authorization or a fallback write grant.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = 'POST /api/v2/patients/:id/chronicle/admissions/:id/';
export function classifyAdmissionWriteScope(path, pathParams) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v2' || parts[2] !== 'patients' || !UUID.test(parts[3]) || parts[4] !== 'chronicle') return null;
  if (parts.length === 6 && parts[5] === 'admission-advisory-cases') return { excludeRead: true };
  if (parts[5] !== 'admissions' || !UUID.test(parts[6])) return null;
  if (parts[7] === 'advisories') {
    const valid = parts.length === 8 || (parts.length === 9 && UUID.test(parts[8])) || (parts.length === 10 && ((parts[8] === 'requests' && UUID.test(parts[9])) || (UUID.test(parts[8]) && parts[9] === 'decision')));
    if (!valid) return null;
    return {
      primary: pathParams?.case_id === parts[6] ? parts[6] : null,
      excludeRead: parts.length === 8,
      retryTemplate: parts.length === 8 ? `${PREFIX}advisories` : parts.length === 10 && parts[9] === 'decision' ? `${PREFIX}advisories/:id/decision` : null,
    };
  }
  if (parts[7] !== 'medication-courses') return null;
  if (parts.length === 8 || (parts.length === 9 && parts[8] === 'context')) return { family: parts.slice(0, 8).join('/').toLowerCase(), excludeRead: true };
  if (!UUID.test(parts[8]) || !(parts.length === 9 || (parts.length === 10 && ['doses', 'supply', 'stop', 'supply-windows'].includes(parts[9])) || (parts.length === 11 && parts[9] === 'requests' && UUID.test(parts[10])))) return null;
  const primary = `treatment-course:${parts[3]}:${parts[6]}:${parts[8]}`;
  return {
    primary, extraReference: primary, family: parts.slice(0, 8).join('/').toLowerCase(),
    retryTemplate: parts.length === 10 && ['stop', 'supply-windows'].includes(parts[9]) ? `${PREFIX}medication-courses/:id/${parts[9]}` : null,
  };
}
