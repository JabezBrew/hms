import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GRNDetailPage from '../GRNDetailPage';

vi.mock('@/features/inventory/hooks', () => ({
  useGRN: () => ({
    data: {
      id: 'grn-1',
      grn_number: 'GRN-001',
      status: 'inspecting',
      supplier_name: 'Acme Medical',
      received_date: '2026-05-01',
      created_at: '2026-05-01T08:00:00Z',
      items: [
        {
          id: 'item-1',
          item_name: 'Paracetamol 500mg',
          sku: 'MED-001',
          ordered_quantity: 10,
          received_quantity: 10,
          accepted_quantity: 10,
          item_status: 'pending',
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateGRNItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInspectGRN: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAcceptGRN: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inventory/grns/grn-1']}>
      <Routes>
        <Route path="/inventory/grns/:id" element={<GRNDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GRNDetailPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('keeps Rust V2 GRN acceptance visible but hides unsupported item editing', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    const { container } = renderPage();

    expect(screen.getByText('GRN-001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept & update stock/i })).toBeInTheDocument();
    expect(container.querySelector('.lucide-pencil')).toBeNull();
    expect(
      screen.getByText(/grn item editing is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps GRN item editing available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    const { container } = renderPage();

    expect(screen.getByRole('button', { name: /accept & update stock/i })).toBeInTheDocument();
    expect(container.querySelector('.lucide-pencil')).not.toBeNull();
  });
});
