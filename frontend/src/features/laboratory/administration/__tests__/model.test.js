// Authored source cases only: compilation/execution is an explicit later gate.
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catalogDetail, catalogPage, commandReceipt, historyPage, normalizeReason, prepareCommand, validateCommand } from '../model';
import { canReadCatalogAdministration, catalogRouteAccess } from '../access';
import { catalogKeys } from '../keys';
import { actorId, otherId, requestId, subject, page, listItem, input, result, manager, stamp } from './fixtures';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
it('admits the sole no-patient catalog manager without a role, demographics or deployment grant', () => {
  expect(canReadCatalogAdministration(manager())).toBe(true); expect(catalogRouteAccess()).toEqual({ roles: [], capabilities: ['laboratory.catalog.manage'] });
  for (const capabilities of [[], ['laboratory.order.manage'], ['laboratory.result.verify']]) expect(canReadCatalogAdministration({ ...manager(), role: 'admin', adminAccess: { capabilities } })).toBe(false);
  expect(canReadCatalogAdministration({ ...manager(), accessContext: { ...manager().accessContext, features: [] } })).toBe(false);
});
it.each(['test', 'panel'])('requires closed %s detail, safe revisions and explicit unknown provenance without private expansion', kind => {
  const value = subject(kind); expect(catalogDetail(value)).toBe(value);
  for (const patch of [{ version: Number.MAX_SAFE_INTEGER + 1 }, { price: '100.00' }, { reason: 'Synthetic private reason' }, { catalog_changed_at: undefined }]) expect(() => catalogDetail(subject(kind, patch))).toThrow();
  expect(() => catalogDetail(value, kind, otherId)).toThrow();
});
it('checks ordering blocker consistency without expanding panel member identities', () => {
  expect(() => catalogDetail(subject('panel', { test_count: 0 }, { is_orderable: false, blocked_by: 'empty_panel' }))).not.toThrow();
  expect(() => catalogDetail(subject('panel', { test_count: 0 }))).toThrow();
  expect(() => catalogDetail(subject('test', {}, { is_orderable: false, blocked_by: 'unavailable_members' }))).toThrow();
});
it('bounds lean directories/history and rejects reason/actor/snapshot leakage', () => {
  expect(catalogPage(page([listItem(subject())])).data).toHaveLength(1);
  expect(() => catalogPage(page([{ ...listItem(subject()), specimen_type: 'Unexpected detail' }]))).toThrow();
  const row = { id: otherId, action: 'set_availability', recorded_at: stamp, before_version: 1, after_version: 1, before_is_active: true, after_is_active: true, changed: false };
  expect(historyPage(page([row])).data[0]).toEqual(row);
  for (const patch of [{ reason: 'Synthetic private reason' }, { recorded_by_user_id: actorId }, { subject: subject() }]) expect(() => historyPage(page([{ ...row, ...patch }]))).toThrow();
});
it('normalizes only surrounding reason whitespace and checks Unicode scalars, bytes and control characters', () => {
  expect(normalizeReason('  Synthetic reason  ')).toBe('Synthetic reason'); expect(normalizeReason('😀'.repeat(1000))).toHaveLength(2000);
  expect(normalizeReason('\u0085Synthetic reason\u0085')).toBe('Synthetic reason'); expect(normalizeReason('\ufeffSynthetic reason\ufeff')).toBe('\ufeffSynthetic reason\ufeff');
  for (const value of [' ', 'x'.repeat(1001), '\ud800', 'Synthetic\nreason', 'Synthetic\u007freason']) expect(() => normalizeReason(value)).toThrow();
});
it('freezes raw reviewed input and source before hashing without accepting mutation after an await', async () => {
  const previous = subject(), proposed = input(previous), pending = prepareCommand(proposed, actorId, previous); proposed.reason = 'Other text'; previous.definition.name = 'Other name';
  const command = await pending; expect(command.input.reason).toBe('Synthetic exact availability reason'); expect(command.previous.definition.name).toBe('Synthetic test definition'); expect(Object.isFrozen(command.input)).toBe(true); await expect(validateCommand(command)).resolves.toEqual(command);
});
it('accepts original no-op panel ordering that changed through a member while preserving exact definition', async () => {
  const previous = subject('panel'), { command, receipt } = await result(input(previous, true), previous, { is_orderable: false, blocked_by: 'unavailable_members' });
  expect(receipt.changed).toBe(false); expect(receipt.subject.definition).toEqual(previous.definition); expect(receipt.subject.ordering).not.toEqual(previous.ordering);
  await expect(commandReceipt(receipt, { requestId, actorId, input: command.input, previous })).resolves.toEqual(receipt);
  receipt.subject.definition.updated_at = receipt.recorded_at; await expect(commandReceipt(receipt, { requestId, actorId, input: command.input, previous })).rejects.toThrow();
});
it.each(['actor', 'request', 'digest', 'kind', 'subject', 'version'])('refuses mismatched original %s rather than accepting current state', async fault => {
  const { command, receipt } = await result();
  if (fault === 'actor') receipt.recorded_by_user_id = otherId;
  if (fault === 'request') receipt.client_request_id = otherId;
  if (fault === 'digest') receipt.input_digest = '0'.repeat(64);
  if (fault === 'kind') receipt.subject.kind = 'panel';
  if (fault === 'subject') receipt.subject.definition.id = otherId;
  if (fault === 'version') receipt.subject.definition.version++;
  await expect(commandReceipt(receipt, { requestId, actorId, input: command.input, previous: command.previous })).rejects.toThrow();
});
it('separates kind/scope and hashes free-text search, cursors, categories and identifiers in query keys', () => {
  const params = { limit: 25, search: 'Synthetic private search', category: 'Synthetic private category', cursor: 'opaque-private-cursor' }, key = catalogKeys.page('scope-A', 'test', params), encoded = JSON.stringify(key);
  for (const value of Object.values(params).filter(value => typeof value === 'string')) expect(encoded).not.toContain(value);
  expect(key).not.toEqual(catalogKeys.page('scope-B', 'test', params)); expect(key).not.toEqual(catalogKeys.page('scope-A', 'panel', params));
});
