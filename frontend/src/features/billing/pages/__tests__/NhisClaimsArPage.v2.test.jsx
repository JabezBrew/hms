import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NhisClaimsArPage from '../NhisClaimsArPage';

const refetch = vi.fn();

vi.mock('@/features/billing/api', () => ({
  billingApi: {
    downloadNhisExportJob: vi.fn(),
  },
}));

vi.mock('@/features/billing/hooks', () => ({
  useNhisClaimBatches: () => ({
    data: {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 'batch-1',
          period_start: '2026-05-01',
          period_end: '2026-05-07',
          created_at: '2026-05-08',
          status: 'exported',
          claim_count: 2,
          total_claimed_amount: 100,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch,
  }),
  useCreateNhisClaimBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLintNhisClaimBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExportNhisClaimBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useNhisExportJobs: () => ({
    data: {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 'export-1',
          batch: 'batch-1',
          status: 'ready',
          created_at: '2026-05-08',
          expires_at: '2026-05-15',
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch,
  }),
  useInsuranceProviders: () => ({
    data: {
      results: [{ id: 'payer-1', name: 'NHIS', payer_type: 'nhis' }],
    },
    refetch,
  }),
  useRemittanceImportJobs: () => ({
    data: {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 'remit-1',
          created_at: '2026-05-08',
          payer_name: 'NHIS',
          file_name: 'remittance.csv',
          status: 'ready',
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch,
  }),
  useImportRemittance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemittanceLines: () => ({ data: { count: 0, results: [] }, isLoading: false }),
  useInsuranceAging: () => ({ data: {}, refetch }),
  useInsuranceDSO: () => ({ data: {}, refetch }),
  useRemittanceQueue: () => ({ data: { summary: [] }, refetch }),
}));

vi.mock('@/components/ui/VirtualizedTable', () => ({
  VirtualizedTable: ({ rows = [], columns = [] }) => (
    <div>
      {rows.map((row) => (
        <div key={row.id}>
          {columns.map((column) => (
            <div key={column.key}>{column.render ? column.render(row) : row[column.key]}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(route = '/billing/nhis') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <NhisClaimsArPage />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe('NhisClaimsArPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('hides unsupported NHIS batch, export download, and remittance import controls in Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    const user = userEvent.setup();

    renderPage();

    expect(screen.queryByRole('button', { name: /create batch/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/period-based nhis batch creation is not available in rust v2/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /exports/i }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/billing/nhis?tab=exports');
    expect(screen.queryByRole('button', { name: /download zip/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/nhis export zip downloads are not available in rust v2/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /remittances/i }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/billing/nhis?tab=remittances');
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Import Remittance')).not.toBeInTheDocument();
    expect(
      screen.getByText(/remittance file import is not available in rust v2/i),
    ).toBeInTheDocument();
    expect(screen.getByText('remittance.csv')).toBeInTheDocument();
  });

  it('keeps NHIS controls available outside Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    const user = userEvent.setup();

    renderPage();

    expect(screen.getByRole('button', { name: /create batch/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /exports/i }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/billing/nhis?tab=exports');
    expect(screen.getByRole('button', { name: /download zip/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /remittances/i }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/billing/nhis?tab=remittances');
    expect(screen.getByText('Import Remittance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument();
  });
});
