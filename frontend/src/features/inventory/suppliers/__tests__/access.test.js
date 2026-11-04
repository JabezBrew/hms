import { afterEach, expect, it, vi } from 'vitest';
import { SIDEBARS } from '@/app/routes/routeTypes';
import { inventoryRoutes } from '../../routes';
import { canManageSuppliers, canReadSuppliers } from '../access';
import { supplierKeys } from '../keys';
import { actorId, supplierId } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime; });
const reader = { id: actorId, role: 'ordinary', adminAccess: { capabilities: ['system.deployment_capabilities.view', 'inventory.view', 'patient.demographics.view'] }, accessContext: { facility_id: supplierId, active_profile: 'hospital', patient_visibility: ['demographics'], features: ['inventory'] } };
it('requires every actual read fact and separate manage authority without deriving permissions from role', () => {
  expect(canReadSuppliers(reader)).toBe(true); expect(canManageSuppliers(reader)).toBe(false);
  for (const capability of reader.adminAccess.capabilities) expect(canReadSuppliers({ ...reader, role: 'admin', adminAccess: { capabilities: reader.adminAccess.capabilities.filter(value => value !== capability) } })).toBe(false);
  expect(canReadSuppliers({ ...reader, accessContext: { ...reader.accessContext, features: [] } })).toBe(false);
  expect(canReadSuppliers({ ...reader, accessContext: { ...reader.accessContext, patient_visibility: [] } })).toBe(false);
  expect(canManageSuppliers({ ...reader, adminAccess: { capabilities: [...reader.adminAccess.capabilities, 'inventory.manage'] } })).toBe(true);
});
const leaves = sections => sections.flatMap(section => section.items.flatMap(item => [item, ...(item.children ?? [])]));
it('exposes the lazy supplier route and both navigation leaves to an ordinary view-only inventory reader', async () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
  vi.resetModules(); const { resolveSidebarSections } = await import('@/components/layout/sidebar');
  expect(inventoryRoutes.find(route => route.path === '/inventory/suppliers/*')).toMatchObject({ roles: [], capabilities: ['inventory.view'], features: ['inventory'], sidebar: SIDEBARS.INVENTORY });
  for (const sidebar of [SIDEBARS.GLOBAL, SIDEBARS.INVENTORY]) {
    const items = leaves(resolveSidebarSections({ sidebar, user: reader, enabledFeatures: { inventory: true }, location: { pathname: '/inventory/suppliers' }, params: {} }));
    expect(items.some(item => item.href === '/inventory/suppliers')).toBe(true);
    expect(items.some(item => item.href === '/inventory/transfers')).toBe(true);
  }
});
it('keeps supplier maintenance out of legacy navigation and private free text/cursors/IDs out of query keys', async () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
  vi.resetModules(); const { resolveSidebarSections } = await import('@/components/layout/sidebar');
  expect(leaves(resolveSidebarSections({ sidebar: SIDEBARS.INVENTORY, user: reader, enabledFeatures: { inventory: true }, params: {}, location: { pathname: '/' } })).some(item => item.href === '/inventory/suppliers')).toBe(false);
  const values = [supplierKeys.page('scope', { limit: 25, search: 'Private search sentinel', cursor: 'private-cursor-sentinel' }), supplierKeys.detail('scope', supplierId)];
  expect(JSON.stringify(values)).not.toContain('Private search sentinel'); expect(JSON.stringify(values)).not.toContain('private-cursor-sentinel'); expect(JSON.stringify(values)).not.toContain(supplierId);
  expect(supplierKeys.page('scope-B', { limit: 25 })).not.toEqual(supplierKeys.page('scope', { limit: 25 }));
});
