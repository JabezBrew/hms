import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import AppointmentsPage from '../AppointmentsPage';

vi.mock('@/features/appointments/components/AppointmentList', () => ({
  default: () => <div>Appointment list</div>,
}));

vi.mock('@/features/appointments/components/BookableServicesPanel', () => ({
  default: () => <div>Bookable services</div>,
}));

vi.mock('@/features/appointments/components/SchedulingTemplatesPanel', () => ({
  default: () => <div>Scheduling templates</div>,
}));

const useSchedulingSessionsMock = vi.fn((params = {}) => ({
  data: params.clinic_id === 'clinic-target'
    ? [
      {
        id: 'session-target',
        clinic_id: 'clinic-target',
        name: 'Target Clinic Morning',
        starts_at: '2026-06-04T09:00:00Z',
        ends_at: '2026-06-04T12:00:00Z',
        mode: 'capacity_block',
        capacity: 12,
        booked_count: 2,
        remaining_capacity: 10,
      },
    ]
    : [
      {
        id: 'session-other',
        clinic_id: 'clinic-other',
        name: 'Other Clinic Morning',
        starts_at: '2026-06-04T09:00:00Z',
        ends_at: '2026-06-04T12:00:00Z',
        mode: 'capacity_block',
        capacity: 10,
        booked_count: 1,
        remaining_capacity: 9,
      },
    ],
  isLoading: false,
}));

vi.mock('@/features/appointments/hooks', () => ({
  useCreateSchedulingException: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreateSchedulingSession: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSchedulingExceptions: () => ({ data: [], isLoading: false }),
  useSchedulingServices: () => ({ data: [], isLoading: false }),
  useSchedulingSessions: (params) => useSchedulingSessionsMock(params),
}));

vi.mock('@/features/clinics/api', () => ({
  clinicsApi: {
    list: vi.fn(() => Promise.resolve([
      { id: 'clinic-target', name: 'Target Clinic' },
    ])),
  },
}));

vi.mock('@/features/referrals/hooks', () => ({
  useClinicWaitlist: () => ({
    data: [
      {
        id: 'wait-1',
        patient_id: 'patient-1',
        patient_name: 'First Patient',
        priority: 'routine',
        status: 'waiting',
        service: 'Medicine',
        patient_mrn: 'MRN-001',
      },
      {
        id: 'wait-2',
        patient_id: 'patient-2',
        patient_name: 'Target Patient',
        priority: 'urgent',
        status: 'offered',
        service: 'Surgery',
        patient_mrn: 'MRN-002',
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}));

function renderAppointmentsPage(initialEntry) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppointmentsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppointmentsPage deep links', () => {
  it('opens the waitlist tab and marks the target waitlist entry', () => {
    renderAppointmentsPage('/appointments?tab=waitlist&waitlist=wait-2');

    const target = document.querySelector('[data-omni-target="true"]');
    expect(target).toBeInTheDocument();
    expect(target).toHaveTextContent('Target Patient');
    expect(screen.queryByText('First Patient')?.closest('[data-omni-target]')).toBeNull();
  });

  it('opens the sessions tab from a clinic target', () => {
    renderAppointmentsPage('/appointments?tab=sessions&clinic=clinic-target');

    expect(screen.getByRole('button', { name: /create session/i })).toBeInTheDocument();
    expect(useSchedulingSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ clinic_id: 'clinic-target' }),
    );
    const target = document.querySelector('[data-omni-target="true"]');
    expect(target).toBeInTheDocument();
    expect(target).toHaveTextContent('Target Clinic Morning');
    expect(screen.queryByText('Other Clinic Morning')).not.toBeInTheDocument();
  });
});
