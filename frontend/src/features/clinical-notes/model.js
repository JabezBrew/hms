import { hashQueryValue } from '@/shared/lib/privateQueryKey';

export const NOTE_TYPES = [['doctor_note', 'Doctor note'], ['nursing_note', 'Nursing note'], ['allied_health_note', 'Allied health note']];
export const validId = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const titleOf = (key) => String(key).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
export const sectionKey = (value) => String(value).trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function patientContext(patient) {
  const local = patient?.local_data || patient || {};
  const user = local.user_details;
  return { id: local.id || patient?.id, name: patient?.name || local.name || (user && `${user.first_name || ''} ${user.last_name || ''}`.trim()) || 'Patient', code: local.patient_code || local.medical_record_number || local.mrn || patient?.code || 'Patient identifier unavailable' };
}
export function templateSchema(body) {
  let document; try { document = JSON.parse(body); } catch { return { kind: 'plain', document: null, sections: [] }; }
  const recognized = Array.isArray(document) || (document && typeof document === 'object' && Object.hasOwn(document, 'sections'));
  if (!recognized) return { kind: 'plain', document, sections: [] };
  const sections = Array.isArray(document) ? document : document.sections;
  if (!Array.isArray(sections) || !sections.length || sections.length > 100) return { kind: 'invalid', document, sections: [] };
  const names = new Set(); const result = [];
  for (const item of sections) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || (item.required !== undefined && typeof item.required !== 'boolean')) return { kind: 'invalid', document, sections: [] };
    const label = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : typeof item.section === 'string' ? item.section.trim() : '';
    const id = sectionKey(label);
    if (!id || names.has(id)) return { kind: 'invalid', document, sections: [] };
    names.add(id); result.push({ ...item, id, label, raw: item });
  }
  return { kind: 'structured', document, sections: result };
}
export function templateSections(revision) { return templateSchema(revision?.body_template).sections; }
export function templateDraft(revision) {
  if (templateSchema(revision?.body_template).kind === 'invalid') throw new Error('This historical template cannot be selected for new notes. Choose another template or a freeform note.');
  const sections = templateSections(revision);
  const body = sections.length ? JSON.stringify(Object.fromEntries(sections.map((item) => [item.id, typeof item.default_text === 'string' ? item.default_text : typeof item.defaultText === 'string' ? item.defaultText : '']))) : revision?.body_template || '';
  return { title: revision?.title || '', note_type: revision?.note_type || 'doctor_note', body };
}
// Only local memory contains these field values. Keys for reads never contain
// the title, body, labels or search text.
export function bodyFields(body) {
  let tree; try { tree = JSON.parse(body); } catch { tree = body; }
  if (!tree || typeof tree !== 'object') return [{ key: 'text', path: [], label: 'Note', value: body, type: 'string' }];
  const fields = [];
  const visit = (value, path, labels) => {
    if (fields.length >= 200 || path.length > 10) throw new Error('This note is too detailed for this editor. Its recorded content is still available to read.');
    if (value && typeof value === 'object') { for (const [key, child] of Object.entries(value)) visit(child, [...path, key], [...labels, Array.isArray(value) ? `Item ${Number(key) + 1}` : titleOf(key)]); }
    else fields.push({ key: hashQueryValue(JSON.stringify(path)), path, label: labels.join(' · ') || 'Note', value: value ?? '', type: value === null ? 'string' : typeof value });
  };
  visit(tree, [], []);
  return fields;
}
export function changeBody(body, field, value) {
  if (!field.path.length) return value;
  const tree = JSON.parse(body); let target = tree;
  for (const key of field.path.slice(0, -1)) target = target[key];
  target[field.path.at(-1)] = value;
  return JSON.stringify(tree);
}
export function notePayload(form, { requestId, revision = null, encounterId = null } = {}) {
  const title = form.title.trim(); const body = form.body;
  if (!validId(requestId)) throw new Error('A new save request could not be prepared.');
  if (!title || [...title].length > 160) throw new Error('Enter a note title of up to 160 characters.');
  if (!NOTE_TYPES.some(([value]) => value === form.note_type)) throw new Error('Choose a supported note type.');
  if (typeof body !== 'string' || !body.trim() || [...body].length > 20000) throw new Error('Record a note of up to 20,000 characters.');
  if (/\{\{[^{}]+\}\}/.test(body)) throw new Error('Replace the remaining template placeholders before saving. Starter text is copied literally.');
  let parsed; try { parsed = JSON.parse(body); } catch { /* Free text is supported. */ }
  if (parsed && typeof parsed === 'object' && !bodyFields(body).some((field) => String(field.value).trim())) throw new Error('Record some note content before review.');
  if (revision && templateSchema(revision.body_template).kind === 'invalid') throw new Error('The captured template structure cannot be confirmed for this change.');
  const sections = templateSections(revision);
  if (sections.length) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Complete the selected template sections before review.');
    const known = new Set(sections.map((item) => item.id)); const byKey = new Map(Object.entries(parsed).map(([key, value]) => [sectionKey(key), value]));
    if (Object.keys(parsed).some((key) => !key.startsWith('_') && !known.has(sectionKey(key)))) throw new Error('This note does not match the captured template sections.');
    const present = (value) => typeof value === 'string' ? Boolean(value.trim()) : value && typeof value === 'object' ? Object.keys(value).length > 0 : value !== null && value !== undefined;
    if (sections.some((item) => item.required && !present(byKey.get(item.id)))) throw new Error('Complete each required template section before saving.');
  }
  if (revision && !validId(revision.id)) throw new Error('Reload the selected template before continuing.');
  if (encounterId && !validId(encounterId)) throw new Error('The current encounter could not be confirmed.');
  return { client_request_id: requestId, template_revision_id: revision?.id || null, encounter_id: encounterId || null, note_type: form.note_type, title, body };
}
export function amendmentPayload(body, reason, source, requestId) {
  if (!source?.can_amend || !Number.isSafeInteger(source.version) || source.version < 1) throw new Error('This note cannot be amended with your current access.');
  const validated = notePayload({ title: source.title, note_type: source.note_type, body }, { requestId, revision: source.template_revision });
  const explanation = reason.trim();
  if (!explanation || [...explanation].length > 500) throw new Error('Record an amendment reason of up to 500 characters.');
  return { client_request_id: requestId, expected_version: source.version, reason: explanation, body: validated.body };
}
