import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AddFluidBalanceSlideOver from '../AddFluidBalanceSlideOver';

const onClose = vi.fn();
const createFluid = vi.fn();
const deleteFluid = vi.fn();

const patient = {
  id: 'patient-1',
  name: 'Ama Mensah',
};

const fluidRecord = {
  id: 'fluid-1',
  entry_type: 'intake',
  category: 'oral',
  subcategory: 'Water',
  volume_ml: 250,
  recorded_at: '2026-05-16T08:00:00Z',
  notes: 'Morning fluids',
};

vi.mock('@/features/nursing/hooks', () => ({
  useTodayFluidBalance: () => ({
    data: { total_intake: 250, total_output: 0, balance: 250 },
  }),
  useFluidBalanceSummary: () => ({
    data: { total_intake: 250, total_output: 0, balance: 250 },
  }),
  useFluidBalance: () => ({
    data: [fluidRecord],
    isLoading: false,
  }),
  useCreateFluidBalance: () => ({
    mutateAsync: createFluid,
    isPending: false,
  }),
  useDeleteFluidBalance: () => ({
    mutateAsync: deleteFluid,
    isPending: false,
  }),
}));

describe('AddFluidBalanceSlideOver Rust V2 guards', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
    vi.clearAllMocks();
  });

  it('keeps fluid entries visible but hides unsupported deletion in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    const { container } = render(
      <AddFluidBalanceSlideOver open onClose={onClose} patient={patient} />,
    );

    expect(screen.getAllByText(/250ml/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/morning fluids/i)).toBeInTheDocument();
    expect(container.querySelector('.lucide-trash-2')).not.toBeInTheDocument();
    expect(
      screen.getByText(/fluid balance deletion is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps fluid entry deletion available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    const { container } = render(
      <AddFluidBalanceSlideOver open onClose={onClose} patient={patient} />,
    );

    expect(container.querySelector('.lucide-trash-2')).toBeInTheDocument();
    expect(
      screen.queryByText(/fluid balance deletion is not available in rust v2/i),
    ).not.toBeInTheDocument();
  });
});
