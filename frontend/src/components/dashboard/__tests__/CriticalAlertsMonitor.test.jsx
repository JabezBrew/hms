import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CriticalAlertsMonitor from '../CriticalAlertsMonitor';
const mocks = vi.hoisted(() => ({ alerts: vi.fn(), warning: vi.fn(), error: vi.fn(), navigate: vi.fn() }));
vi.mock('@/features/nursing/hooks', () => ({ useActiveAlerts: (options) => mocks.alerts(options), useOverdueMedications: () => ({ data: [] }) }));
vi.mock('@/features/dashboards/hooks', () => ({ useAdminDashboard: () => ({}), useInpatientDashboard: () => ({}) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { role: 'nurse' } }) }));
vi.mock('@/shared/hooks/usePageVisibility', () => ({ usePageVisibility: () => ({ isPageActive: true }) }));
vi.mock('sonner', () => ({ toast: { warning: (...args) => mocks.warning(...args), error: (...args) => mocks.error(...args) } }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => mocks.navigate }));
beforeEach(() => { vi.clearAllMocks(); });
describe('bounded urgent nursing notification preview', () => {
  it('requests server priority filtering and warns once when more qualifying alerts exist', async () => {
    mocks.alerts.mockReturnValue({ data: [], hasNextPage: true }); const view=render(<MemoryRouter><CriticalAlertsMonitor /></MemoryRouter>);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1)); expect(mocks.alerts).toHaveBeenCalledWith({ enabled: true, criticalOnly: true }); expect(mocks.warning.mock.calls[0][0]).toMatch(/newest page only/);
    mocks.warning.mock.calls[0][1].action.onClick(); expect(mocks.navigate).toHaveBeenCalledWith('/ward-board?view=by-urgency'); view.rerender(<MemoryRouter><CriticalAlertsMonitor /></MemoryRouter>); expect(mocks.warning).toHaveBeenCalledTimes(1);
  });
  it('opens the existing Chronicle through router navigation without a full app reload', async () => {
    mocks.alerts.mockReturnValue({ data: [{ id: 'synthetic-alert', patient_id: 'synthetic-patient', severity: 'critical', patient_name: 'Synthetic clinician fixture', message: 'Synthetic alert' }], hasNextPage: false }); render(<MemoryRouter><CriticalAlertsMonitor /></MemoryRouter>);
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1)); mocks.error.mock.calls[0][1].action.onClick(); expect(mocks.navigate).toHaveBeenCalledWith('/patients/synthetic-patient');
  });
  it('reports a failed preview without re-announcing cached clinical alerts', async () => {
    mocks.alerts.mockReturnValue({ data: [{ id: 'synthetic-old-alert', severity: 'critical', patient_name: 'Synthetic cached name', message: 'Synthetic cached text' }], hasNextPage: false, isError: true });render(<MemoryRouter><CriticalAlertsMonitor /></MemoryRouter>);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1)); expect(mocks.warning.mock.calls[0][0]).toMatch(/could not be refreshed/); expect(mocks.error).not.toHaveBeenCalled();
  });
});
