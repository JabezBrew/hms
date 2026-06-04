import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import InvoiceDetailPage from '../InvoiceDetailPage';

vi.mock('@/features/billing/hooks', () => ({
  useInvoice: () => ({
    data: {
      id: 'invoice-1',
      invoice_number: 'INV-001',
      status: 'paid',
      created_at: '2026-01-01T10:00:00Z',
      patient: 'patient-1',
      patient_name: 'Patient One',
      patient_mrn: 'P-001',
      total_amount: 125,
      amount_paid: 125,
      balance_due: 0,
      insurance_amount: 0,
      has_claim: false,
      items: [],
      payments: [
        {
          id: 'payment-1',
          payment_date: '2026-01-01T10:30:00Z',
          payment_method: 'cash',
          amount: 125,
          receipt_number: 'RCT-001',
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGenerateClaim: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useReceiptPrint', () => ({
  useReceiptPrint: () => ({
    printReceipt: vi.fn(),
    printInvoice: vi.fn(),
    printingId: null,
  }),
}));

vi.mock('@/components/billing/RecordPaymentSlideOver', () => ({
  default: () => null,
}));

function renderPage(route = '/billing/invoices/invoice-1?payment=payment-1') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/billing/invoices/:id" element={<InvoiceDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('InvoiceDetailPage Omni Search payment deep links', () => {
  it('marks the targeted payment row from the payment route param', () => {
    renderPage();

    const target = document.querySelector('[data-omni-target="true"]');
    expect(target).toHaveTextContent('RCT-001');
  });
});
