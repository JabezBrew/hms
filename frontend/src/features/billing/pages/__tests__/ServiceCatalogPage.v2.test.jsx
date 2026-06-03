import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ServiceCatalogPage from '../ServiceCatalogPage';

vi.mock('@/features/billing/hooks', () => ({
  useServiceCategories: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'category-1',
          name: 'Consultation',
          description: 'Clinic services',
          is_active: true,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useServices: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'service-1',
          code: 'CONS-GEN',
          name: 'General Consultation',
          category: 'category-1',
          category_name: 'Consultation',
          base_price: '75.00',
          tax_rate: '0.00',
          is_active: true,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateServiceCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateServiceCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateService: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateService: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    <MemoryRouter>
      <ServiceCatalogPage />
    </MemoryRouter>,
  );
}

describe('ServiceCatalogPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('renders the Rust V2 service catalog as read-only', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.queryByRole('button', { name: /new service/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/service catalog editing is not available in rust v2/i),
    ).toBeInTheDocument();
    expect(screen.getByText('General Consultation')).toBeInTheDocument();
  });

  it('keeps service catalog mutation controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /new service/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });
});
