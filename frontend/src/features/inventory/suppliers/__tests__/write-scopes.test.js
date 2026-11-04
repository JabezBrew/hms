import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { classifyInventorySupplierWriteScope } from '@/lib/api/v2/inventorySupplierWriteScopes';
import { prepareWriteIntent, supportsCommandReplay } from '@/lib/api/v2/writeReplayPolicy';
import { commandWire } from '../commandWire';
import { actorId, otherId, requestId, supplierId, makeResult } from './fixtures';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
it.each(['/api/v2/inventory/suppliers', '/api/v2/inventory/supplier-administration', `/api/v2/inventory/suppliers/${supplierId}/administration`, `/api/v2/inventory/suppliers/${supplierId}/history`, '/api/v2/inventory/supplier-commands/not-a-uuid'])('excludes ordinary or malformed %s from original-result review', path => {
  expect(classifyInventorySupplierWriteScope(path)).toEqual({ excludeRead: true });
});
it('requires the original actor and request, then reconstructs only the matching exact wire fingerprint', async () => {
  const { receipt } = await makeResult(), scope = classifyInventorySupplierWriteScope(`/api/v2/inventory/supplier-commands/${requestId}`);
  expect(scope.family).toBe('api/v2/inventory/suppliers'); expect(scope.receiptRequestId).toBe(requestId);
  expect(await scope.receiptMatches({ data: receipt }, { id: otherId })).toBe(false);
  const forged = structuredClone(receipt); forged.supplier.address = 'Forged'; expect(await scope.receiptMatches({ data: forged }, { id: actorId })).toBe(false);
  expect(await scope.receiptMatches({ data: receipt }, { id: actorId })).toBe(true);
  const wire = commandWire(receipt.reviewed_input), intent = prepareWriteIntent({ path: wire.path, resolvedPath: wire.path, query: {}, body: wire.body }, 'POST');
  const digest = vi.fn(async value => value); expect(await scope.receiptFingerprint({ data: receipt }, digest)).toBe(intent.input);
});
it('permits only the four exact supplier POST templates for unchanged explicit replay', () => {
  for (const route of ['/api/v2/inventory/supplier-administration', '/api/v2/inventory/suppliers/:id/corrections', '/api/v2/inventory/suppliers/:id/retire', '/api/v2/inventory/suppliers/:id/reactivate']) expect(supportsCommandReplay('POST', route)).toBe(true);
  for (const [method, route] of [['PUT', '/api/v2/inventory/suppliers/:id'], ['DELETE', '/api/v2/inventory/suppliers/:id'], ['POST', '/api/v2/inventory/suppliers'], ['POST', '/api/v2/inventory/supplier-commands/:id']]) expect(supportsCommandReplay(method, route)).toBe(false);
});
