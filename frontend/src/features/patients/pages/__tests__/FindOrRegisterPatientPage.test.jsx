import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FindOrRegisterPatientPage from '../FindOrRegisterPatientPage';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  getCurrentContexts: vi.fn(),
  lookupMutateAsync: vi.fn(),
  registerMutateAsync: vi.fn(),
  outpatientMutateAsync: vi.fn(),
  inpatientMutateAsync: vi.fn(),
  emergencyMutateAsync: vi.fn(),
  lookupSessionData: null,
  lookupSessionFetching: false,
  lookupSessionError: false,
  userRole: 'receptionist',
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
  },
}));

vi.mock('@/features/care-areas/hooks/useCareAreaQueries', () => ({
  useEmergencyIntake: () => ({
    mutateAsync: mocks.emergencyMutateAsync,
    isPending: false,
  }),
  useInpatientIntake: () => ({
    mutateAsync: mocks.inpatientMutateAsync,
    isPending: false,
  }),
  useOutpatientIntake: () => ({
    mutateAsync: mocks.outpatientMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/features/patients/hooks/usePatientQueries', () => ({
  usePatientIdentityLookup: () => ({
    mutateAsync: mocks.lookupMutateAsync,
    isPending: false,
  }),
  usePatientIdentityLookupSession: () => ({
    data: mocks.lookupSessionData,
    isFetching: mocks.lookupSessionFetching,
    isError: mocks.lookupSessionError,
  }),
  useRegisterPatient: () => ({
    mutateAsync: mocks.registerMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { role: mocks.userRole } }),
}));

vi.mock('@/features/patients/api', () => ({
  patientsApi: {
    getCurrentContexts: mocks.getCurrentContexts,
  },
}));

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}));

function renderPage(path = '/patients/find-or-register') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <FindOrRegisterPatientPage />
    </MemoryRouter>,
  );
}

async function fillIdentityForm(user) {
  await user.type(screen.getByLabelText('First name'), 'Ama');
  await user.type(screen.getByLabelText('Last name'), 'Mensah');
  await user.type(screen.getByLabelText('Date of birth'), '1989-04-15');
}

describe('FindOrRegisterPatientPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupMutateAsync.mockResolvedValue({
      lookup_id: 'lookup-1',
      candidates: [],
      strong_duplicate_found: false,
    });
    mocks.getCurrentContexts.mockResolvedValue({
      outpatient: [],
      inpatient: [],
      emergency: [],
    });
    mocks.registerMutateAsync.mockResolvedValue({ id: 'patient-new' });
    mocks.outpatientMutateAsync.mockResolvedValue({ visit: { id: 'visit-1' } });
    mocks.inpatientMutateAsync.mockResolvedValue({ admission_case: { id: 'case-1' } });
    mocks.emergencyMutateAsync.mockResolvedValue({ triage: { id: 'triage-1' } });
    mocks.lookupSessionData = null;
    mocks.lookupSessionFetching = false;
    mocks.lookupSessionError = false;
    mocks.userRole = 'receptionist';
  });

  it('uses an existing outpatient candidate in the selected clinic context', async () => {
    const user = userEvent.setup();
    mocks.lookupMutateAsync.mockResolvedValueOnce({
      lookup_id: 'lookup-1',
      candidates: [
        {
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          display_name: 'Ama Mensah',
          date_of_birth: '1989-04-15',
          sex: 'female',
          record_status: 'registered',
          vital_status: 'presumed_alive',
        },
      ],
      strong_duplicate_found: true,
    });

    renderPage('/patients/find-or-register?intent=outpatient&clinic_id=clinic-1');
    await fillIdentityForm(user);
    await user.click(screen.getByRole('button', { name: /Check for Existing Patient/i }));

    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Use Existing Record/i }));

    await waitFor(() => {
      expect(mocks.outpatientMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          patient_id: 'patient-1',
          clinic_id: 'clinic-1',
          appointment_id: null,
          idempotency_key: expect.any(String),
        }),
      );
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/clinics/clinic-1/waiting-room');
  });

  it('blocks new patient creation from duplicate candidates until review reason is supplied', async () => {
    const user = userEvent.setup();
    mocks.lookupMutateAsync.mockResolvedValueOnce({
      lookup_id: 'lookup-1',
      candidates: [
        {
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          display_name: 'Ama Mensah',
          date_of_birth: '1989-04-15',
          sex: 'female',
          record_status: 'registered',
          vital_status: 'presumed_alive',
        },
      ],
      strong_duplicate_found: true,
    });

    renderPage('/patients/find-or-register?intent=emergency');
    await fillIdentityForm(user);
    await user.click(screen.getByRole('button', { name: /Check for Existing Patient/i }));
    await screen.findByText('Duplicate review required.');
    await user.click(screen.getByRole('button', { name: /Register New Distinct Patient/i }));

    expect(mocks.toastError).toHaveBeenCalledWith('Select a duplicate review reason');
    expect(mocks.registerMutateAsync).not.toHaveBeenCalled();
  });

  it('registers a no-match emergency walk-in without putting identity data in the URL', async () => {
    const user = userEvent.setup();

    renderPage('/patients/find-or-register?intent=emergency');
    await fillIdentityForm(user);
    await user.click(screen.getByRole('button', { name: /Check for Existing Patient/i }));
    expect(await screen.findByText(/No matching records/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continue New Registration/i }));

    await waitFor(() => {
      expect(mocks.registerMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: 'Ama',
          last_name: 'Mensah',
          date_of_birth: '1989-04-15',
          sex: 'unknown',
        }),
      );
    });
    expect(mocks.emergencyMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 'patient-new',
        acuity: 'urgent',
        idempotency_key: expect.any(String),
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/triage');
  });

  it('routes inpatient intake to the current admission before creating another case', async () => {
    const user = userEvent.setup();
    mocks.lookupMutateAsync.mockResolvedValueOnce({
      lookup_id: 'lookup-1',
      candidates: [
        {
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          display_name: 'Ama Mensah',
          date_of_birth: '1989-04-15',
          sex: 'female',
          record_status: 'registered',
          vital_status: 'presumed_alive',
        },
      ],
      strong_duplicate_found: true,
    });
    mocks.getCurrentContexts.mockResolvedValueOnce({
      outpatient: [],
      inpatient: [{ admission_case_id: 'case-current', ward_id: 'ward-1' }],
      emergency: [],
    });

    renderPage('/patients/find-or-register?intent=inpatient&ward_id=ward-2');
    await fillIdentityForm(user);
    await user.click(screen.getByRole('button', { name: /Check for Existing Patient/i }));
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Use Existing Record/i }));

    await waitFor(() => {
      expect(mocks.toastInfo).toHaveBeenCalledWith('Patient already has a current inpatient admission');
    });
    expect(mocks.inpatientMutateAsync).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/ward-board');
  });

  it('restores lookup candidates by opaque lookup id when returning to the page', async () => {
    mocks.lookupSessionData = {
      lookup_id: 'lookup-1',
      candidates: [
        {
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          display_name: 'Ama Mensah',
          date_of_birth: '1989-04-15',
          sex: 'female',
          record_status: 'registered',
          vital_status: 'presumed_alive',
        },
      ],
      strong_duplicate_found: true,
    };

    renderPage('/patients/find-or-register?lookup_id=lookup-1');

    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review Profile/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/MRN \/ Hospital Number/i)).toHaveValue('');
    expect(screen.getByLabelText(/First name/i)).toHaveValue('');
    expect(screen.getByLabelText(/Last name/i)).toHaveValue('');
    expect(screen.getByLabelText(/Date of birth/i)).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /Sex/i })).toHaveTextContent('Unknown');
    expect(screen.getByText(/Re-enter identity details before registering a new record/i)).toBeInTheDocument();
  });

  it('routes existing record review to the administrative profile when no care-area intent is present', async () => {
    const user = userEvent.setup();
    mocks.lookupMutateAsync.mockResolvedValueOnce({
      lookup_id: 'lookup-1',
      candidates: [
        {
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          display_name: 'Ama Mensah',
          date_of_birth: '1989-04-15',
          sex: 'female',
          record_status: 'registered',
          vital_status: 'presumed_alive',
        },
      ],
      strong_duplicate_found: true,
    });

    renderPage('/patients/find-or-register');
    await fillIdentityForm(user);
    await user.click(screen.getByRole('button', { name: /Check for Existing Patient/i }));
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Review Profile/i }));

    expect(mocks.navigate).toHaveBeenCalledWith('/patients/patient-1/profile', {
      state: { returnTo: expect.stringContaining('/patients/find-or-register') },
    });
  });
});
