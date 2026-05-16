import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ItemDetailPage from '../ItemDetailPage';

vi.mock('@/features/inventory/hooks', () => ({
  useInventoryItem: () => ({
    data: {
      id: 'item-1',
      name: 'Paracetamol 500mg',
      sku: 'MED-001',
      category_name: 'Medicines',
      unit_of_measure: 'tablet',
      total_stock: 120,
      reorder_level: 20,
      max_stock_level: 500,
      unit_price: 2.5,
      is_controlled: false,
      is_active: true,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useItemMovements: () => ({ data: { results: [] }, isLoading: false }),
  useItemExpiryTrackers: () => ({ data: { results: [] }, isLoading: false }),
  useItemStockByLocation: () => ({ data: { results: [] }, isLoading: false }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <>{children}</>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inventory/items/item-1']}>
      <Routes>
        <Route path="/inventory/items/:id" element={<ItemDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ItemDetailPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('keeps item details read-only in Rust V2 mode when item mutation contracts are absent', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.getByText('Paracetamol 500mg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create requisition/i })).toBeInTheDocument();
    expect(
      screen.getByText(/inventory item editing is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps item editing available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
  });
});
