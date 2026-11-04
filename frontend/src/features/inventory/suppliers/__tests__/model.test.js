import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CONTACT_FIELDS, commandReceipt, historyPage, inputDigest, normalizeInput, prepareCommand, supplierDetail, supplierPage, supplierState, validContactText, validNewText, validateCommand } from '../model';
import { actorId, supplier, supplierId, correction, creation, detail, historyId, makeResult, listItem, page, otherId, requestId, stamp } from './fixtures';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const validate = (receipt, options = {}) => commandReceipt(receipt, { requestId, actorId, ...options });
it('retains exactly all fourteen current scalar fields, including unknown provenance and raw malformed historical contacts', () => {
  const value = { ...supplier, code: '', name: '', contact_name: '\u0000' + 'n'.repeat(500), phone: ' old\nphone ', email: 'malformed legacy address', address: '\t' + 'x'.repeat(9000) };
  expect(supplierState(value)).toBe(value); expect(supplierDetail(detail(value)).supplier).toBe(value); expect(Object.keys(value)).toHaveLength(14);
  for (const field of CONTACT_FIELDS) { const missing = structuredClone(value); delete missing[field]; expect(() => supplierState(missing)).toThrow(); }
});
it('admits only lean seven-field directory rows, bounded unique standard envelopes and known lifecycle eligibility', () => {
  const value = page([listItem(supplier)]); expect(supplierPage(value)).toBe(value); expect(Object.keys(value.data[0])).toHaveLength(7);
  for (const malformed of [{ ...value, meta: null }, { ...value, data: [listItem(supplier), listItem(supplier)] }, { ...value, page: { ...value.page, limit: 101 } }, page([supplier])]) expect(() => supplierPage(malformed)).toThrow();
  for (const field of [...CONTACT_FIELDS, 'created_by_user_id', 'updated_by_user_id']) expect(() => supplierPage(page([{ ...listItem(supplier), [field]: null }]))).toThrow();
  expect(() => supplierDetail({ ...detail(supplier), eligibility: { lifecycle_blocked_by: 'purchase_order' } })).toThrow();
});
it.each(CONTACT_FIELDS)('requires explicit nullable %s on create and correction and preserves null/empty/spaces', async field => {
  for (const input of [creation, correction]) { const missing = structuredClone(input); delete missing[field]; await expect(prepareCommand(missing, actorId, input.action === 'create' ? null : supplier)).rejects.toThrow(); }
  for (const value of [null, '', '  ']) expect((await prepareCommand({ ...creation, [field]: value }, actorId)).input[field]).toBe(value);
});
it('uses supported scalar/byte bounds without an HTML email syntax restriction or text rewriting', async () => {
  expect(validNewText('😀'.repeat(120), 'code')).toBe(true); expect(validNewText('😀'.repeat(121), 'code')).toBe(false);
  expect(validContactText('😀'.repeat(100), 'contact_name')).toBe(true); expect(validContactText('x'.repeat(21), 'phone')).toBe(false);
  expect(validContactText('😀'.repeat(2000), 'address')).toBe(true); expect(validContactText('😀'.repeat(2001), 'address')).toBe(false);
  for (const email of ['"a b@c"@example.com', 'a@bücher.example', 'a@[IPv6:::1]']) expect((await prepareCommand({ ...creation, email }, actorId)).input.email).toBe(email);
  expect(validContactText('\n\t', 'address')).toBe(true); expect(validContactText('\n', 'phone')).toBe(false); expect(validContactText('\ud800', 'email')).toBe(false);
});
it('normalizes new identity/reason only and retains unchanged invalid oversized or control-bearing legacy values exactly', async () => {
  const previous = { ...supplier, name: '', contact_name: '\u0000' + 'x'.repeat(500), phone: '\n' + 'x'.repeat(90), email: '\u0000malformed', address: '\u0000' + 'x'.repeat(9000) };
  const command = await prepareCommand({ ...correction, ...Object.fromEntries(['name', ...CONTACT_FIELDS].map(field => [field, previous[field]])), reason: '  Reviewed  ' }, actorId, previous);
  expect(command.input.reason).toBe('Reviewed'); for (const field of ['name', ...CONTACT_FIELDS]) expect(command.input[field]).toBe(previous[field]);
  expect(normalizeInput({ ...creation, code: ' Code ', name: ' Name ' })).toMatchObject({ code: 'Code', name: 'Name' });
  await expect(prepareCommand({ ...correction, phone: previous.phone + 'new' }, actorId, previous)).rejects.toThrow();
});
it.each(['code', 'facility_id', 'stock', 'is_active', 'item_id'])('rejects unsupported correction field %s rather than stripping it', async field => {
  await expect(prepareCommand({ ...correction, [field]: true }, actorId, supplier)).rejects.toThrow();
});
it('copies raw fields before asynchronous hashing and freezes exact RAM intent/source', async () => {
  const input = structuredClone(correction), previous = structuredClone(supplier), pending = prepareCommand(input, actorId, previous);
  input.email = 'late@example.com'; previous.code = 'LATE'; const command = await pending;
  expect(command.input.email).toBeNull(); expect(command.previous.code).toBe(supplier.code); expect(Object.isFrozen(command.input)).toBe(true);
  const value = structuredClone(command), validation = validateCommand(value); value.input.address = 'Late'; expect((await validation).input.address).toBeNull();
  expect(await inputDigest(correction)).toBe(await inputDigest(Object.fromEntries(Object.entries(correction).reverse())));
});
it.each(['create', 'correct', 'retire', 'reactivate'])('validates the exact original %s receipt independently of current state', async action => {
  const input = action === 'create' ? creation : action === 'correct' ? correction : { action, client_request_id: requestId, supplier_id: supplierId, expected_version: 1 };
  const previous = { ...supplier, is_active: action !== 'reactivate' }, { command, receipt } = await makeResult(input, previous);
  const saved = await validate(receipt, { input: command.input, previous: command.previous }); expect(saved).toEqual(receipt); expect(Object.isFrozen(saved.supplier)).toBe(true);
});
it.each(['actor', 'request', 'digest', 'subject', 'version', 'before', 'code', 'changed', 'contact', 'extra'])('refuses corrupt original %s proof', async fault => {
  const { receipt, command } = await makeResult();
  if (fault === 'actor') receipt.recorded_by_user_id = otherId;
  if (fault === 'request') receipt.client_request_id = otherId;
  if (fault === 'digest') receipt.input_digest = '0'.repeat(64);
  if (fault === 'subject') receipt.supplier.id = otherId;
  if (fault === 'version') receipt.supplier.version++;
  if (fault === 'before') receipt.before.email = 'changed@example.com';
  if (fault === 'code') receipt.supplier.code = 'REPLACED';
  if (fault === 'changed') receipt.changed = false;
  if (fault === 'contact') receipt.supplier.contact_name = '';
  if (fault === 'extra') receipt.reason = 'Private';
  await expect(validate(receipt, { input: command.input, previous: command.previous })).rejects.toThrow();
});
it('confirms no-op correction without inventing another revision or timestamp', async () => {
  const { receipt } = await makeResult({ ...correction, name: supplier.name }); expect(receipt.changed).toBe(false); expect(receipt.supplier.version).toBe(1); await expect(validate(receipt)).resolves.toBeTruthy();
  receipt.supplier.updated_at = stamp; await expect(validate(receipt)).rejects.toThrow();
});
it('keeps eleven-field ordinary history to revisions/change flags without contact/snapshot/actor/reason content', () => {
  const row = { id: historyId, action: 'correct', recorded_at: stamp, before_version: 1, after_version: 2, name_changed: false, contact_name_changed: true, phone_changed: false, email_changed: false, address_changed: false, active_changed: false };
  expect(Object.keys(row)).toHaveLength(11); expect(historyPage(page([row])).data[0]).toBe(row);
  for (const extra of [{ recorded_by_user_id: actorId }, { reason: 'PRIVATE' }, { address: 'PRIVATE' }, { before: supplier }]) expect(() => historyPage(page([{ ...row, ...extra }]))).toThrow();
});
