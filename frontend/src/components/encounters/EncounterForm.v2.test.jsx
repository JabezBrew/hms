import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncounterForm } from './EncounterForm';

const createEncounter = vi.fn();
const updateEncounter = vi.fn();
const setPatientSearchTerm = vi.fn();
const setPractitionerSearchTerm = vi.fn();

vi.mock('@/components/appointments/DoctorAvailabilityCalendar', () => ({
  default: () => <div data-testid="legacy-availability-calendar" />,
}));

vi.mock('@/features/encounters/hooks/useEncounterQueries', () => ({
  useCreateEncounter: () => ({ mutate: createEncounter }),
  useUpdateEncounter: () => ({ mutate: updateEncounter }),
  useEncounter: () => ({
    data: null,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSearchPatientsForEncounter: () => ({
    data: [{ id: 'patient-1', name: 'Ama Mensah' }],
    isLoading: false,
    searchTerm: '',
    setSearchTerm: setPatientSearchTerm,
  }),
  useSearchPractitioners: () => ({
    data: [{ id: 'practitioner-1', name: 'Dr. Mensah' }],
    isLoading: false,
    searchTerm: '',
    setSearchTerm: setPractitionerSearchTerm,
  }),
}));

function renderCreateForm() {
  return render(
    <MemoryRouter initialEntries={['/encounters/new']}>
      <Routes>
        <Route path="/encounters/new" element={<EncounterForm />} />
        <Route path="/encounters/:id" element={<div>Encounter detail route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EncounterForm Rust V2 bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('submits the generated Rust V2 encounter contract without requiring legacy-only form fields', async () => {
    const user = userEvent.setup();
    createEncounter.mockImplementation((_payload, options) => {
      options?.onSuccess?.({ id: 'encounter-1' });
    });

    renderCreateForm();

    expect(screen.queryByText('Practitioner')).not.toBeInTheDocument();
    expect(screen.queryByText('Reason for Visit')).not.toBeInTheDocument();
    expect(screen.queryByText('Service Type')).not.toBeInTheDocument();
    expect(screen.queryByText('Location')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-availability-calendar')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search for a patient...'), 'Ama');
    await user.click(await screen.findByText('Ama Mensah'));
    await user.click(screen.getByRole('button', { name: 'Create Encounter' }));

    await waitFor(() => {
      expect(createEncounter).toHaveBeenCalledWith(
        expect.objectContaining({
          patient_id: 'patient-1',
          encounter_type: 'outpatient',
        }),
        expect.any(Object),
      );
    });
  });
});
