import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TriageAssignDialog } from './TriageAssignDialog';
import { appointmentsApi } from '@/features/appointments/api';
import { clinicsApi } from '@/features/clinics/api';
import { triageAssignmentApi } from '@/features/triage/api';

const { assignStaff } = vi.hoisted(() => ({ assignStaff: vi.fn() }));
vi.mock('@/features/triage/api', () => ({ triageAssignmentApi: { listStaff: vi.fn() } }));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    facilityCode: 'HMS',
  }),
}));

vi.mock('@/hooks/useVisitQueries', () => ({
  useTriageActions: () => ({
    assignToClinic: {
      mutate: assignStaff,
      isPending: false,
    },
  }),
}));

vi.mock('@/features/clinics/api', () => ({
  clinicsApi: {
    list: vi.fn(),
  },
}));

vi.mock('@/features/appointments/api', () => ({
  appointmentsApi: {
    getAppointmentTypes: vi.fn(),
  },
}));

vi.mock('@/lib/api/staff', () => ({
  staffApi: {
    getPractitioners: vi.fn(),
  },
}));

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TriageAssignDialog
          open
          onClose={vi.fn()}
          entry={{
            id: 'triage-1',
            priority: 'routine',
            patient_name: 'Patient One',
            triage_notes: 'Stable',
          }}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TriageAssignDialog Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clinicsApi.list.mockResolvedValue([]);
    appointmentsApi.getAppointmentTypes.mockResolvedValue([]);
    triageAssignmentApi.listStaff.mockResolvedValue({ results: [{ user_id: 'user-1', display_name: 'Test clinician', position: 'Nurse' }], next_cursor: null });
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('requires a staff assignment without unused clinic and appointment inputs in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderDialog();

    expect(screen.getByText('Staff member *')).toBeInTheDocument();
    expect(screen.queryByText('Clinic')).not.toBeInTheDocument();
    expect(screen.queryByText('Appointment Type')).not.toBeInTheDocument();
    expect(screen.queryByText('Start Time')).not.toBeInTheDocument();
    expect(screen.queryByText(/rust v2/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Any available')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign staff/i })).toBeDisabled();
    expect(clinicsApi.list).not.toHaveBeenCalled();
    expect(appointmentsApi.getAppointmentTypes).not.toHaveBeenCalled();
  });

  it('sends the selected user id and can load later staff directory pages', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    triageAssignmentApi.listStaff.mockResolvedValueOnce({
      results: [{ user_id: 'user-1', display_name: 'First clinician', position: 'Nurse' }], next_cursor: 'staff-cursor',
    }).mockResolvedValueOnce({
      results: [{ user_id: 'user-2', display_name: 'Second clinician', position: 'Doctor' }], next_cursor: null,
    });
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Load more staff' }));
    await waitFor(() => expect(triageAssignmentApi.listStaff).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'staff-cursor', signal: expect.any(AbortSignal) })));
    screen.getByRole('combobox', { name: 'Staff member *' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Second clinician · Doctor' }));
    await user.click(screen.getByRole('button', { name: 'Assign Staff' }));
    expect(assignStaff).toHaveBeenCalledWith({ id: 'triage-1', assigned_to_user_id: 'user-2' }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it('exposes a recovery action when the staff directory fails', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    triageAssignmentApi.listStaff.mockRejectedValueOnce(new Error('Offline'));
    const user = userEvent.setup();
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent('Staff could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Retry staff list' }));
    await waitFor(() => expect(triageAssignmentApi.listStaff).toHaveBeenCalledTimes(2));
  });

  it('keeps pooled practitioner assignment available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderDialog();

    expect(screen.getByText('Practitioner (Optional)')).toBeInTheDocument();
    expect(screen.getByText('Any available')).toBeInTheDocument();
    expect(screen.queryByText(/select a practitioner before assigning/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign to clinic/i })).not.toBeDisabled();
  });
});
