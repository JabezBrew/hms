import { expect, it } from 'vitest';
import { amendmentPayload, bodyFields, changeBody, notePayload, templateDraft, templateSchema, templateSections } from '../model';
import { templateEditorDraft, templatePayload } from '../templateModel';
import { body, detail, ids, requestId, revision, template } from './fixtures';

it('keeps freeform body exact while trimming title and requiring meaningful content', () => {
  const payload = notePayload({ title: '  Synthetic note  ', note_type: 'nursing_note', body: `  ${body}\n` }, { requestId });
  expect(payload).toEqual({ client_request_id: requestId, encounter_id: null, template_revision_id: null, title: 'Synthetic note', note_type: 'nursing_note', body: `  ${body}\n` });
  expect(() => notePayload({ title: 'N', note_type: 'doctor_note', body: '  ' }, { requestId })).toThrow(/Record a note/);
});
it('pins the chosen revision and uses real normalized section keys with literal starter text', () => {
  const draft = templateDraft(revision); expect(JSON.parse(draft.body)).toEqual({ assessment: 'Synthetic starter' });
  expect(notePayload(draft, { requestId, revision }).template_revision_id).toBe(revision.id);
  expect(templateSections({ body_template: JSON.stringify([{ name: '  Évaluation / Plan  ' }]) })[0].id).toBe('évaluationplan');
});
it('enforces required captured sections without rejecting recorded false or zero', () => {
  for (const value of ['', ' ', null, [], {}]) expect(() => notePayload({ ...templateDraft(revision), body: JSON.stringify({ assessment: value }) }, { requestId, revision })).toThrow(/required template section|Record some note/);
  for (const value of [false, 0, ['Synthetic'], { text: 'Synthetic' }]) expect(notePayload({ ...templateDraft(revision), body: JSON.stringify({ assessment: value }) }, { requestId, revision }).body).toBe(JSON.stringify({ assessment: value }));
  expect(() => notePayload({ ...templateDraft(revision), body: JSON.stringify({ assessment: 'Synthetic', another: 'Synthetic' }) }, { requestId, revision })).toThrow(/does not match/);
});
it('does not pretend to substitute patient placeholders', () => {
  expect(() => notePayload({ title: 'Synthetic', note_type: 'doctor_note', body: 'Hello {{patient_name}}' }, { requestId })).toThrow(/Replace the remaining template placeholders/);
});
it('amends only the confirmed author-capable source using its version and normalized reason', () => {
  expect(amendmentPayload(body, '  Synthetic correction  ', detail, requestId)).toEqual({ client_request_id: requestId, expected_version: 1, reason: 'Synthetic correction', body });
  expect(() => amendmentPayload(body, 'Synthetic', { ...detail, can_amend: false }, requestId)).toThrow(/cannot be amended/);
  expect(() => amendmentPayload(body, ' ', detail, requestId)).toThrow(/reason/);
});
it('edits nested structured values without flattening or changing another section', () => {
  const original = JSON.stringify({ assessment: { text: 'Synthetic', score: 0, checked: false }, plan: ['Synthetic next step'] }); const field = bodyFields(original).find((item) => item.path.at(-1) === 'text');
  expect(JSON.parse(changeBody(original, field, 'Synthetic corrected'))).toEqual({ assessment: { text: 'Synthetic corrected', score: 0, checked: false }, plan: ['Synthetic next step'] });
});
it('preserves template metadata and original section settings while saving a full next revision', () => {
  const source = { ...template, body_template: JSON.stringify({ description: 'Synthetic', custom: 'preserve', sections: [{ section: 'Assessment', type: 'text', required: true, help_text: 'Synthetic help' }] }) }; const form = templateEditorDraft(source); form.title = '  Synthetic new title  '; form.is_active = false;
  const payload = templatePayload(form, source, requestId); expect(payload.expected_version).toBe(1); expect(payload.is_active).toBe(false); expect(JSON.parse(payload.body_template)).toMatchObject({ custom: 'preserve', sections: [{ help_text: 'Synthetic help' }] });
  expect(() => templatePayload(form, { ...source, can_manage: false }, requestId)).toThrow(/cannot be changed/);
});
it('rejects ambiguous or excessive template definitions before transport', () => {
  const form = templateEditorDraft(null); form.title = 'Synthetic'; form.sections.push({ ...form.sections[0], key: ids[20], name: ' notes ' }); expect(() => templatePayload(form, null, requestId)).toThrow(/distinct/);
  expect(() => templatePayload({ ...form, title: 'x'.repeat(161) }, null, requestId)).toThrow(/160/);
});
it.each([[null], [], [{ section: 'Assessment', required: 'yes' }], [{ name: 'Plan' }, { section: ' plan ' }], Array.from({ length: 101 }, (_, index) => ({ section: `Section ${index}` }))].map((sections) => ({ sections })))('keeps malformed structured evidence out of new note selection ($#)', ({ sections }) => {
  const captured = { ...revision, body_template: JSON.stringify(sections) };
  expect(templateSchema(captured.body_template).kind).toBe('invalid');
  expect(() => templateDraft(captured)).toThrow(/historical template/);
  expect(() => notePayload({ title: 'Synthetic', note_type: 'doctor_note', body: 'Synthetic' }, { requestId, revision: captured })).toThrow(/structure cannot be confirmed/);
});
it('allows only unchanged retirement of a malformed historical template', () => {
  const source = { ...template, body_template: '  [null]\n' }; const form = templateEditorDraft(source);
  expect(form.malformed).toBe(true); expect(form.is_active).toBe(false);
  expect(templatePayload(form, source, requestId)).toMatchObject({ body_template: source.body_template, title: source.title, note_type: source.note_type, is_active: false, expected_version: 1 });
  for (const patch of [{ is_active: true }, { text: 'Synthetic replacement' }, { title: 'Synthetic renamed' }, { note_type: 'nursing_note' }]) expect(() => templatePayload({ ...form, ...patch }, source, requestId)).toThrow(/only be deactivated/);
});
it('preserves unknown section fields and nontext starter metadata without coerced values', () => {
  const raw = { description: { preserved: true }, sections: [{ name: 42, section: 'Assessment', id: 'historical-id', label: 'historical-label', type: 'custom', default_text: { text: 'Synthetic raw content' }, required: false, extra: [false, 0] }] };
  const source = { ...template, body_template: JSON.stringify(raw) }; const form = templateEditorDraft(source); form.title = 'Synthetic next revision';
  expect(form.sections[0].name).toBe('Assessment'); expect(form.sections[0].rawStarter).toBe(true);
  expect(JSON.parse(templatePayload(form, source, requestId).body_template)).toEqual(raw);
  expect(JSON.parse(templateDraft(source).body)).toEqual({ assessment: '' });
});
