import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BillingDischargesPage from '../BillingDischargesPage';

const dischargeCase = {
  id: 'discharge-1',
  patient_name: 'Ama Mensah',
  ward_name: 'Medical Ward',
  medical_record_number: 'MRN-001',
  status: 'awaiting_clearance',
  medical_ready_at: '2026-05-12T08:00:00Z',
  billing_cutoff_at: '2026-05-12T08:00:00Z',
  invoice_summary: {
    invoice_count: 2,
    patient_balance_due: '120.00',
  },
  blockers: [
    {
      id: 'task-billing',
      task_type: 'billing_clearance',
      status: 'pending',
      blocking: true,
    },
  ],
  tasks: [
    {
      id: 'task-billing',
      task_type: 'billing_clearance',
      status: 'pending',
      blocking: true,
    },
  ],
};

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}));

vi.mock('@/features/discharge/hooks/useDischargeCaseQueries', () => ({
  useDischargeCases: () => ({
    data: [dischargeCase],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useDischargeCase: () => ({
    data: dischargeCase,
  }),
  useUpdateBillingCutoff: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useClearBilling: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/billing/discharges?case=discharge-1']}>
      <BillingDischargesPage />
    </MemoryRouter>,
  );
}

describe('BillingDischargesPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('hides unsupported billing cutoff and clearance actions in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.queryByRole('button', { name: /save cutoff/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear billing/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/billing cutoff edits and billing clearance are not available for this deployment yet/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review details/i })).toBeInTheDocument();
  });

  it('keeps billing clearance actions available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /save cutoff/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear billing/i })).toBeInTheDocument();
  });
});
