import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorDashboard from '../DoctorDashboard';
import ProviderDashboard from '../ProviderDashboard';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

const { legacyDoctor } = vi.hoisted(() => ({ legacyDoctor: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ facilityCode: 'TEST', user: { id: 'staff-1', role: 'doctor' } }) }));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }));
vi.mock('@/features/dashboards/hooks', async (importOriginal) => ({
  ...await importOriginal(),
  useDashboardModuleGates: () => ({ hasFeatureMap: true, isResolving: false, canUse: () => true, outpatientEncountersEnabled: true, appointmentsEnabled: true, patientChronicleEnabled: true, referralsEnabled: true }),
  useDoctorDashboard: legacyDoctor,
  useDoctorDashboardLiveUpdates: () => ({ isConnected: false }),
}));
function Location() { const location = useLocation(); return <output>{location.pathname}</output>; }
function renderLanding(Component, route) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[route]}><Component /><Location /></MemoryRouter></QueryClientProvider>);
}
function workResponse() {
  return new Response(JSON.stringify({ data: {
    outpatient: {
      active_visits: [{ id: 'visit-1', encounter_id: 'encounter-1', patient_id: 'patient-1', patient_display_name: 'Real work fixture', status: 'waiting' }],
      appointments: Array.from({ length: 5 }, (_, index) => ({ id: `appointment-${index}`, patient_id: `scheduled-${index}`, patient_display_name: `Scheduled fixture ${index}` })),
      has_more_active_visits: false, has_more_appointments: false,
    },
    inpatient: { assigned_wards: [{ assignment_id: 'assignment-1', ward_id: 'ward-1', ward_name: 'Assigned ward fixture' }] },
    emergency: { assigned_triage: [], waiting_triage: [] }, patient_context: { recent_patients: [] },
  } }), { status: 200, headers: { 'content-type': 'application/json' } });
}
const originalFetch = globalThis.fetch;
describe('Clinical dashboard compatibility URLs', () => {
  beforeEach(() => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    __resetV2ApiClientForTests();
    configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'TEST' });
    globalThis.fetch = vi.fn().mockImplementation(async () => workResponse());
    legacyDoctor.mockReturnValue({ data: { date: '2026-10-14', waiting_room: [], upcoming: [], completed: [], current_patient: null }, loading: false, isFetching: false, refetch: vi.fn() });
  });
  afterEach(() => { delete window.__HMS_RUNTIME_CONFIG__; __resetV2ApiClientForTests(); globalThis.fetch = originalFetch; });

  it.each([[DoctorDashboard, '/dashboard/doctor'], [ProviderDashboard, '/dashboard/provider']])('renders actual scoped My Work at the compatibility URL', async (Component, route) => {
    renderLanding(Component, route);
    expect(await screen.findByRole('link', { name: /Real work fixture/ }, { timeout: 5000 })).toHaveAttribute('href', '/patients/patient-1?visit=encounter-1');
    expect(screen.getByRole('link', { name: /Assigned ward fixture/ })).toHaveAttribute('href', '/wards/ward-1/board');
    expect(screen.getByRole('heading', { name: 'My Work', exact: true })).toBeInTheDocument();
    expect(screen.getByText('More in Outpatient')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(route);
    expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8080/api/v2/care-areas/my-work', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(legacyDoctor).not.toHaveBeenCalled();
    for (const text of ['Sarah Johnson', 'Elevated Potassium (5.8)', 'No Current Patient', 'Command Center']) expect(screen.queryByText(text)).not.toBeInTheDocument();
  });

  it('allows a failed real work read to be refreshed without showing fake empty work', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'unavailable', message: 'Work unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } }));
    const user = userEvent.setup();
    renderLanding(ProviderDashboard, '/dashboard/provider');
    expect(await screen.findAllByText('Current work unavailable')).not.toHaveLength(0);
    expect(screen.queryByText('No current items')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh work' }));
    expect(await screen.findByRole('link', { name: /Real work fixture/ })).toBeInTheDocument();
  });

  it.each([[DoctorDashboard, "Today's Clinic"], [ProviderDashboard, 'Command Center']])('preserves the legacy implementation outside Rust mode', async (Component, heading) => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    renderLanding(Component, '/legacy-dashboard');
    expect(screen.getByRole('heading', { name: heading, exact: true })).toBeInTheDocument();
    await waitFor(() => expect(globalThis.fetch).not.toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'My Work', exact: true })).not.toBeInTheDocument();
  });
});
