import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AddPrescriptionSlideOver from '../AddPrescriptionSlideOver';

const safetyMutate = vi.fn();
const createPrescription = vi.fn();
const onClose = vi.fn();

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

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AddPrescriptionSlideOver open onClose={onClose} patient={patient} />
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
});
