import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AddPrescriptionSlideOver from '../AddPrescriptionSlideOver';

const safetyMutate = vi.fn();

const patient = {
  id: 'patient-1',
  name: 'Ama Mensah',
  is_admitted: true,
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
  MedicationAutocomplete: ({ value, onChange }) => (
    <input
      aria-label="Medication"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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
      <AddPrescriptionSlideOver open onClose={vi.fn()} patient={patient} />
    </QueryClientProvider>,
  );
}

describe('AddPrescriptionSlideOver Rust V2 MAR guard', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
    vi.clearAllMocks();
  });

  it('hides MAR generation controls in Rust V2 mode because no generated MAR contract exists', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPanel();

    expect(
      screen.queryByText(/generate medication administration record/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/mar generation is not available in rust v2/i),
    ).toBeInTheDocument();
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
});
