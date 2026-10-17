import { bodyFields, sectionKey, templateSchema, templateSections, validId } from './model';
import { copyBodyEditable } from './templateModel';

const sensitiveKeys = new Set(['__proto__', 'prototype', 'constructor']);
const sensitiveKey = (key) => sensitiveKeys.has(key);
const generatedValue = (value) => typeof value === 'string' || (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.entries(value).every(([key, item]) => !sensitiveKey(key) && typeof item === 'string'));
const fail = () => new Error('The patient, selected revision and template preview could not be confirmed.');
export const meaningfulSection = (value) => value !== null && value !== undefined && (typeof value === 'string' ? Boolean(value.trim()) : typeof value === 'object' ? Object.keys(value).length > 0 : true);
export function previewInput({ patientId, encounterId = null, revision, body, mode, sections = [], chiefComplaint = '' }) {
  if (!validId(patientId) || (encounterId !== null && !validId(encounterId)) || !validId(revision?.template_id) || !validId(revision?.id) || !Number.isSafeInteger(revision.version) || revision.version < 1 || templateSchema(revision.body_template).kind === 'invalid') throw fail();
  if (typeof body !== 'string' || [...body].length > 20000 || typeof chiefComplaint !== 'string' || [...chiefComplaint].length > 500 || !['empty_only', 'all', 'selected'].includes(mode)) throw fail();
  const known = templateSections(revision).map((item) => item.id); if (!known.length) known.push('text');
  const knownSet = new Set(known);
  if (!Array.isArray(sections) || sections.length > 100 || new Set(sections).size !== sections.length || sections.some((key) => !knownSet.has(key)) || (mode === 'selected' ? !sections.length : sections.length !== 0)) throw fail();
  return { template_id: revision.template_id, template_revision_id: revision.id, encounter_id: encounterId, apply_mode: mode, sections, base_body: body, chief_complaint: chiefComplaint || null };
}
export function confirmedPreview(value, { patientId, revision, payload }) {
  const structured = templateSchema(revision.body_template).kind === 'structured'; const known = structured ? templateSections(revision).map((item) => item.id) : ['text'];
  const knownSet = new Set(known); const requestedSet = new Set(payload.sections); const appliedSet = new Set(Array.isArray(value?.applied_sections) ? value.applied_sections : []); const order = new Map(known.map((key, index) => [key, index]));
  if (value?.patient_id !== patientId || value.encounter_id !== payload.encounter_id || value.template_id !== revision.template_id || value.template_revision_id !== revision.id || value.template_revision_version !== revision.version || value.date_basis !== 'utc'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.rendered_on) || !Number.isFinite(Date.parse(value.rendered_on)) || new Date(value.rendered_on).toISOString().slice(0, 10) !== value.rendered_on || value.kind !== (structured ? 'structured' : 'plain')
    || !Array.isArray(value.applied_sections) || value.applied_sections.length > 100 || new Set(value.applied_sections).size !== value.applied_sections.length || value.applied_sections.some((key) => !knownSet.has(key) || (payload.apply_mode === 'selected' && !requestedSet.has(key)))
    || !Array.isArray(value.unresolved) || value.unresolved.length > 32 || typeof value.unresolved_truncated !== 'boolean' || value.unresolved.some((item) => !/^[A-Za-z0-9_]{1,64}$/.test(item?.name) || !Number.isSafeInteger(item.count) || item.count < 1 || item.count > 20000)) throw fail();
  if (structured) {
    if (!value.patch || typeof value.patch !== 'object' || Array.isArray(value.patch) || Object.keys(value.patch).length !== value.applied_sections.length || Object.keys(value.patch).some((key) => sectionKey(key) !== key || !appliedSet.has(key) || sensitiveKey(key) || !generatedValue(value.patch[key]))) throw fail();
  } else if (typeof value.patch !== 'string' || value.applied_sections.some((key) => key !== 'text') || (!value.applied_sections.length && value.patch !== '')) throw fail();
  if (value.applied_sections.some((key, index) => index > 0 && order.get(key) <= order.get(value.applied_sections[index - 1])) || new Set(value.unresolved.map((item) => item.name)).size !== value.unresolved.length) throw fail();
  const serialized = typeof value.patch === 'string' ? value.patch : JSON.stringify(value.patch); if ([...serialized].length > 20000) throw fail();
  return value;
}
export function applyTemplatePreview(body, preview, payload) {
  if (body !== payload.base_body) throw new Error('The note changed after this preview. Generate a fresh preview before applying it.');
  if (!preview.applied_sections.length) return body;
  const applied = new Set(preview.applied_sections);
  let result;
  if (preview.kind === 'plain') {
    if (payload.apply_mode === 'empty_only' && meaningfulSection(body)) throw fail();
    result = preview.patch;
  } else {
    let base;
    if (!body.trim()) base = {};
    else {
      try { base = JSON.parse(body); } catch { throw new Error('This existing text cannot be merged into structured sections. Keep it unchanged, or explicitly start a separate template draft.'); }
      if (!base || typeof base !== 'object' || Array.isArray(base)) throw new Error('The existing note is not a section object. Its text has been kept unchanged.');
      // Reuse the template copy precision guard with a harmless schema envelope.
      // The untouched note object must survive parsing before any shallow patch.
      const wrapped = `{"base":${body},"sections":[{"section":"Preview"}]}`;
      if (!copyBodyEditable(wrapped)) throw new Error('Applying this preview could change unreviewed JSON metadata. The original note has been kept unchanged.');
    }
    if (Object.keys(base).some((key) => applied.has(sectionKey(key)) && sectionKey(key) !== key)) throw new Error('Existing section names do not match this exact template. The original note has been kept unchanged.');
    if (payload.apply_mode === 'empty_only' && preview.applied_sections.some((key) => meaningfulSection(base[key]))) throw fail();
    result = JSON.stringify({ ...base, ...preview.patch });
  }
  if ([...result].length > 20000) throw new Error('The combined note exceeds 20,000 characters. The original note has been kept unchanged.');
  bodyFields(result); return result;
}
