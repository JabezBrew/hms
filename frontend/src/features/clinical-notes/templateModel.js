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
  if (form.structured) {
    if (!form.sections.length || form.sections.length > 100 || form.sections.some((item) => !sectionKey(item.name)) || new Set(form.sections.map((item) => sectionKey(item.name))).size !== form.sections.length) throw new Error('Use between 1 and 100 sections with distinct, nonempty names.');
    const sections = form.sections.map((item) => ({ ...item.raw, ...(typeof item.raw.name === 'string' && item.raw.name.trim() ? { name: item.name.trim() } : { section: item.name.trim() }), required: item.required, ...(!item.rawStarter ? { default_text: item.default_text } : {}) }));
    const document = form.document && !Array.isArray(form.document) ? form.document : {};
    body = JSON.stringify({ ...document, ...(!form.rawDescription ? { description: form.description } : {}), sections });
  }
  if (typeof body !== 'string' || !body.trim() || [...body].length > 20000) throw new Error('Keep the template content within 20,000 characters.');
  if (source && (!source.can_manage || !Number.isSafeInteger(source.version))) throw new Error('This template cannot be changed with your current access.');
  return { client_request_id: requestId, title, note_type: form.note_type, body_template: body, is_active: form.is_active, ...(source ? { expected_version: source.version, change_summary: summary } : {}) };
}
