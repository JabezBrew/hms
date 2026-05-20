import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import AppointmentDetail from './AppointmentDetail';
import { renderWithProviders } from '../../../tests/utils/test-utils';

let appointmentStatus = 'booked';

vi.mock('@/features/appointments/hooks/useAppointmentQueries', () => {
  return {
    useAppointment: () => ({
      data: {
        id: 'appt-1',
        status: appointmentStatus,
        start_time: '2026-02-08T22:10:00Z',
        end_time: '2026-02-08T22:40:00Z',
        patient: 'patient-1',
        patient_details: {
          id: 'patient-1',
          user_details: {
            first_name: 'Pat',
            last_name: 'One',
          },
        },
        practitioner: 'practitioner-1',
        practitioner_details: {
          id: 'practitioner-1',
          staff_details: {
            user_details: {
              first_name: 'Doc',
              last_name: 'Two',
            },
          },
        },
        reason: 'Checkup',
        notes: 'Bring labs',
      },
      isLoading: false,
      isError: false,
      error: null,
    }),
    useUpdateAppointmentStatus: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
    useCancelAppointment: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
    useDeleteAppointment: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  };
});

describe('AppointmentDetail', () => {
  beforeEach(() => {
    appointmentStatus = 'booked';
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('renders a local appointment payload without crashing', () => {
    const { getAllByText, getByText } = renderWithProviders(
      <AppointmentDetail appointmentId="appt-1" />,
      { useMemoryRouter: true, route: '/appointments/appt-1' }
    );

    expect(getAllByText('Pat One').length).toBeGreaterThan(0);
    expect(getByText(/with/i)).toBeInTheDocument();
    expect(getAllByText('Doc Two').length).toBeGreaterThan(0);
  });

  it('hides unsupported delete and arbitrary status controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    const { getByRole, queryByRole } = renderWithProviders(
      <AppointmentDetail appointmentId="appt-1" />,
      { useMemoryRouter: true, route: '/appointments/appt-1' }
    );

    expect(queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: /change status/i })).not.toBeInTheDocument();
    expect(getByRole('button', { name: /check in/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /cancel appointment/i })).toBeInTheDocument();
  });

  it('hides Rust V2 appointment edit and cancellation after check-in', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    appointmentStatus = 'arrived';

    const { queryByRole } = renderWithProviders(
      <AppointmentDetail appointmentId="appt-1" />,
      { useMemoryRouter: true, route: '/appointments/appt-1' }
    );

    expect(queryByRole('button', { name: /check in/i })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: /cancel appointment/i })).not.toBeInTheDocument();
  });

  it('keeps legacy delete and arbitrary status controls outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    const { getByRole, queryByRole } = renderWithProviders(
      <AppointmentDetail appointmentId="appt-1" />,
      { useMemoryRouter: true, route: '/appointments/appt-1' }
    );

    expect(getByRole('button', { name: /change status/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(queryByRole('button', { name: /check in/i })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: /cancel appointment/i })).not.toBeInTheDocument();
  });
});
