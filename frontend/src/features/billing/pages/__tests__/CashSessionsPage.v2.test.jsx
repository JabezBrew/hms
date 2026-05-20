import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CashSessionsPage from '../CashSessionsPage';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}));

vi.mock('@/features/billing/hooks', () => ({
  useCashSessions: () => ({
    data: {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 'session-1',
          opened_at: '2026-05-12T08:00:00Z',
          opened_by_name: 'Cashier One',
          status: 'closed',
          expected_cash_amount: 100,
          counted_cash_amount: 98,
          variance_cash_amount: -2,
          is_flagged: true,
          review_notes: 'Needs review',
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCurrentCashSession: () => ({
    data: { session: null },
    refetch: vi.fn(),
  }),
  useCashSessionTotals: () => ({ data: null }),
  useOpenCashSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCloseCashSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReviewCashSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/billing/cash-sessions']}>
      <CashSessionsPage />
    </MemoryRouter>,
  );
}

describe('CashSessionsPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('hides unsupported admin review actions in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/cash session review notes are not available in rust v2/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open session/i })).toBeInTheDocument();
  });

  it('keeps admin review actions available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
  });
});
