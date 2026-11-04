import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { laboratoryRoutes } from '../../routes';
import { resolveSidebarSections } from '@/components/layout/sidebar';
import { SIDEBARS } from '@/app/routes/routeTypes';
import { userCanAccess } from '@/shared/lib/access';
import { classifyLaboratoryCatalogWriteScope } from '@/lib/api/v2/laboratoryCatalogWriteScopes';
import { prepareWriteIntent } from '@/lib/api/v2/writeReplayPolicy';
import { commandWire } from '../commandWire';
import { actorId, otherId, testId, panelId, requestId, manager, result } from './fixtures';
// Production loads runtime-config before the entry module and navigation graph.
const boot = vi.hoisted(() => {
  const runtime = window.__HMS_RUNTIME_CONFIG__;
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  return { runtime };
});
const runtime = boot.runtime;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; });
afterEach(() => { vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
const flatten = sections => { const queue = sections.flatMap(section => section.items), rows = []; while (queue.length) { const row = queue.shift(); rows.push(row); queue.push(...(row.children || [])); } return rows; };
it.each([SIDEBARS.GLOBAL, SIDEBARS.LABORATORY])('makes sole-manager administration reachable through %s navigation and the actual route policy', sidebar => {
  const user = manager(), route = laboratoryRoutes.find(row => row.path === '/laboratory/catalog-administration/*'); expect(userCanAccess(user, route)).toBe(true); expect(route.roles).toEqual([]); expect(route.features).toBeUndefined();
  const rows = flatten(resolveSidebarSections({ sidebar, user, enabledFeatures: undefined, location: { pathname: '/laboratory/catalog-administration/tests' }, params: {}, inboxCount: 0 })); expect(rows.some(row => row.href === '/laboratory/catalog-administration')).toBe(true);
  user.adminAccess.capabilities = ['laboratory.order.manage']; const denied = flatten(resolveSidebarSections({ sidebar, user, enabledFeatures: undefined, location: { pathname: '/' }, params: {}, inboxCount: 0 })); expect(denied.some(row => row.href === '/laboratory/catalog-administration')).toBe(false);
});
it.each(['/api/v2/laboratory/test-administration', '/api/v2/laboratory/panel-administration', `/api/v2/laboratory/test-catalog/${testId}/administration`, `/api/v2/laboratory/panels/${panelId}/history`, '/api/v2/laboratory/catalog-commands/not-a-uuid'])('excludes current or malformed %s from original-result acknowledgment', path => {
  expect(classifyLaboratoryCatalogWriteScope(path)).toEqual({ excludeRead: true });
});
it('uses one cross-kind family and only exact unchanged availability templates', () => {
  const test = classifyLaboratoryCatalogWriteScope(`/api/v2/laboratory/test-catalog/${testId}/availability`), panel = classifyLaboratoryCatalogWriteScope(`/api/v2/laboratory/panels/${panelId}/availability`);
  expect(test.family).toBe(panel.family); expect(test.retryTemplate).toBe('POST /api/v2/laboratory/test-catalog/:id/availability'); expect(panel.retryTemplate).toBe('POST /api/v2/laboratory/panels/:id/availability');
  expect(classifyLaboratoryCatalogWriteScope(`/api/v2/laboratory/panels/${panelId}/metadata`)).toEqual({ excludeRead: true });
});
it('requires the original actor, reviewed digest and actual generated route before reconstructing an exact recovery fingerprint', async () => {
  const { receipt } = await result(), scope = classifyLaboratoryCatalogWriteScope(`/api/v2/laboratory/catalog-commands/${requestId}`);
  expect(await scope.receiptMatches({ data: receipt }, { id: otherId })).toBe(false); const forged = structuredClone(receipt); forged.reviewed_input.reason = 'Changed intent'; expect(await scope.receiptMatches({ data: forged }, { id: actorId })).toBe(false);
  expect(await scope.receiptMatches({ data: receipt }, { id: actorId })).toBe(true); const wire = await commandWire(receipt.reviewed_input), intent = prepareWriteIntent({ path: wire.path, resolvedPath: wire.path, query: {}, body: wire.body }, 'POST');
  expect(await scope.receiptFingerprint({ data: receipt }, async value => value)).toBe(intent.input);
});
