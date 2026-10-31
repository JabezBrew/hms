import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonical, commandReceipt, displayText, historyPage, inputDigest, itemDetail, itemPage, itemState, normalizeInput, ordinaryItem, prepareCommand, reviewedInput, validNewText, validReviewedDate, validateCommand, validTimestamp } from '../model';
import { actorId, categoryId, correction, creation, item, itemId, page, requestId, revisionId, stamp, today } from './fixtures';
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => vi.unstubAllGlobals());
const copy = value => structuredClone(value);
async function result(input = correction, previous = item) {
  const command = await prepareCommand(input, actorId, input.action === 'create' ? null : previous, { today });
  const changed = input.action === 'create' || (input.action === 'correct' ? ['code', 'name', 'unit'].some(key => command.input[key] !== previous[key]) : previous.is_active !== (input.action === 'reactivate'));
  const next = input.action === 'create' ? { ...copy(item), id: itemId, category_id: command.input.category_id, code: command.input.code, name: command.input.name, unit: command.input.unit, item_type: command.input.item_type, created_at: stamp, catalog_changed_at: stamp } : { ...copy(previous), ...(input.action === 'correct' ? { code: command.input.code, name: command.input.name, unit: command.input.unit } : { is_active: input.action === 'reactivate' }), version: previous.version + Number(changed), catalog_changed_at: changed ? stamp : previous.catalog_changed_at };
  const revision = input.action === 'correct' ? { id: revisionId, reviewed_effective_from: command.input.effective_from, recorded_at: stamp,
    before: { code: previous.code, name: previous.name, unit: previous.unit, version: previous.version },
    after: { code: next.code, name: next.name, unit: next.unit, version: next.version }, projection_changed: changed } : null;
  return { command, receipt: { client_request_id: requestId, input_digest: command.digest, reviewed_input: copy(command.input), recorded_by_user_id: actorId, item: next, changed, recorded_at: stamp, correction_revision: revision } };
}
const validate = (receipt, options = {}) => commandReceipt(receipt, { requestId, actorId, ...options });
it('keeps raw legacy state and unavailable category without inventing fields or normalizing classification', () => {
  const raw = { ...copy(item), code: '', name: '  legacy name  ', unit: 'u'.repeat(121), item_type: 'legacy-unknown', category: null };
  expect(itemState(raw)).toBe(raw); expect(ordinaryItem(raw)).toBe(false); expect(displayText(raw.code)).toBe('Not recorded'); expect(raw.code).toBe('');
  const controlled = { ...copy(item), item_type: 'controlled_substance', controlled: false, effective_controlled: true }; expect(itemState(controlled)).toBe(controlled); expect(ordinaryItem(controlled)).toBe(false);
});
it.each(['category_id', 'version', 'created_at', 'effective_controlled'])('refuses malformed current %s evidence', field => { const value = copy(item); value[field] = null; expect(() => itemState(value)).toThrow(); });
it('does not expose a foreign category projection or accept stock/pricing fields in administration state', () => {
  expect(() => itemState({ ...copy(item), category: { ...item.category, id: actorId } })).toThrow();
  expect(() => itemState({ ...copy(item), total_stock: 10 })).toThrow();
});
it('validates bounded directory, exact detail and static advisory without making it authority', () => {
  expect(itemPage(page([copy(item)]))).toEqual(page([item])); expect(() => itemPage(page([item, copy(item)]))).toThrow();
  expect(() => itemPage({ data: [item], page: { limit: 101, has_next: false, next_cursor: null }, meta: {} })).toThrow();
  expect(() => itemPage({ data: [item], page: { limit: 25, has_next: true, next_cursor: null }, meta: {} })).toThrow();
  expect(itemDetail({ item, eligibility: { unit_change_blocked_by: 'operational_reference', lifecycle_blocked_by: 'operational_reference' } }, itemId).item).toBe(item);
  expect(() => itemDetail({ item, eligibility: { unit_change_blocked_by: 'override', lifecycle_blocked_by: null } })).toThrow();
});
it('normalizes changed input while preserving unchanged blank/long/raw legacy fields exactly', async () => {
  const previous = { ...copy(item), code: '', unit: 'u'.repeat(121) };
  const prepared = await prepareCommand({ ...correction, code: '', unit: previous.unit, name: '  New reviewed name  ', reason: '  Reviewed reason  ' }, actorId, previous, { today });
  expect(prepared.input).toMatchObject({ code: '', unit: previous.unit, name: 'New reviewed name', reason: 'Reviewed reason' }); expect(previous.code).toBe('');
  expect(() => normalizeInput({ ...correction, code: ' ', unit: previous.unit }, previous, { today })).toThrow();
});
it.each(['controlled', 'price', 'supplier_id', 'item_type', 'category_id'])('rejects an unsupported correction field %s rather than stripping it', field => {
  expect(() => normalizeInput({ ...correction, [field]: true }, item, { today })).toThrow();
});
it('requires explicit ordinary type, unit and exact category for creation', async () => {
  expect((await prepareCommand({ ...creation, code: '  Case-Sensitive  ' }, actorId)).input.code).toBe('Case-Sensitive');
  for (const value of [{ ...creation, item_type: '' }, { ...creation, item_type: 'controlled_substance' }, { ...creation, unit: '' }, { ...creation, category_id: null }, { ...creation, controlled: false }]) await expect(prepareCommand(value, actorId)).rejects.toThrow();
});
it('preserves used/controlled unchanged-unit correction but refuses a controlled/unknown unit change or lifecycle intent', async () => {
  for (const previous of [{ ...copy(item), controlled: true, effective_controlled: true }, { ...copy(item), item_type: 'unknown' }]) {
    await expect(prepareCommand(correction, actorId, previous, { today })).resolves.toMatchObject({ input: correction });
    await expect(prepareCommand({ ...correction, unit: 'other' }, actorId, previous, { today })).rejects.toThrow();
    await expect(prepareCommand({ action: 'retire', client_request_id: requestId, item_id: itemId, expected_version: 1 }, actorId, previous)).rejects.toThrow();
  }
});
it.each(['x'.repeat(121), '\u0000bad', 'bad\u0085value', '\ud800', '\udc00', ''])('rejects invalid changed text without logging or echoing it', value => { expect(validNewText(value)).toBe(false); expect(() => normalizeInput({ ...correction, name: value }, item, { today })).toThrow(); });
it('counts Unicode scalars and UTF-8 bytes, and never lowercases codes or aliases units', () => {
  expect(validNewText('😀'.repeat(120))).toBe(true); expect(validNewText('😀'.repeat(121))).toBe(false);
  expect(normalizeInput({ ...creation, code: 'AbC', unit: 'mL' })).toMatchObject({ code: 'AbC', unit: 'mL' });
});
it.each(['2024-02-29', '0001-01-01', '-0001-01-01', '-10000-12-31', '+10000-01-01'])('keeps valid signed/expanded reviewed date %s', value => { expect(validReviewedDate(value)).toBe(true); });
it.each([undefined, null, '2026-02-29', '2026-04-31', '2026-00-01', '2026-01-00', 'nonsense'])('rejects invalid reviewed date %s', value => { expect(validReviewedDate(value)).toBe(false); });
it('uses browser date only as new-intent convenience; signed past receipts are not rejected by a four-digit gate', async () => {
  await expect(prepareCommand({ ...correction, effective_from: '2030-01-01' }, actorId, item, { today })).rejects.toThrow(/server confirms/);
  const { receipt } = await result({ ...correction, effective_from: '-10000-01-01' }); await expect(validate(receipt)).resolves.toMatchObject({ reviewed_input: { effective_from: '-10000-01-01' } });
  expect(validTimestamp('+10000-01-01T01:02:03.123456Z')).toBe(true); expect(validTimestamp('2026-10-30T25:00:00Z')).toBe(false);
});
it('clones intent and previous state before awaited hashing, and returns immutable review values', async () => {
  const value = copy(correction), previous = copy(item), pending = prepareCommand(value, actorId, previous, { today }); value.name = 'Mutated caller'; previous.code = 'Mutated source';
  const command = await pending; expect(command.input.name).toBe(correction.name); expect(command.previous.code).toBe(item.code); expect(Object.isFrozen(command.input)).toBe(true);
  const mutable = copy(command), validation = validateCommand(mutable); mutable.input.name = 'Late mutation'; expect((await validation).input.name).toBe(correction.name);
});
it('canonical SHA256 is stable across key insertion order and binds the exact raw unchanged legacy values', async () => {
  expect(await inputDigest(correction)).toBe(await inputDigest(Object.fromEntries(Object.entries(correction).reverse())));
  expect(await inputDigest({ ...correction, unit: 'pack ' })).not.toBe(await inputDigest(correction)); expect(canonical({ b: 1, a: { z: 2, y: 3 } })).toEqual({ a: { y: 3, z: 2 }, b: 1 });
});
it('accepts exact immutable original correction independently of unrelated future legacy/supplier timestamps', async () => {
  const { receipt, command } = await result(); expect(item.created_at > receipt.recorded_at).toBe(true);
  const saved = await validate(receipt, { input: command.input, previous: command.previous }); expect(saved.item.name).toBe(correction.name); expect(Object.isFrozen(saved)).toBe(true);
  const pending = validate(receipt); receipt.item.name = 'Late caller mutation'; expect((await pending).item.name).toBe(correction.name);
});
it('records an unchanged dated correction under a new UUID with no projected version increment', async () => {
  const { receipt } = await result({ ...correction, code: item.code, name: item.name, unit: item.unit });
  expect(receipt.changed).toBe(false); expect(receipt.correction_revision.id).toBe(revisionId); expect(receipt.item.version).toBe(1);
  await expect(validate(receipt, { previous: item })).resolves.toMatchObject({ changed: false });
});
it.each(['actor', 'request', 'digest', 'input', 'item', 'version', 'revision', 'revision-date', 'revision-time', 'before', 'changed', 'category', 'classification', 'extra'])('rejects corrupt original receipt %s', async fault => {
  const { receipt, command } = await result();
  if (fault === 'actor') receipt.recorded_by_user_id = categoryId;
  if (fault === 'request') receipt.client_request_id = actorId;
  if (fault === 'digest') receipt.input_digest = '0'.repeat(64);
  if (fault === 'input') receipt.reviewed_input.name = 'Wrong input';
  if (fault === 'item') receipt.item.id = actorId;
  if (fault === 'version') receipt.item.version++;
  if (fault === 'revision') receipt.correction_revision = null;
  if (fault === 'revision-date') receipt.correction_revision.reviewed_effective_from = '2020-03-01';
  if (fault === 'revision-time') receipt.correction_revision.recorded_at = '2026-10-30T14:20:01Z';
  if (fault === 'before') receipt.correction_revision.before.name = 'Wrong before';
  if (fault === 'changed') receipt.changed = false;
  if (fault === 'category') receipt.item.category_id = actorId;
  if (fault === 'classification') receipt.item.item_type = 'medication';
  if (fault === 'extra') receipt.eligibility = { lifecycle_blocked_by: null };
  await expect(validate(receipt, { input: command.input, previous: command.previous })).rejects.toThrow();
});
it('requires explicit exact command context, with no create-source or tampered digest shortcut', async () => {
  const command = await prepareCommand(creation, actorId); await expect(validateCommand({ ...copy(command), previous: copy(item) })).rejects.toThrow();
  await expect(validateCommand({ ...copy(command), digest: '0'.repeat(64) })).rejects.toThrow();
  await expect(prepareCommand(correction, 'not-an-actor', item, { today })).rejects.toThrow();
  expect(() => reviewedInput({ ...creation, is_active: true })).toThrow();
});
it.each(['create', 'retire', 'reactivate'])('validates typed %s receipt without inventing a correction revision', async action => {
  const input = action === 'create' ? creation : { action, client_request_id: requestId, item_id: itemId, expected_version: 1 };
  const previous = { ...copy(item), is_active: action !== 'reactivate' }; const { receipt, command } = await result(input, previous);
  await expect(validate(receipt, { input: command.input, previous: action === 'create' ? null : previous })).resolves.toMatchObject({ correction_revision: null });
  receipt.correction_revision = {}; await expect(validate(receipt)).rejects.toThrow();
});
it('preserves server history order and sameUUID/time records across two sources, with no reason/actor leak', () => {
  const legacy = { source: 'legacy_dated_version', id: revisionId, effective_from: '+10000-01-01', effective_to: null, code: '', name: item.name, unit: item.unit, recorded_at: stamp, reason_present: true };
  const governed = { source: 'governed_correction', id: revisionId, reviewed_effective_from: today, recorded_at: stamp, before: { code: item.code, name: item.name, unit: item.unit, version: 1 }, after: { code: item.code, name: item.name, unit: item.unit, version: 1 }, projection_changed: false, reason_present: true };
  const response = page([governed, legacy]); expect(historyPage(response).data).toEqual([governed, legacy]); expect(legacy.effective_from).toBe('+10000-01-01');
  expect(() => historyPage(page([legacy, copy(legacy)]))).toThrow(); expect(() => historyPage(page([{ ...legacy, reason: 'Private reason' }]))).toThrow();
  expect(() => historyPage(page([{ ...governed, recorded_by_user_id: actorId }]))).toThrow();
});
it.each([['effective_from', 'nonsense'], ['effective_to', '2026-02-31']])('rejects malformed legacy SQL date %s without narrowing signed/expanded dates', (field, value) => {
  const legacy = { source: 'legacy_dated_version', id: revisionId, effective_from: '+10000-01-01', effective_to: null, code: '', name: item.name, unit: item.unit, recorded_at: stamp, reason_present: true };
  expect(() => historyPage(page([{ ...legacy, [field]: value }]))).toThrow();
});
