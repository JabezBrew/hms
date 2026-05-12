import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import PurchaseOrderDetailPage from '../PurchaseOrderDetailPage';

vi.mock('@/features/inventory/hooks', () => ({
  usePurchaseOrder: vi.fn(() => ({
    data: {
      id: 'po-1',
      po_number: 'PO-1',
      supplier_name: 'Local Supplier',
      status: 'draft',
      created_at: '2026-05-12T08:00:00Z',
      items: [],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })),
  useApprovePurchaseOrder: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useSendPurchaseOrder: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PurchaseOrderDetailPage', () => {
  it('shows the approve action for draft purchase orders', () => {
    render(
      <MemoryRouter initialEntries={['/inventory/purchase-orders/po-1']}>
        <Routes>
          <Route path="/inventory/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
  });
});
