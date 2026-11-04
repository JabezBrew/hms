// Route-unit regression: real auth shaping and RoleBasedRoute. The synthetic
// AuthContext does not prove native authentication, patient access or clocks.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { RoleBasedRoute } from '@/components/auth/RoleBasedRoute';
import { AuthContext } from '@/lib/auth/AuthContext';
import { adaptV2AuthTokenResponse } from '@/lib/api/auth';
import { providerUser } from '@/features/auth/providerUser';

const previousRuntime = window.__HMS_RUNTIME_CONFIG__;
const readPermissions = ['patient.demographics.view', 'clinical_documentation.view', 'clinical_documentation.manage'];
const mixedPermissions = [...readPermissions, 'laboratory.order.manage', 'system.deployment_capabilities.view'];

function actualAdapterUser(permissions) {
  const adapted = adaptV2AuthTokenResponse({ data: {
    access_token: 'synthetic-route-unit-adapter-input', expires_in_seconds: 600,
    user: { id: '27272727-0000-4000-8000-000000000001', email: 'synthetic-route@example.invalid', display_name: 'Synthetic route actor',
      facility_id: '27272727-0000-4000-8000-000000000002', facility_code: 'SYNTHETIC', active_profile: 'hospital',
      permissions, features: ['patients', 'encounters', 'laboratory'], patient_visibility: ['demographics', 'full_clinical'],
      session_version: 1, permission_version: 1, auth_security: null },
  } });
  return providerUser(adapted, 'SYNTHETIC');
}

async function routeFor(mode, path = '/patients/:id/chronicle') {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: mode };
  vi.resetModules();
  const { patientRoutes } = await import('../routes');
  const route = patientRoutes.find(item => item.path === path);
  expect(route).toBeDefined();
  return route;
}

function gateTree(route, user, isAuthenticated = true) {
  return <AuthContext.Provider value={{ user, isAuthenticated }}><MemoryRouter initialEntries={['/gate']}><Routes>
    <Route path="/gate" element={<RoleBasedRoute allowedRoles={route.roles} allowedCapabilities={route.capabilities}>
      <p>Chronicle route admitted</p>
    </RoleBasedRoute>} />
    <Route path="/login" element={<p>Login required</p>} />
    <Route path="/unauthorized" element={<p>Route denied</p>} />
  </Routes></MemoryRouter></AuthContext.Provider>;
}
const mountGate = (route, user, isAuthenticated = true) => render(gateTree(route, user, isAuthenticated));

afterEach(() => { cleanup(); window.__HMS_RUNTIME_CONFIG__ = previousRuntime; vi.resetModules(); });

it.each(['rust-v2', 'v2'])('admits the actual mixed clinical/laboratory adapter identity in %s through current read capability', async mode => {
  const route = await routeFor(mode), user = actualAdapterUser(mixedPermissions);
  expect(user.role).toBe('lab_technician'); // Keep the actual lossy inference unchanged.
  expect(user.adminAccess.capabilities).toContain('clinical_documentation.view');
  expect(route.roles).not.toContain('lab_technician');
  expect(route.features).toEqual(['patient_chronicle']);
  mountGate(route, user);
  expect(screen.getByText('Chronicle route admitted')).toBeInTheDocument();
});

it('keeps a lab-only ordinary adapter identity denied', async () => {
  const route = await routeFor('rust-v2');
  const user = actualAdapterUser(['patient.demographics.view', 'laboratory.order.manage', 'system.deployment_capabilities.view']);
  expect(user.role).toBe('lab_technician'); mountGate(route, user);
  expect(screen.getByText('Route denied')).toBeInTheDocument();
  expect(screen.queryByText('Chronicle route admitted')).not.toBeInTheDocument();
});

it('does not substitute clinical manage for the actual clinical-read capability', async () => {
  const route = await routeFor('rust-v2');
  mountGate(route, actualAdapterUser(['patient.demographics.view', 'clinical_documentation.manage', 'laboratory.order.manage']));
  expect(screen.getByText('Route denied')).toBeInTheDocument();
});

it.each([
  { permissions: ['laboratory.catalog.manage'] },
  { permissions: ['laboratory.order.manage', 'clinical_documentation.view_all'] },
  { permissions: ['laboratory.order.manage', 'clinical_documentation.view '] },
])('does not infer clinical-read access from unrelated or near-match capabilities $permissions', async ({ permissions }) => {
  const route = await routeFor('rust-v2');
  const user = actualAdapterUser(['patient.demographics.view', ...permissions]);
  expect(user.role).toBe('lab_technician'); mountGate(route, user);
  expect(screen.getByText('Route denied')).toBeInTheDocument();
});

it('requires authentication even when the shaped user has current read capability', async () => {
  const route = await routeFor('rust-v2'); mountGate(route, actualAdapterUser(mixedPermissions), false);
  expect(screen.getByText('Login required')).toBeInTheDocument();
  expect(screen.queryByText('Chronicle route admitted')).not.toBeInTheDocument();
});

it('removes the alternative when the authenticated actor loses its clinical-read capability', async () => {
  const route = await routeFor('rust-v2'), view = mountGate(route, actualAdapterUser(mixedPermissions));
  expect(screen.getByText('Chronicle route admitted')).toBeInTheDocument();
  view.rerender(gateTree(route, actualAdapterUser(mixedPermissions.filter(permission => permission !== 'clinical_documentation.view'))));
  expect(screen.getByText('Route denied')).toBeInTheDocument();
});

it('preserves the legacy inferred-role gate for a mixed laboratory identity', async () => {
  const route = await routeFor('django'); expect(route.capabilities).toBeUndefined();
  mountGate(route, actualAdapterUser(mixedPermissions)); expect(screen.getByText('Route denied')).toBeInTheDocument();
});

it.each(['django', 'rust-v2'])('preserves the existing doctor-role admission in %s', async mode => {
  const route = await routeFor(mode), user = actualAdapterUser(readPermissions);
  expect(user.role).toBe('doctor'); mountGate(route, user);
  expect(screen.getByText('Chronicle route admitted')).toBeInTheDocument();
});

it.each(['/patients/:id/chronicle/print', '/patients/:id/ward-round', '/patients', '/patients/:id/edit'])('preserves the separate role admission for %s', async path => {
  const route = await routeFor('rust-v2', path);
  expect(route.capabilities).toBeUndefined(); expect(route.roles).not.toContain('lab_technician');
  mountGate(route, actualAdapterUser(mixedPermissions)); expect(screen.getByText('Route denied')).toBeInTheDocument();
});

// Exact least-privilege read admits only the shell; downstream access is separate.
it('admits exact clinical read without manage, ordering or an inferred clinical role', async () => {
  const route = await routeFor('rust-v2'), user = actualAdapterUser(['clinical_documentation.view']);
  expect(user.role).toBe('staff'); expect(user.adminAccess.capabilities).toEqual(['clinical_documentation.view']);
  mountGate(route, user); expect(screen.getByText('Chronicle route admitted')).toBeInTheDocument();
});

it('does not grant capabilities from non-array adapter permissions', async () => {
  const route = await routeFor('rust-v2'), user = actualAdapterUser('clinical_documentation.view');
  expect(user.role).toBe('staff'); expect(user.adminAccess.capabilities).toEqual([]);
  mountGate(route, user); expect(screen.getByText('Route denied')).toBeInTheDocument();
});
