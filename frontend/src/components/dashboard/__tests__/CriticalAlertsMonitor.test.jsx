import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardsApi } from '@/features/dashboards/api';
import { useActiveAlerts, useOverdueMedications } from '@/features/nursing/hooks';
import { toast } from 'sonner';
import CriticalAlertsMonitor from '../CriticalAlertsMonitor';

const state = vi.hoisted(() => ({ rust: true, role: 'doctor' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ facilityCode: 'HMS', user: { id: 'synthetic-staff', role: state.role } }) }));
vi.mock('@/lib/api/v2/runtime', () => ({ isRustV2ApiMode: () => state.rust }));
vi.mock('@/shared/hooks/usePageVisibility', () => ({ usePageVisibility: () => ({ isPageActive: true }) }));
vi.mock('@/features/dashboards/api', () => ({ dashboardsApi: { getAdminDashboard: vi.fn(), getInpatientDashboard: vi.fn() } }));
vi.mock('@/features/dashboards/hooks', async () => {
  const { useAdminDashboard, useInpatientDashboard } = await import('@/hooks/useDashboardQueries');
  return { useAdminDashboard, useInpatientDashboard };
});
vi.mock('@/features/dashboards/hooks/useDoctorDashboardLiveUpdates', () => ({ useDoctorDashboardLiveUpdates: () => ({ isConnected: false }) }));
vi.mock('@/features/nursing/hooks', () => ({ useActiveAlerts: vi.fn(), useOverdueMedications: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

const clients = [];
function renderMonitor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/my-work']}><CriticalAlertsMonitor /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Critical alert monitor supported sources', () => {
  beforeEach(() => {
    state.rust = true;
    state.role = 'doctor';
    dashboardsApi.getAdminDashboard.mockResolvedValue({ urgent: { critical_alerts: [], overdue_medications: [] } });
    dashboardsApi.getInpatientDashboard.mockResolvedValue({ urgent: { critical_alerts: [], overdue_medications: [] } });
    vi.mocked(useActiveAlerts).mockReturnValue({ data: [] });
    vi.mocked(useOverdueMedications).mockReturnValue({ data: [] });
  });
  afterEach(() => {
    clients.splice(0).forEach((client) => client.clear());
  });

  it.each(['doctor', 'inpatient_doctor', 'admin'])('avoids ineffective Rust %s dashboard reads and fabricated toasts', async (role) => {
    state.role = role;
    renderMonitor();
    await act(async () => { await Promise.resolve(); });
    expect(dashboardsApi.getInpatientDashboard).not.toHaveBeenCalled();
    expect(dashboardsApi.getAdminDashboard).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('retains real Rust nurse alert and overdue-medication sources', async () => {
    state.role = 'nurse';
    vi.mocked(useActiveAlerts).mockReturnValue({ data: [{ id: 'synthetic-alert', severity: 'critical', patient_name: 'Synthetic patient', message: 'Synthetic alert' }] });
    vi.mocked(useOverdueMedications).mockReturnValue({ data: [{ id: 'synthetic-dose', patient_name: 'Synthetic patient', medication_name: 'Synthetic medication' }] });
    renderMonitor();
    expect(useActiveAlerts).toHaveBeenCalledWith({ enabled: true });
    expect(useOverdueMedications).toHaveBeenCalledWith({ enabled: true });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(dashboardsApi.getInpatientDashboard).not.toHaveBeenCalled();
    expect(dashboardsApi.getAdminDashboard).not.toHaveBeenCalled();
  });

  it.each(['doctor', 'admin'])('retains legacy %s dashboard monitoring', async (role) => {
    state.rust = false;
    state.role = role;
    renderMonitor();
    const expectedRead = role === 'admin' ? dashboardsApi.getAdminDashboard : dashboardsApi.getInpatientDashboard;
    await waitFor(() => expect(expectedRead).toHaveBeenCalledTimes(1));
  });
});
