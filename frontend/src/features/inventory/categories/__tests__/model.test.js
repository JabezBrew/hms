import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { categoryDetail, categoryPage, categoryState, commandReceipt, historyPage, inputDigest, normalizeInput, parentText, prepareCommand, validDescription, validNewText, validateCommand } from '../model';
import { actorId, category, categoryId, correction, creation, detail, historyId, makeResult, listItem, page, parent, parentId, requestId, stamp } from './fixtures';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const validate = (receipt, options = {}) => commandReceipt(receipt, { requestId, actorId, ...options });
it('preserves raw legacy name/description, nullable unavailable parent and unknown actor provenance', () => {
  const raw = { ...category, code: '', name: '  ' + 'n'.repeat(101), description: '\u0000historical', parent_id: parentId, parent: null };
  expect(categoryState(raw)).toBe(raw); expect(categoryDetail(detail(raw)).category).toBe(raw); expect(parentText(raw)).toBe('Recorded parent unavailable');
  expect(raw.parent_id).toBe(parentId); expect(raw.created_by_user_id).toBeNull();
});
it('retains actual standard list identity while rejecting malformed envelopes, duplicate rows and extended DTOs', () => {
  const value = page([listItem(category)]); expect(categoryPage(value)).toBe(value);
  for (const malformed of [{ data: [category], page: value.page }, { ...value, meta: null }, { ...value, data: [listItem(category), listItem(category)] }, { ...value, page: { ...value.page, limit: 101 } }, page([{ ...category, total_items: 0 }]), page([{ ...category, parent: { ...parent, id: parentId } }])]) expect(() => categoryPage(malformed)).toThrow();
  expect(() => categoryDetail({ ...detail(category), eligibility: { lifecycle_blocked_by: 'stock_count', parent_unavailable: false } })).toThrow();
});
it('counts scalars and bytes separately with approved code/name/reason bounds', () => {
  expect(validNewText('😀'.repeat(120), 'code')).toBe(true); expect(validNewText('😀'.repeat(121), 'code')).toBe(false);
  expect(validNewText('😀'.repeat(100))).toBe(true); expect(validNewText('😀'.repeat(101))).toBe(false);
  expect(validNewText('x'.repeat(1000), 'reason')).toBe(true); expect(validNewText('x'.repeat(1001), 'reason')).toBe(false);
  for (const text of ['', ' ', '\u0000bad', '\u0085bad', '\ud800', '\udc00']) expect(validNewText(text)).toBe(false);
});
it('keeps null, empty and whitespace description distinct and rejects new control/oversized text', async () => {
  for (const description of [null, '', '  ', '\tplain\ntext']) { expect(validDescription(description)).toBe(true); expect((await prepareCommand({ ...creation, description }, actorId)).input.description).toBe(description); }
  for (const description of ['\u0000', '\u0085', '😀'.repeat(2001), '\ud800']) await expect(prepareCommand({ ...creation, description }, actorId)).rejects.toThrow();
});
it('normalizes only new/replaced values and preserves unchanged invalid historical metadata exactly', async () => {
  const previous = { ...category, name: '', description: '\u0000' + 'x'.repeat(8001) };
  const command = await prepareCommand({ ...correction, name: '', description: previous.description, reason: '  Reason  ' }, actorId, previous);
  expect(command.input).toMatchObject({ name: '', description: previous.description, reason: 'Reason' });
  expect(normalizeInput({ ...creation, code: '  AbC  ', name: '  New Name  ' })).toMatchObject({ code: 'AbC', name: 'New Name' });
  await expect(prepareCommand({ ...correction, name: ' ', description: previous.description }, actorId, previous)).rejects.toThrow();
});
it.each(['code', 'facility_id', 'stock', 'is_active', 'item_id'])('rejects unsupported correction field %s instead of stripping it', async field => {
  await expect(prepareCommand({ ...correction, [field]: true }, actorId, category)).rejects.toThrow();
});
it('requires explicit parent null and closed retain/clear/set commands with reviewed parent version', async () => {
  const { parent: _parent, ...missing } = creation; await expect(prepareCommand(missing, actorId)).rejects.toThrow();
  for (const change of [{ action: 'retain' }, { action: 'clear' }, { action: 'set', parent_id: parentId, expected_parent_version: 3 }]) await expect(prepareCommand({ ...correction, parent_change: change }, actorId, category)).resolves.toMatchObject({ input: { parent_change: change } });
  for (const change of [{ action: 'set', parent_id: parentId }, { action: 'set', parent_id: parentId, expected_parent_version: 0 }, { action: 'retain', parent_id: parentId }]) await expect(prepareCommand({ ...correction, parent_change: change }, actorId, category)).rejects.toThrow();
});
it('copies before asynchronous hashing and freezes exact RAM intent and source', async () => {
  const input = structuredClone(correction), previous = structuredClone(category), pending = prepareCommand(input, actorId, previous);
  input.name = 'Late mutation'; previous.code = 'Late source'; const command = await pending;
  expect(command.input.name).toBe(correction.name); expect(command.previous.code).toBe(category.code); expect(Object.isFrozen(command.input.parent_change)).toBe(true);
  const value = structuredClone(command), validation = validateCommand(value); value.input.name = 'Later mutation'; expect((await validation).input.name).toBe(correction.name);
  expect(await inputDigest(correction)).toBe(await inputDigest(Object.fromEntries(Object.entries(correction).reverse())));
});
it.each(['create', 'correct', 'retire', 'reactivate'])('accepts exact original %s receipt independently of later category state', async action => {
  const input = action === 'create' ? creation : action === 'correct' ? correction : { action, client_request_id: requestId, category_id: categoryId, expected_version: 1 };
  const previous = { ...category, is_active: action !== 'reactivate' }, { command, receipt } = await makeResult(input, previous);
  const saved = await validate(receipt, { input: command.input, previous: command.previous }); expect(saved).toEqual(receipt); expect(Object.isFrozen(saved.category)).toBe(true);
});
it('validates selected parent CAS and preserves an unavailable retained pointer without inventing a label', async () => {
  const { receipt } = await makeResult({ ...creation, parent: { parent_id: parentId, expected_parent_version: 3 } }); await expect(validate(receipt)).resolves.toBeTruthy(); receipt.category.parent.version++; await expect(validate(receipt)).rejects.toThrow();
  const previous = { ...category, parent_id: parentId, parent: null }, retained = await makeResult(correction, previous); await expect(validate(retained.receipt, { previous })).resolves.toMatchObject({ category: { parent_id: parentId, parent: null } });
});
it('permits an independently renamed retained parent observation without pretending the subject or pointer changed', async () => {
  const previous = { ...category, parent_id: parentId, parent: { id: parentId, code: parent.code, name: 'Earlier local parent', version: 1, is_active: true } };
  const { receipt, command } = await makeResult(correction, previous);
  receipt.before.parent = { ...receipt.before.parent, name: 'Later local parent', version: 2 }; receipt.category.parent = { ...receipt.before.parent };
  await expect(validate(receipt, { input: command.input, previous: command.previous })).resolves.toMatchObject({ category: { parent_id: parentId } });
});
it.each(['actor', 'request', 'digest', 'subject', 'version', 'before', 'code', 'changed', 'extra'])('refuses corrupt original %s and does not mutate caller receipts', async fault => {
  const { receipt, command } = await makeResult();
  if (fault === 'actor') receipt.recorded_by_user_id = parentId;
  if (fault === 'request') receipt.client_request_id = parentId;
  if (fault === 'digest') receipt.input_digest = '0'.repeat(64);
  if (fault === 'subject') receipt.category.id = parentId;
  if (fault === 'version') receipt.category.version++;
  if (fault === 'before') receipt.before.name = 'Other observed source';
  if (fault === 'code') receipt.category.code = 'Changed permanent code';
  if (fault === 'changed') receipt.changed = false;
  if (fault === 'extra') receipt.reason = 'private';
  await expect(validate(receipt, { input: command.input, previous: command.previous })).rejects.toThrow();
});
it('records no-op correction without inventing another category revision', async () => {
  const { receipt } = await makeResult({ ...correction, name: category.name, description: category.description }); expect(receipt.changed).toBe(false); expect(receipt.category.version).toBe(1); await expect(validate(receipt)).resolves.toBeTruthy();
});
it('keeps general history closed to flags and revisions without description/snapshot/actor/reason bodies', () => {
  const row = { id: historyId, action: 'create', recorded_at: stamp, before_version: null, after_version: 1, name_changed: true, description_changed: false, parent_changed: false, active_changed: true };
  expect(historyPage(page([row])).data[0]).toBe(row);
  for (const extra of [{ recorded_by_user_id: actorId }, { reason: 'PRIVATE-REASON-SENTINEL' }, { description: 'PRIVATE-DESCRIPTION-SENTINEL' }, { before: { description: 'PRIVATE-SNAPSHOT-SENTINEL' } }]) expect(() => historyPage(page([{ ...row, ...extra }]))).toThrow();
  expect(() => categoryPage(page([{ ...listItem(category), description: 'PRIVATE-DIRECTORY-SENTINEL' }]))).toThrow();
  expect(() => categoryPage(page([{ ...listItem(category), created_by_user_id: actorId }]))).toThrow();
});
