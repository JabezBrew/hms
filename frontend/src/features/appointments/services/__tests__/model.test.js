import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commandReceipt, inputDigest, prepareCommand, reviewedInput, servicePage, serviceState, validDuration, validName, validateCommand } from '../model';
import { actorId, ids, requestId, service, envelope, makeCommand, makeReceipt } from './fixtures';
beforeEach(() => vi.stubGlobal('crypto', webcrypto)); afterEach(() => vi.unstubAllGlobals());
it.each(['create', 'metadata', 'retire', 'reactivate'])('validates actual %s original evidence', async action => { const command = await makeCommand(action, { ...service, is_active: action !== 'reactivate' }); const receipt = await makeReceipt(command); expect(await commandReceipt(receipt, { requestId, actorId, input: command.input, previous: command.previous })).toEqual(receipt); });
it.each(['metadata', 'retire', 'reactivate'])('accepts an exact %s no-op without a version increment', async action => { const previous = { ...service, is_active: action !== 'retire' }; const input = { action, client_request_id: requestId, service_id: service.id, expected_version: 1, ...(action === 'metadata' ? { name: service.name, default_duration_minutes: service.default_duration_minutes } : {}) }; const command = await prepareCommand(input, actorId, previous); expect((await commandReceipt(await makeReceipt(command, false), { requestId, actorId, input, previous })).changed).toBe(false); });
it.each(['code', 'created_at', 'is_active'])('rejects unrelated %s changes in metadata evidence', async field => { const command = await makeCommand(), receipt = await makeReceipt(command); receipt.service[field] = field === 'is_active' ? false : field === 'created_at' ? '2026-10-18T01:00:00Z' : 'OTHER'; await expect(commandReceipt(receipt, { requestId, actorId, input: command.input, previous: service })).rejects.toBeDefined(); });
it.each(['actor', 'request', 'digest', 'duration', 'version', 'extra-input', 'extra-state'])('rejects original receipt %s corruption', async kind => { const command = await makeCommand(), receipt = await makeReceipt(command); if (kind === 'actor') receipt.recorded_by_user_id = ids[9]; if (kind === 'request') receipt.client_request_id = ids[9]; if (kind === 'digest') receipt.input_digest = '0'.repeat(64); if (kind === 'duration') receipt.service.default_duration_minutes = 12; if (kind === 'version') receipt.service.version = 7; if (kind === 'extra-input') receipt.reviewed_input = { ...receipt.reviewed_input, unsupported: true }; if (kind === 'extra-state') receipt.service.unsupported = true; await expect(commandReceipt(receipt, { requestId, actorId, input: command.input, previous: service })).rejects.toBeDefined(); });
it.each([null, {}, { action: 'delete', client_request_id: requestId }, { action: 'metadata', client_request_id: requestId, service_id: service.id, expected_version: 1, name: 'Missing duration' }])('refuses malformed reviewed input %#', input => expect(() => reviewedInput(input)).toThrow());
it.each([0, -1, 1.5, 1441, '30', NaN])('does not normalize unsupported duration %s', duration => expect(validDuration(duration)).toBe(false));
it('enforces bytes and exact names while keeping historical positive duration integers readable', () => { expect(validName('é'.repeat(80))).toBe(true); expect(validName('é'.repeat(81))).toBe(false); expect(validName(' name ')).toBe(false); expect(validName('control\u0001')).toBe(false); expect(serviceState({ ...service, default_duration_minutes: 1441 }).default_duration_minutes).toBe(1441); });
it('keeps a bounded page and opaque next cursor without duplicate IDs', () => { expect(servicePage(envelope([service], 'opaque')).page.next_cursor).toBe('opaque'); expect(() => servicePage(envelope([service, service]))).toThrow(); expect(() => servicePage(envelope(Array.from({ length: 26 }, () => service)))).toThrow(); });
it('rejects a command changed after the explicit review digest', async () => { const command = await makeCommand(); command.input.default_duration_minutes = 90; await expect(validateCommand(command)).rejects.toBeDefined(); });
it('uses canonical recursive sorted-key digest bytes', async () => { expect(await inputDigest({ b: { z: 2, a: 1 }, a: 4 })).toBe(await inputDigest({ a: 4, b: { a: 1, z: 2 } })); });
it('does not require recorded_at to follow updated_at', async () => { const command = await makeCommand(); const receipt = await makeReceipt(command); receipt.service.updated_at = '2026-10-18T00:01:00Z'; expect((await commandReceipt(receipt, { requestId, actorId, input: command.input, previous: service })).service.version).toBe(2); });
it.each([1, 2147483647])('keeps actual historical positive int32 duration %s readable', duration => { expect(serviceState({ ...service, default_duration_minutes: duration }).default_duration_minutes).toBe(duration); });
it.each([-2147483649, 2147483648])('rejects an alleged historical duration %s outside the actual int32 wire type', duration => { expect(() => serviceState({ ...service, default_duration_minutes: duration })).toThrow(); });
it.each([false, true])('an exact no-op preserves updated_at, changed timestamp=%s', async changed => { const input = { action: 'metadata', client_request_id: requestId, service_id: service.id, expected_version: 1, name: service.name, default_duration_minutes: service.default_duration_minutes }, command = await prepareCommand(input, actorId, service), receipt = await makeReceipt(command, false); if (changed) receipt.service.updated_at = '2026-10-18T00:01:00Z'; const result = commandReceipt(receipt, { requestId, actorId, input, previous: service }); if (changed) await expect(result).rejects.toBeDefined(); else expect((await result).changed).toBe(false); });
it.each([0, -1])('rejects duration %s forbidden by the retained database constraint', duration => { expect(() => serviceState({ ...service, default_duration_minutes: duration })).toThrow(); });
it.each([1, 1441, 2147483647])('keeps retained positive duration %s readable beyond the new-command limit', duration => { expect(serviceState({ ...service, default_duration_minutes: duration }).default_duration_minutes).toBe(duration); });

it.each([['', ''], [' ', '  ']])('preserves exact legacy strings in correction and lifecycle receipts code=%j name=%j', async (code, name) => {
  const previous = { ...service, code, name, default_duration_minutes: 2000 };
  expect(serviceState(previous)).toEqual(previous);
  for (const action of ['metadata', 'retire']) {
    const command = await makeCommand(action, previous), receipt = await makeReceipt(command);
    expect((await commandReceipt(receipt, { requestId, actorId, input: command.input, previous })).service.code).toBe(code);
    expect(command.previous).toEqual(previous);
  }
});
it.each(['create', 'metadata'])('keeps new %s names and durations strict when legacy snapshots are readable', action => {
  const input = action === 'create' ? { action, client_request_id: requestId, code: 'NEW_CODE', name: 'Supported name', default_duration_minutes: 30 } : { action, client_request_id: requestId, service_id: service.id, expected_version: 1, name: 'Supported name', default_duration_minutes: 30 };
  for (const name of ['', '  ']) expect(() => reviewedInput({ ...input, name })).toThrow();
  expect(() => reviewedInput({ ...input, default_duration_minutes: 2000 })).toThrow();
  if (action === 'create') for (const code of ['', ' ']) expect(() => reviewedInput({ ...input, code })).toThrow();
});
it.each(['code', 'name'])('rejects nonstring historical %s values', field => { for (const value of [null, 1, {}, []]) expect(() => serviceState({ ...service, [field]: value })).toThrow(); });

it.each([123, ['CODE']])('does not coerce a nonstring new immutable code %j', code => {
  expect(() => reviewedInput({ action: 'create', client_request_id: requestId, code, name: 'Synthetic supported service', default_duration_minutes: 30 })).toThrow();
});
it('retains a numeric-looking string as an exact valid permanent code', () => { const input = { action: 'create', client_request_id: requestId, code: '123', name: 'Synthetic supported service', default_duration_minutes: 30 }; expect(reviewedInput(input).code).toBe('123'); });
