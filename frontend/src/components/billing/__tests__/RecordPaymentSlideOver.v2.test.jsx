import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RecordPaymentSlideOver from '../RecordPaymentSlideOver';

vi.mock('@/features/billing/hooks', () => ({
  useActiveFacilityBillingSettings: () => ({
    data: [{ cash_control_enabled: false }],
  }),
  useCurrentCashSession: () => ({ data: { session: null } }),
  useOpenCashSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecordPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePaymentIntent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }) => (
    <select
      aria-label="Payment Method"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }) => children,
  SelectValue: () => null,
  SelectContent: ({ children }) => children,
  SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
}));

const invoice = {
  id: 'invoice-1',
  invoice_number: 'INV-001',
  balance_due: 75,
  total_amount: 100,
  amount_paid: 25,
  patient_phone: '0240000000',
};

function renderPanel() {
  return render(
    <RecordPaymentSlideOver
      open
      onClose={vi.fn()}
      invoice={invoice}
      onRefreshInvoice={vi.fn()}
    />,
  );
}

async function chooseMobileMoney() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText(/payment method/i), 'mobile_money');
}

describe('RecordPaymentSlideOver Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('keeps manual mobile money payments but hides Hubtel prompts in Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPanel();
    await chooseMobileMoney();

    expect(screen.queryByText(/hubtel collection/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send prompt/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/hubtel payment prompts are not available in rust v2/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record payment \(manual\)/i })).toBeInTheDocument();
  });

  it('keeps Hubtel prompts available outside Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPanel();
    await chooseMobileMoney();

    expect(screen.getByText(/hubtel collection/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send prompt/i })).toBeInTheDocument();
  });
});
