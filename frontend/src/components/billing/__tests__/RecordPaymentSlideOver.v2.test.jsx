import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RecordPaymentSlideOver from '../RecordPaymentSlideOver';

const billingState = vi.hoisted(() => ({
  cashControlEnabled: false,
  session: null,
  recordPayment: vi.fn(),
}));

vi.mock('@/features/billing/hooks', () => ({
  useActiveFacilityBillingSettings: () => ({
    data: [{ cash_control_enabled: billingState.cashControlEnabled }],
  }),
  useCurrentCashSession: () => ({ data: { session: billingState.session } }),
  useOpenCashSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecordPayment: () => ({ mutateAsync: billingState.recordPayment, isPending: false }),
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
    billingState.cashControlEnabled = false;
    billingState.session = null;
    billingState.recordPayment.mockResolvedValue({});
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

  it('sends the open session with a Rust cash payment even without legacy cash-control settings', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    billingState.session = { id: 'session-open', status: 'open' };
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /record payment \(manual\)/i }));

    expect(billingState.recordPayment).toHaveBeenCalledWith(expect.objectContaining({
      invoiceId: invoice.id,
      data: expect.objectContaining({ payment_method: 'cash', cash_session_id: 'session-open' }),
    }));
  });

  it('blocks Rust cash writes without an open session even when no drawer setting is enabled', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByRole('button', { name: /open session/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /record payment \(manual\)/i }));

    expect(billingState.recordPayment).not.toHaveBeenCalled();
  });

  it('allows a Rust bank transfer without a cash session and does not associate it with a drawer', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    billingState.cashControlEnabled = true;
    const user = userEvent.setup();
    renderPanel();
    await user.selectOptions(screen.getByLabelText(/payment method/i), 'bank_transfer');

    expect(screen.queryByRole('button', { name: /open session/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /record payment \(manual\)/i }));

    expect(billingState.recordPayment).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ payment_method: 'bank_transfer' }),
    }));
    expect(billingState.recordPayment.mock.calls[0][0].data).not.toHaveProperty('cash_session_id');
  });

  it('preserves legacy cash-control requirements for non-cash payments', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    billingState.cashControlEnabled = true;
    const user = userEvent.setup();
    renderPanel();
    await user.selectOptions(screen.getByLabelText(/payment method/i), 'bank_transfer');
    await user.click(screen.getByRole('button', { name: /record payment \(manual\)/i }));

    expect(billingState.recordPayment).not.toHaveBeenCalled();
  });
});
