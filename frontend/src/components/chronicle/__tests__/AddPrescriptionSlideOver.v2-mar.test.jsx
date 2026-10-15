import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

import AddPrescriptionSlideOver from '../AddPrescriptionSlideOver';

const safetyMutate = vi.fn();
const createPrescription = vi.fn();
const onClose = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const patient = {
  id: 'patient-1',
  name: 'Ama Mensah',
  is_admitted: true,
  current_admission_id: 'admission-1',
};

vi.mock('@/hooks/useDrugSafetyQueries', () => ({
  useSafetyCheck: () => ({
    mutateAsync: safetyMutate,
    isPending: false,
  }),
  usePatientAllergies: () => ({ data: [] }),
  useDrugForms: () => ({ data: { forms: [] }, isLoading: false }),
}));

vi.mock('@/components/drug-safety/DrugSafetyDialog', () => ({
  DrugSafetyDialog: () => null,
}));

vi.mock('@/components/drug-safety/MedicationAutocomplete', () => ({
  MedicationAutocomplete: ({ value, onSelect }) => (
    <input
      aria-label="Medication"
      value={value}
      onChange={(event) => onSelect({ name: event.target.value, rxcui: 'rx-1' })}
    />
  ),
}));

vi.mock('@/hooks/usePrescriptionMutations', () => ({
  createPrescription: (...args) => createPrescription(...args),
  invalidatePrescriptionMutationQueries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/onboarding', () => ({
  emitOnboardingEvent: vi.fn(),
}));

function renderPanel({ selectedPatient = patient, onPrescriptionCreated } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AddPrescriptionSlideOver open onClose={onClose} patient={selectedPatient} onPrescriptionCreated={onPrescriptionCreated} />
    </QueryClientProvider>,
  );
}

describe('AddPrescriptionSlideOver Rust V2 MAR guard', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
    vi.clearAllMocks();
  });

  it('shows MAR generation controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPanel();

    expect(
      screen.getByText(/generate medication administration record/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/mar generation is not available in rust v2/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Special Instructions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reason for Prescription')).not.toBeInTheDocument();
  });

  it('keeps MAR generation controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPanel();

    expect(
      screen.getByText(/generate medication administration record/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/mar generation is not available in rust v2/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Special Instructions')).toBeInTheDocument();
  });

  it('creates prescriptions in Rust V2 without calling unavailable drug-safety checks', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-1', patient: 'patient-1' });

    renderPanel();

    fireEvent.change(screen.getByLabelText('Medication'), {
      target: { value: 'Amoxicillin' },
    });
    fireEvent.change(screen.getByPlaceholderText(/500 mg/i), {
      target: { value: '500 mg' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));

    await waitFor(() => expect(createPrescription).toHaveBeenCalledTimes(1));

    expect(safetyMutate).not.toHaveBeenCalled();
    expect(createPrescription).toHaveBeenCalledWith({
      patient: 'patient-1',
      medication_name: 'Amoxicillin',
      dosage: '500 mg',
      route: 'oral',
      frequency: 'daily',
      start_date: expect.any(String),
      generate_mar: 'yes',
      mar_days: 7,
      admission_case_id: 'admission-1',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('creates an outpatient prescription without requesting an unavailable admission schedule', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-outpatient', patient: 'patient-1' });
    renderPanel({ selectedPatient: { id: 'patient-1', is_admitted: false } });
    expect(screen.getByText('MAR generation requires an active admission.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Medication' } });
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '5 mg' } });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(createPrescription).toHaveBeenCalledTimes(1));
    expect(createPrescription.mock.calls[0][0]).not.toHaveProperty('generate_mar');
    expect(createPrescription.mock.calls[0][0]).not.toHaveProperty('admission_case_id');
  });

  it.each(['failed', 'unconfirmed'])('warns after a saved prescription with %s MAR, closes, and prevents create retry', async (status) => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-saved', patient: 'patient-1', mar_generation_status: status, mar_generated: false });
    renderPanel();
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Medication' } });
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '5 mg' } });
    const submit = screen.getByRole('button', { name: /create prescription/i });
    fireEvent.click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/prescription saved/i), expect.objectContaining({ description: expect.stringMatching(/do not recreate/i) }));
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.click(submit);
    expect(createPrescription).toHaveBeenCalledTimes(1);
  });

  it('still closes a saved prescription when the completion callback fails', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-saved', patient: 'patient-1' });
    renderPanel({ onPrescriptionCreated: () => { throw new Error('Refresh unavailable'); } });
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Medication' } });
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '5 mg' } });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
    expect(createPrescription).toHaveBeenCalledTimes(1);
  });

  it('explains as-needed schedule handling instead of claiming scheduled doses were generated', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-prn', mar_generated: false, mar_generation_status: 'skipped', mar_generation: { skipped_reason: 'prn' } });
    renderPanel();
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Medication' } });
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '5 mg' } });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Prescription saved. As-needed doses are not automatically scheduled.');
  });
});
