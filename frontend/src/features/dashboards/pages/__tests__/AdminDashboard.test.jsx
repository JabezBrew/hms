import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from '../AdminDashboard';

const state = vi.hoisted(() => ({ rust: true, summary: null }));
const mocks = vi.hoisted(() => ({ workforce: vi.fn(), compliance: vi.fn(), capacity: vi.fn() }));

vi.mock('@/components/layout/layout', () => ({ Layout: ({ children }) => <div>{children}</div> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ facilityCode: 'HMS' }) }));
vi.mock('@/lib/api/v2/runtime', () => ({ isRustV2ApiMode: () => state.rust }));
vi.mock('@/shared/hooks/useAfterInitialPaint', () => ({ useAfterInitialPaint: () => true }));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }));
vi.mock('@/features/dashboards/hooks', () => ({
  useAdminDashboardLiveUpdates: () => ({ isConnected: false }),
  useAdminDashboardV2Summary: () => ({ data: state.summary, isLoading: false, isFetching: false, refetch: vi.fn() }),
  useAdminDashboardV2Capacity: mocks.capacity,
  useAdminDashboardV2Compliance: mocks.compliance,
  useAdminDashboardV2Workforce: mocks.workforce,
  useDashboardModuleGates: () => ({
    hasFeatureMap: true,
    wardsEnabled: true,
    inpatientAdmissionsEnabled: true,
    rostersEnabled: true,
    auditEnabled: true,
    canUse: () => true,
    enabledFeatures: {},
  }),
}));

function query(data) {
  return { data, isLoading: false, isFetching: false, refetch: vi.fn() };
}

function summary(overrides = {}) {
  return {
    metrics: [
      { key: 'active_patients', value: 12 },
      { key: 'waiting_visits', value: 3 },
      { key: 'open_invoices', value: 2 },
    ],
    meta: { generated_at: '2026-10-14T10:00:00Z', stale: false },
    section_summaries: {
      capacity: { status: 'details' },
      workforce: { status: 'unavailable' },
      compliance: { status: 'unavailable' },
    },
    ...overrides,
  };
}

function renderDashboard() {
  return render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
}

function section(name) {
  return within(screen.getByText(name, { selector: '[data-slot="card-title"]' }).closest('[data-slot="card"]'));
}

describe('Admin dashboard measurement availability', () => {
  beforeEach(() => {
    state.rust = true;
    state.summary = summary();
    mocks.capacity.mockReturnValue(query({
      summary: { ward_count: 2, high_occupancy_wards: 1 },
      wait_time: { median_minutes: 8, p95_minutes: 17 },
      wards: [{ ward_id: 'synthetic-ward', ward_name: 'Synthetic ward', occupancy_pct: 90, occupied_beds: 9, total_beds: 10, available_beds: 1 }],
    }));
    mocks.workforce.mockReturnValue(query({ available: false }));
    mocks.compliance.mockReturnValue(query({ available: false }));
  });

  it('shows only available Rust metrics and does not imply unsupported all-clear states', () => {
    renderDashboard();
    for (const [label, value] of [['Active Patients', '12'], ['Waiting Visits', '3'], ['Open Invoices', '2']]) {
      const card = screen.getByText(label).closest('[data-slot="card"]');
      expect(within(card).getByText(value)).toBeInTheDocument();
    }
    expect(screen.queryByText('Bed Occupancy')).not.toBeInTheDocument();
    expect(screen.queryByText('Appointment Throughput')).not.toBeInTheDocument();
    expect(screen.queryByText('Staffing Coverage')).not.toBeInTheDocument();
    expect(screen.queryByText('No critical alerts right now.')).not.toBeInTheDocument();
    expect(screen.queryByText('No pending interventions.')).not.toBeInTheDocument();
    expect(screen.getByText(/Alert summary unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Intervention summary unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('preserves measured zero and omits metrics withheld by the server', () => {
    state.summary = summary({ metrics: [{ key: 'waiting_visits', value: 0 }] });
    renderDashboard();
    expect(screen.getByText('Waiting Visits')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('Active Patients')).not.toBeInTheDocument();
    expect(screen.queryByText('Open Invoices')).not.toBeInTheDocument();
  });

  it('shows a pending first projection and transitions to measured data after refresh', () => {
    state.summary = summary({ metrics: [], meta: { generated_at: null, stale: true, refresh_queued: true } });
    const view = renderDashboard();
    expect(screen.getByText('Preparing operational summary')).toBeInTheDocument();
    expect(screen.getByText(/checks for updates automatically/)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    state.summary = summary();
    view.rerender(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    expect(screen.queryByText('Preparing operational summary')).not.toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('keeps an older measured snapshot visible with its stale warning', () => {
    state.summary = summary({ meta: { generated_at: '2026-10-14T10:00:00Z', stale: true } });
    renderDashboard();
    expect(screen.getByText('STALE READ')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('Preparing operational summary')).not.toBeInTheDocument();
  });

  it('does not treat a permission-filtered empty snapshot as zero activity', () => {
    state.summary = summary({ metrics: [] });
    renderDashboard();
    expect(screen.getByText('No summary metrics available')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps real capacity details and disables unsupported section fetches', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(section('Capacity').getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('Synthetic ward')).toBeInTheDocument();
    expect(screen.getByText('90.0%')).toBeInTheDocument();
    expect(mocks.capacity).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: true }));
    await user.click(section('Workforce').getByRole('button', { name: 'Expand' }));
    await user.click(section('Compliance').getByRole('button', { name: 'Expand' }));
    expect(screen.getByText(/Workforce summary unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Compliance summary unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('All tracked shifts have coverage.')).not.toBeInTheDocument();
    expect(screen.queryByText('No recent compliance events in this window.')).not.toBeInTheDocument();
    expect(mocks.workforce).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    expect(mocks.compliance).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });

  it('preserves legacy KPI cards, time selection and sourced empty states', () => {
    state.rust = false;
    state.summary = {
      kpis: { occupancy: { percent: 80, occupied_beds: 8, total_beds: 10 } },
      meta: { generated_at: '2026-10-14T10:00:00Z' },
    };
    renderDashboard();
    expect(screen.getByText('Bed Occupancy')).toBeInTheDocument();
    expect(screen.getByText('80.0%')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('No critical alerts right now.')).toBeInTheDocument();
    expect(screen.getByText('No pending interventions.')).toBeInTheDocument();
  });
});
