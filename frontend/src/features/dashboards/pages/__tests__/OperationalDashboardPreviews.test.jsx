import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InpatientDoctorDashboard from '../InpatientDoctorDashboard';
import ReceptionistDashboard from '../ReceptionistDashboard';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

const { state } = vi.hoisted(() => ({ state: { disabled: false, deniedBoard: false, deniedBilling: false, missingSignals: false, checkedIn: false } }));
vi.mock('@/components/layout/layout', () => ({ Layout: ({ children }) => <main>{children}</main> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ facilityCode: 'TEST', user: { id: 'staff-1', role: 'admin' } }) }));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/dashboards/hooks', async (importOriginal) => ({
  ...await importOriginal(),
  useDashboardModuleGates: () => ({ hasFeatureMap: true, isResolving: false, canUse: () => !state.disabled, inpatientAdmissionsEnabled: true, nursingWorkflowsEnabled: !state.disabled, dischargeWorkflowsEnabled: !state.disabled, patientChronicleEnabled: true, appointmentsEnabled: true, patientRegistrationEnabled: !state.disabled, billingEnabled: !state.disabled }),
  useInpatientDashboardLiveUpdates: () => ({ isConnected: false }), useReceptionDashboardLiveUpdates: () => ({ isConnected: false }),
}));
function response(data, page = {}) { return new Response(JSON.stringify({ data, page: { limit: 20, has_next: true, next_cursor: 'more', ...page } }), { status: 200, headers: { 'content-type': 'application/json' } }); }
function denied() { return new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Unavailable' } }), { status: 403, headers: { 'content-type': 'application/json' } }); }
const originalFetch = globalThis.fetch;
function renderDashboard(Component) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><Component /></MemoryRouter></QueryClientProvider>);
}
describe('Operational dashboard source truth', () => {
  beforeEach(() => {
    Object.assign(state, { disabled: false, deniedBoard: false, deniedBilling: false, missingSignals: false, checkedIn: false });
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'TEST' });
    globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/wards/board')) return state.deniedBoard ? denied() : response([{ admission_id: 'admission-1', patient_id: 'patient-1', patient_display_name: 'Ward patient fixture', patient_code: 'TEST', ward_name: 'Ward fixture', bed_code: 'B1', ...(state.missingSignals ? {} : { active_alert_count: 3, critical_alert_count: 1, unverified_result_count: 2, critical_unverified_result_count: 1, overdue_nursing_task_count: 1, due_medication_count: 4 }) }]);
      if (path.endsWith('/discharges')) return response([{ id: 'discharge-1', admission_case_id: 'admission-1', patient_id: 'patient-1', patient_display_name: 'Discharge patient fixture', status: 'completed', discharged_at: '2025-01-01T08:00:00Z' }]);
      if (path.endsWith('/nursing/tasks')) return response([{ id: 'task-1', status: 'completed' }]);
      if (path.endsWith('/appointments')) return response([{ id: 'appointment-1', patient_id: 'patient-1', clinic_id: 'clinic-1', patient_display_name: 'Appointment patient fixture', starts_at: '2026-10-14T08:00:00Z', status: state.checkedIn ? 'checked_in' : 'scheduled' }], { limit: 50 });
      if (path.endsWith('/patients')) return response([{ id: 'patient-2', display_name: 'Directory patient fixture', patient_code: 'TEST', created_at: '2020-01-01T08:00:00Z' }], { limit: 10 });
      if (path.endsWith('/billing/dashboard-summary')) return state.deniedBilling ? denied() : response({ open_invoices: 6 });
      if (path.endsWith('/visits/check-in')) { state.checkedIn = true; expect(JSON.parse(options.body)).toEqual({ appointment_id: 'appointment-1', patient_id: 'patient-1', clinic_id: 'clinic-1' }); return response({ id: 'visit-1', status: 'waiting' }); }
      throw new Error(`Unexpected synthetic route ${path}`);
    });
  });
  afterEach(() => { delete window.__HMS_RUNTIME_CONFIG__; __resetV2ApiClientForTests(); globalThis.fetch = originalFetch; });

  it('shows real ward attention counts without stable, personal-census or today claims', async () => {
    renderDashboard(InpatientDoctorDashboard);
    expect(await screen.findByText('Ward patient fixture')).toBeInTheDocument();
    for (const text of ['Critical alerts: 1', 'Active alerts: 3', 'Unverified results: 2', 'Medication doses due: 4']) expect(screen.getByText(text)).toBeInTheDocument();
    screen.getAllByRole('link', { name: 'Open Chronicle', exact: true }).forEach((link) => expect(link).toHaveAttribute('href', '/patients/patient-1?admission=admission-1'));
    expect(screen.getByText('Discharge patient fixture')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getAllByText(/More work available/)).not.toHaveLength(0);
    for (const text of ['New Admissions', 'My Patients', 'DISCHARGE TODAY', 'No diagnosis recorded', 'stable']) expect(screen.queryByText(text, { exact: false })).not.toBeInTheDocument();
  });

  it('preserves supported inpatient work when the house-board read is forbidden', async () => {
    state.deniedBoard = true;
    renderDashboard(InpatientDoctorDashboard);
    expect(await screen.findByText('Discharge patient fixture')).toBeInTheDocument();
    expect(screen.getByText(/This preview is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('No patients shown in this ward preview.')).not.toBeInTheDocument();
    expect(screen.queryByText('Ward patient fixture')).not.toBeInTheDocument();
  });

  it('does not manufacture zero alert counts when board signals were not supplied', async () => {
    state.missingSignals = true;
    renderDashboard(InpatientDoctorDashboard);
    expect(await screen.findByText('Board signals unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Active alerts: 0')).not.toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).not.toHaveLength(0);
  });

  it('labels partial reception lists truthfully and checks in with real patient and clinic context', async () => {
    const user = userEvent.setup(); renderDashboard(ReceptionistDashboard);
    expect(await screen.findByText('Appointment patient fixture')).toBeInTheDocument();
    expect(screen.getByText('Directory patient fixture')).toBeInTheDocument();
    expect(screen.getByText('Patient Directory preview')).toBeInTheDocument();
    expect(screen.queryByText('New Registrations')).not.toBeInTheDocument();
    expect(screen.queryByText('All patients checked in')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', '/patients/patient-2/profile');
    await user.click(screen.getByRole('button', { name: 'Check In', exact: true }));
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(([url]) => url.endsWith('/visits/check-in'))).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Check In', exact: true })).not.toBeInTheDocument());
  });

  it('keeps reception appointments visible when billing is forbidden and skips disabled-module reads', async () => {
    state.deniedBilling = true;
    const view = renderDashboard(ReceptionistDashboard);
    expect(await screen.findByText('Appointment patient fixture')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    view.unmount(); globalThis.fetch.mockClear(); state.disabled = true;
    renderDashboard(ReceptionistDashboard);
    expect(await screen.findByText('Appointment patient fixture')).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls.every(([url]) => new URL(url).pathname.endsWith('/appointments'))).toBe(true);
  });
});
