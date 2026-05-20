import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StandingOrdersPage from '../StandingOrdersPage';

vi.mock('@/features/inventory/hooks', () => ({
  useStandingOrders: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'standing-1',
          name: 'Weekly ward stock',
          order_number: 'SO-001',
          frequency: 'weekly',
          is_active: true,
          requesting_location_name: 'Ward Store',
          next_due_date: '2026-05-18',
          items_count: 4,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/components/ui/VirtualizedTable', () => ({
  default: ({ rows = [], columns = [] }) => (
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
    <MemoryRouter initialEntries={['/inventory/standing-orders']}>
      <StandingOrdersPage />
    </MemoryRouter>,
  );
}

describe('StandingOrdersPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('renders standing orders as read-only in Rust V2 mode because no generated contract exists', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.getByText('Weekly ward stock')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new template/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/standing order template management is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps standing order management controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /new template/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
  });
});
