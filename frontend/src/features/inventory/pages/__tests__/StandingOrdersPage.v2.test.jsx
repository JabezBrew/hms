import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/lib/auth/AuthContext';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StandingOrdersPage from '../StandingOrdersPage';
import { standingApi } from '../../standing/api';

vi.mock('../../standing/api', () => ({ standingApi: { list: vi.fn().mockResolvedValue({ data: [{ id: 'template-1', name: 'Weekly ward stock', requesting_location_name: 'Ward Store', fulfilling_location_name: 'Main Store', frequency: 'weekly', next_run_on: '2026-10-15', status: 'active', line_count: 4, version: 1 }], page: { limit: 25, has_next: false, next_cursor: null } }) } }));
let client;
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

function renderPage(canManage = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthContext.Provider value={{ user: { adminAccess: { capabilities: canManage ? ['inventory.manage'] : [] } } }}><QueryClientProvider client={client}><MemoryRouter initialEntries={['/inventory/standing-orders']}>
      <StandingOrdersPage />
    </MemoryRouter></QueryClientProvider></AuthContext.Provider>,
  );
}

describe('StandingOrdersPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    standingApi.list.mockResolvedValue({ data: [{ id: 'template-1', name: 'Weekly ward stock', requesting_location_name: 'Ward Store', fulfilling_location_name: 'Main Store', frequency: 'weekly', next_run_on: '2026-10-15', status: 'active', line_count: 4, version: 1 }], page: { limit: 25, has_next: false, next_cursor: null } });
  });

  afterEach(() => {
    client?.clear();
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('uses line-backed Rust templates and hides writes without inventory.manage', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(await screen.findByText('Weekly ward stock')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new template/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review Weekly ward stock' })).toBeInTheDocument();
  });

  it('exposes real template creation to an explicitly authorized Rust manager', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    renderPage(true);
    await screen.findByText('Weekly ward stock');
    expect(screen.getByRole('button', { name: /new template/i })).toBeInTheDocument();
  });

  it('keeps standing order management controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /new template/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
  });
});
