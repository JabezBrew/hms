import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalkInCheckInDialog } from '../components/WalkInCheckInDialog';
import ClinicWaitingRoomPage from '../pages/ClinicWaitingRoomPage';
import { TriageAssignDialog } from '@/components/visits/TriageAssignDialog';
import { appointmentsApi } from '@/features/appointments/api';
import { clinicsApi } from '@/features/clinics/api';

const adminHookState = vi.hoisted(() => ({
  departments: { data: [], isLoading: false },
  onDuty: { data: [], isLoading: false },
}));
const visitHookState = vi.hoisted(() => ({
  waitingRoom: [],
}));

vi.mock('@/components/layout/layout', () => ({
  Layout: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ onValueChange }) => (
    <select
      data-testid="select-control"
      onClick={() => onValueChange?.('dept-1')}
      onChange={() => onValueChange?.('dept-1')}
    >
      <option value="dept-1">Department</option>
    </select>
  ),
  SelectContent: ({ children }) => <div>{children}</div>,
  SelectItem: ({ children, value }) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }) => <span>{placeholder}</span>,
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    facilityCode: 'HMS',
    user: { role: 'admin' },
  }),
}));

vi.mock('@/hooks/useVisitQueries', () => ({
  useWaitingRoom: () => ({
    data: visitHookState.waitingRoom,
    isLoading: false,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useVisit: () => ({
    data: null,
    isLoading: false,
  }),
  useTriageActions: () => ({
    assignToClinic: {
      mutate: vi.fn(),
      isPending: false,
    },
  }),
  useVisitActions: () => ({
    callPatient: { mutate: vi.fn(), isPending: false },
    startConsultation: { mutate: vi.fn(), isPending: false },
    checkout: { mutate: vi.fn(), isPending: false },
    markNoShow: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/features/admin/hooks', () => ({
  useDepartments: () => adminHookState.departments,
  useRosterOnDutyDepartment: () => adminHookState.onDuty,
}));

vi.mock('@/features/clinics/api', () => ({
  clinicsApi: {
    get: vi.fn(),
    list: vi.fn(),
  },
  clinicWalkInApi: {
    checkIn: vi.fn(),
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

function renderWithQuery(ui, route = '/') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0,
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('clinic Rust V2 read callers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clinicsApi.get.mockResolvedValue({
      id: 'clinic-1',
      name: 'General Clinic',
      department: { name: 'OPD' },
    });
    clinicsApi.list.mockResolvedValue([]);
    appointmentsApi.getAppointmentTypes.mockResolvedValue([]);
    adminHookState.departments = { data: [], isLoading: false };
    adminHookState.onDuty = { data: [], isLoading: false };
    visitHookState.waitingRoom = [];
  });

  it('threads React Query AbortSignal into clinic waiting room detail reads', async () => {
    renderWithQuery(
      <Routes>
        <Route path="/clinics/:clinicId/waiting-room" element={<ClinicWaitingRoomPage />} />
      </Routes>,
      '/clinics/clinic-1/waiting-room',
    );

    await waitFor(() => {
      expect(clinicsApi.get).toHaveBeenCalledWith('clinic-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('marks the targeted waiting-room visit from Omni Search route params', async () => {
    visitHookState.waitingRoom = [
      {
        id: 'visit-1',
        visit_id: 'visit-1',
        encounter_id: 'visit-1',
        patient_id: 'patient-1',
        patient_name: 'Patient One',
        queue_number: 1,
        visit_status: 'waiting',
        checked_in_at: '2026-01-01T10:00:00Z',
      },
      {
        id: 'visit-2',
        visit_id: 'visit-2',
        encounter_id: 'visit-2',
        patient_id: 'patient-2',
        patient_name: 'Patient Two',
        queue_number: 2,
        visit_status: 'called',
        checked_in_at: '2026-01-01T10:05:00Z',
      },
    ];

    renderWithQuery(
      <Routes>
        <Route path="/clinics/:clinicId/waiting-room" element={<ClinicWaitingRoomPage />} />
      </Routes>,
      '/clinics/clinic-1/waiting-room?visit=visit-2',
    );

    expect(await screen.findByText(/Patient Two/)).toBeInTheDocument();
    const target = document.querySelector('[data-omni-target="true"]');
    expect(target).toHaveTextContent('Patient Two');
  });

  it('threads React Query AbortSignal into triage assignment lookup reads', async () => {
    renderWithQuery(
      <TriageAssignDialog
        open
        onClose={vi.fn()}
        entry={{
          id: 'triage-1',
          priority: 'routine',
          patient_name: 'Patient One',
          reason: 'Review',
        }}
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(clinicsApi.list).toHaveBeenCalledWith(
        { accepts_walk_ins: true },
        { signal: expect.any(AbortSignal) },
      );
      expect(appointmentsApi.getAppointmentTypes).toHaveBeenCalledWith({
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into walk-in clinic lookup reads', async () => {
    adminHookState.departments = {
      data: [
        {
          id: 'dept-1',
          name: 'Outpatient Department',
          unit_type_code: 'department',
          unit_category: 'clinical',
        },
      ],
      isLoading: false,
    };
    adminHookState.onDuty = {
      data: [
        {
          duty_type_category: 'clinic',
          clinic_id: 'clinic-1',
          clinic_name: 'General Clinic',
        },
      ],
      isLoading: false,
    };
    clinicsApi.list.mockResolvedValue([
      {
        id: 'clinic-1',
        name: 'General Clinic',
        booking_mode: 'clinic_pool',
        accepts_walk_ins: true,
      },
    ]);

    renderWithQuery(
      <WalkInCheckInDialog
        open
        onOpenChange={vi.fn()}
        patientId="patient-1"
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('select-control'));

    await waitFor(() => {
      expect(clinicsApi.list).toHaveBeenCalledWith(
        { is_active: true, department: 'dept-1' },
        { signal: expect.any(AbortSignal) },
      );
    });
  });
});
