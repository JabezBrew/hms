import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import RequisitionDetailPage from '../RequisitionDetailPage';

const mockUseRequisition = vi.fn();

vi.mock('@/features/inventory/hooks', () => ({
  useRequisition: (...args) => mockUseRequisition(...args),
  useApproveRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRejectRequisition: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConvertRequisitionToPO: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inventory/requisitions/req-1']}>
      <Routes>
        <Route path="/inventory/requisitions/:id" element={<RequisitionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function approvedRequisition() {
  return {
    id: 'req-1',
    requisition_number: 'REQ-001',
    status: 'approved',
    priority: 'normal',
    created_at: '2026-05-12T08:00:00Z',
    requested_by_name: 'Ama Mensah',
    items: [
      {
        id: 'line-1',
        item_name: 'Paracetamol',
        quantity: 10,
        unit_price: 1.5,
      },
    ],
  };
}

describe('RequisitionDetailPage Rust V2 guards', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
    vi.clearAllMocks();
  });

  it('hides unsupported conversion to purchase order in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    mockUseRequisition.mockReturnValue({
      data: approvedRequisition(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('REQ-001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /convert to po/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/requisition conversion to purchase order is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps conversion to purchase order available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    mockUseRequisition.mockReturnValue({
      data: approvedRequisition(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('button', { name: /convert to po/i })).toBeInTheDocument();
  });
});
