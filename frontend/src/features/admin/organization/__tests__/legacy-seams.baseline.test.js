import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { userCanAccess } from '@/shared/lib/access';
import { clinicalUnitsApi } from '@/lib/api/organization';
import { organizationApi } from '../api';
const sdk = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/api/v2/client', () => ({ v2Api: { getAdminOrgUnits: sdk.list, getAdminOrgUnitById: sdk.get, postAdminOrgUnits: sdk.create } }));
const runtime = window.__HMS_RUNTIME_CONFIG__;
const unit = { id: '20202020-2020-4020-8020-000000000001', code: 'SYNTHETIC-SERVICE', name: 'Synthetic specialist service', unit_type: 'service', parent_unit_id: '20202020-2020-4020-8020-000000000002', parent_unit_name: 'Synthetic parent outside this page', is_active: true, created_at: '2026-10-17T09:00:00Z', updated_at: '2026-10-17T09:00:00Z', version: 1 };
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; vi.clearAllMocks(); });
afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime; });
async function route() { vi.resetModules(); return (await import('@/features/admin/routes')).adminRoutes.find(value => value.path === '/admin/organization'); }
it('admits the real Rust organization authority without depending on an administrator role', async () => {
  const value = await route(); expect(userCanAccess({ role: 'doctor', adminAccess: { capabilities: ['admin.authority.manage'] } }, value)).toBe(true); expect(value.features).toEqual(['admin']);
});
it('refuses an administrator role without the real Rust organization authority', async () => { expect(userCanAccess({ role: 'admin', adminAccess: { capabilities: [] } }, await route())).toBe(false); });
it('preserves the explicit legacy administrator route contract', async () => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }; expect(userCanAccess({ role: 'admin' }, await route())).toBe(true); });
it('preserves bounded cursor metadata and the actual parent label instead of making an unloaded parent a root', async () => {
  const page = { limit: 25, has_next: true, next_cursor: 'synthetic-next-page' }; sdk.list.mockResolvedValueOnce({ data: [unit], page }); const result = await organizationApi.list({ limit: 25 }); expect(result.page).toEqual(page); expect(result.data[0].parent_unit_id).toBe(unit.parent_unit_id); expect(result.data[0].parent_unit_name).toBe(unit.parent_unit_name);
});
it('preserves a real current unit read as a supported baseline control', async () => { sdk.get.mockResolvedValueOnce({ data: unit }); expect((await clinicalUnitsApi.get(unit.id)).id).toBe(unit.id); });
it('preserves AbortError and signal in a bounded unit read', async () => {
  const controller = new AbortController(), error = new DOMException('Synthetic cancelled request', 'AbortError'); sdk.list.mockRejectedValueOnce(error); await expect(clinicalUnitsApi.list({ limit: 25 }, { signal: controller.signal })).rejects.toBe(error); expect(sdk.list.mock.calls[0][0].signal).toBe(controller.signal);
});
