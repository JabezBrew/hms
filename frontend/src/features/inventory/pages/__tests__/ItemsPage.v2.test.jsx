import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ItemsPage from '../ItemsPage';

vi.mock('@/features/inventory/hooks', () => ({
  useInventoryItems: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'item-1',
          name: 'Paracetamol 500mg',
          sku: 'MED-001',
          category_name: 'Medicines',
          total_stock: 120,
          reorder_level: 20,
          unit_price: 2.5,
          unit_of_measure: 'tablet',
          is_controlled: false,
          nearest_expiry: null,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useInventoryCategories: () => ({
    data: { results: [{ id: 'cat-1', name: 'Medicines' }] },
  }),
  useSuppliers: () => ({
    data: { results: [{ id: 'supplier-1', name: 'Acme Medical' }] },
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

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <>{children}</>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, className }) => (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inventory/items']}>
      <ItemsPage />
    </MemoryRouter>,
  );
}

describe('ItemsPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('renders inventory items as read-only in Rust V2 mode when item mutations have no contract', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(await screen.findByText('Paracetamol 500mg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(
      await screen.findByText(/inventory item creation and editing is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps inventory item mutation controls available outside Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /edit/i })).toBeInTheDocument();
  });
});
