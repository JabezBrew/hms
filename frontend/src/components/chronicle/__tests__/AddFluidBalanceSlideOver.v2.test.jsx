import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AddFluidBalanceSlideOver from '../AddFluidBalanceSlideOver';
import { useFluidBalance, useFluidBalanceSummary, useTodayFluidBalance } from '@/features/nursing/hooks';

const onClose = vi.fn();
const createFluid = vi.fn();
const deleteFluid = vi.fn();
let readError = null;

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
  useTodayFluidBalance: vi.fn(() => ({
    data: { total_intake: 250, total_output: 0, balance: 250 },
    error: readError,
    refetch: vi.fn(),
  })),
  useFluidBalanceSummary: vi.fn(() => ({
    data: { total_intake: 250, total_output: 0, balance: 250 },
    error: readError,
  })),
  useFluidBalance: vi.fn(() => ({
    data: [fluidRecord],
    isLoading: false,
    error: readError,
    refetch: vi.fn(),
  })),
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
    readError = null;
    vi.useRealTimers();
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
      screen.getByText(/corrections are not available yet/i),
    ).toBeInTheDocument();
  });

  it('keeps fluid entry deletion available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    const { container } = render(
      <AddFluidBalanceSlideOver open onClose={onClose} patient={patient} />,
    );

    expect(container.querySelector('.lucide-trash-2')).toBeInTheDocument();
    expect(
      screen.queryByText(/corrections are not available yet/i),
    ).not.toBeInTheDocument();
  });

  it('records supported volume without asking for fields this deployment cannot save', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createFluid.mockResolvedValueOnce({ id: 'synthetic-saved' });
    render(<AddFluidBalanceSlideOver open onClose={onClose} patient={patient} admission={{ id: 'synthetic-admission' }} />);
    expect(screen.queryByText('Category *')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Any additional observations...')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Enter amount'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: /record intake/i }));
    await waitFor(() => expect(createFluid).toHaveBeenCalledWith(expect.objectContaining({ admission: 'synthetic-admission', volume_ml: 250 })));
  });

  it('keeps current-admission rows and totals together across entry and history views', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    render(<AddFluidBalanceSlideOver open onClose={onClose} patient={patient} admission={{ id: 'current-admission' }} />);
    expect(screen.getByText(/current admission/i)).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Amount (ml)' })).toBeInTheDocument();
    expect(useTodayFluidBalance).toHaveBeenLastCalledWith(patient.id, expect.objectContaining({ admission_case_id: 'current-admission' }));
    for (const [, filters] of useFluidBalance.mock.calls) expect(filters.admission_case_id).toBe('current-admission');
    expect(useFluidBalanceSummary).toHaveBeenLastCalledWith(patient.id, expect.any(String), expect.objectContaining({ admission_case_id: 'current-admission' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(useFluidBalance.mock.calls.at(-1)[1].admission_case_id).toBe('current-admission');
    expect(useFluidBalanceSummary.mock.calls.at(-1)[2].admission_case_id).toBe('current-admission');
  });

  it('shows unread data as unavailable instead of zero totals or no entries', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    readError = new Error('Synthetic read failed');
    render(<AddFluidBalanceSlideOver open onClose={onClose} patient={patient} />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be fully loaded');
    expect(screen.queryByText("Today's Balance")).not.toBeInTheDocument();
    expect(screen.queryByText(/no entries recorded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/morning fluids/i)).not.toBeInTheDocument();
  });

  it('rolls rows and totals to the same explicit UTC day while the panel stays open', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T23:59:59.000Z'));
    render(<AddFluidBalanceSlideOver open onClose={onClose} patient={patient} />);
    expect(useTodayFluidBalance).toHaveBeenLastCalledWith(patient.id, expect.objectContaining({ date: '2026-10-14' }));
    expect(useFluidBalance).toHaveBeenNthCalledWith(1, patient.id, { date: '2026-10-14', descending: true }, { enabled: true });
    act(() => { vi.advanceTimersByTime(1001); });
    expect(useTodayFluidBalance).toHaveBeenLastCalledWith(patient.id, expect.objectContaining({ date: '2026-10-15' }));
    expect(useFluidBalance.mock.calls.at(-2)[1]).toEqual({ date: '2026-10-15', descending: true });
    expect(screen.getByText("Today's Balance (UTC)")).toBeInTheDocument();
    expect(screen.getByText(/08:00 UTC/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    expect(screen.getByText('Oct 14 Balance (UTC)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText("Today's Balance (UTC)")).toBeInTheDocument();
  });

  it('blocks a duplicate form submission after an uncertain recording response', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createFluid.mockRejectedValueOnce(Object.assign(new Error('Unconfirmed'), { name: 'FluidBalanceWriteUnconfirmedError' }));
    render(<AddFluidBalanceSlideOver open onClose={onClose} patient={patient} />);
    fireEvent.change(screen.getByPlaceholderText('Enter amount'), { target: { value: '250' } });
    const submit = screen.getByRole('button', { name: /record intake/i });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('may have been saved'));
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(createFluid).toHaveBeenCalledTimes(1);
  });

  it('keeps a confirmed save successful when the caller refresh callback fails', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createFluid.mockResolvedValueOnce({ id: 'synthetic-saved' });
    render(<AddFluidBalanceSlideOver open onClose={onClose} patient={patient} onFluidRecorded={() => { throw new Error('Synthetic refresh failure'); }} />);
    fireEvent.change(screen.getByPlaceholderText('Enter amount'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: /record intake/i }));
    await waitFor(() => expect(screen.getByPlaceholderText('Enter amount')).toHaveValue(null));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(createFluid).toHaveBeenCalledTimes(1);
  });
});
