import { NOTE_TYPES, sectionKey, templateSchema, validId } from './model';
export function templateEditorDraft(source) {
  const schema = templateSchema(source?.body_template); const { document } = schema; const malformed = Boolean(source && schema.kind === 'invalid');
  const sections = source ? schema.sections : [{ section: 'Notes', type: 'text', required: true }];
  const structured = !source || schema.kind === 'structured';
  return { title: source?.title || '', note_type: source?.note_type || 'doctor_note', is_active: malformed ? false : source?.is_active ?? true, description: typeof document?.description === 'string' ? document.description : '', rawDescription: Boolean(document && Object.hasOwn(document, 'description') && typeof document.description !== 'string'), document, malformed,
    structured, text: source?.body_template || '', change_summary: '', sections: sections.map((item) => ({ key: crypto.randomUUID(), raw: item.raw || item, name: item.label || (typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.section || ''), default_text: typeof item.default_text === 'string' ? item.default_text : typeof item.defaultText === 'string' ? item.defaultText : '', rawStarter: (item.default_text !== undefined && typeof item.default_text !== 'string') || (item.defaultText !== undefined && typeof item.defaultText !== 'string'), required: item.required === true })) };
}
export function templatePayload(form, source, requestId) {
  const title = form.title.trim(); const summary = form.change_summary.trim();
  if (!validId(requestId)) throw new Error('A save request could not be prepared.');
  if (!title || [...title].length > 160) throw new Error('Enter a template title of up to 160 characters.');
  if (!NOTE_TYPES.some(([key]) => key === form.note_type)) throw new Error('Choose a supported note type.');
  if ([...summary].length > 500) throw new Error('Keep the change summary within 500 characters.');
  let body = form.text;
  if (form.malformed && (!source || form.is_active || form.text !== source.body_template || title !== source.title || form.note_type !== source.note_type)) throw new Error('This historical template can only be deactivated with its original content unchanged.');
  if (form.preserveSeedBody && !form.seedBodyEdited) body = form.originalSeedBody;
  else if (form.preserveSeedBody && form.structured) body = copiedStructuredBody(form);
  else if (form.structured) {
    if (!form.sections.length || form.sections.length > 100 || form.sections.some((item) => !sectionKey(item.name)) || new Set(form.sections.map((item) => sectionKey(item.name))).size !== form.sections.length) throw new Error('Use between 1 and 100 sections with distinct, nonempty names.');
    const sections = form.sections.map((item) => ({ ...item.raw, ...(typeof item.raw.name === 'string' && item.raw.name.trim() ? { name: item.name.trim() } : { section: item.name.trim() }), required: item.required, ...(!item.rawStarter ? { default_text: item.default_text } : {}) }));
    const document = form.document && !Array.isArray(form.document) ? form.document : {};
    body = JSON.stringify({ ...document, ...(!form.rawDescription ? { description: form.description } : {}), sections });
  }
  if (typeof body !== 'string' || !body.trim() || [...body].length > 20000) throw new Error('Keep the template content within 20,000 characters.');
  if (!source && templateSchema(body).kind === 'invalid') throw new Error('This historical structure is read-only and cannot seed a new template.');
  if (source && (!source.can_manage || !Number.isSafeInteger(source.version))) throw new Error('This template cannot be changed with your current access.');
  return { client_request_id: requestId, title, note_type: form.note_type, body_template: body, is_active: form.is_active, ...(source ? { expected_version: source.version, change_summary: summary } : {}) };
}


// A reviewed new copy preserves the recorded representation until a body field
// is explicitly edited. Array roots and unknown envelope/section metadata stay.
export function copyBodyEditable(body) {
  const schema = templateSchema(body);
  if (schema.kind !== 'structured') return schema.kind !== 'invalid';
  // Ignore only whitespace outside strings. A changed token can mean rounded
  // numbers, duplicate keys, or another representation this editor cannot retain.
  const tokens = (value) => value.replace(/"(?:\\.|[^"\\])*"|\s+/g, (part) => part.startsWith('"') ? part : '');
  try { return tokens(body) === tokens(JSON.stringify(schema.document)); } catch { return false; }
}
function copiedStructuredBody(form) {
  if (!copyBodyEditable(form.originalSeedBody)) throw new Error('This saved JSON cannot be edited without changing unreviewed metadata. Keep its exact content or create a separately reviewed template.');
  const sections = form.sections.map((item) => {
    const raw = { ...item.raw }; const originalName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : (raw.section || '').trim();
    if (!originalName || item.name.trim() !== originalName) raw[typeof raw.name === 'string' && raw.name.trim() ? 'name' : 'section'] = item.name.trim();
    if (!originalName || item.required !== (item.raw.required === true)) raw.required = item.required;
    const originalText = typeof item.raw.default_text === 'string' ? item.raw.default_text : typeof item.raw.defaultText === 'string' ? item.raw.defaultText : '';
    if (!item.rawStarter && (!originalName || item.default_text !== originalText)) raw[typeof item.raw.defaultText === 'string' && !Object.hasOwn(item.raw, 'default_text') ? 'defaultText' : 'default_text'] = item.default_text;
    return raw;
  });
  if (!sections.length || sections.length > 100 || form.sections.some((item) => !sectionKey(item.name)) || new Set(form.sections.map((item) => sectionKey(item.name))).size !== sections.length) throw new Error('Use between 1 and 100 sections with distinct, nonempty names.');
  if (Array.isArray(form.document)) return JSON.stringify(sections);
  const original = form.document || {};
  return JSON.stringify({ ...original, ...(!form.rawDescription && form.description !== (typeof original.description === 'string' ? original.description : '') ? { description: form.description } : {}), sections });
}
export function sharedCopyDraft(revision) {
  if (!validId(revision?.id) || !validId(revision.template_id) || templateSchema(revision.body_template).kind === 'invalid') throw new Error('This historical structure is read-only and cannot seed a new template.');
  return { ...revision, title: `${[...revision.title].slice(0, 146).join('')} (shared copy)`, is_active: false };
}
