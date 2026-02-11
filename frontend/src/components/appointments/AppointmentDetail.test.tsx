import { describe, it, expect, vi } from 'vitest';

import AppointmentDetail from './AppointmentDetail';
import { renderWithProviders } from '../../../tests/utils/test-utils';

vi.mock('@/features/appointments/hooks/useAppointmentQueries', () => {
  return {
    useAppointment: () => ({
      data: {
        id: 'appt-1',
        status: 'booked',
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
    useDeleteAppointment: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  };
});

describe('AppointmentDetail', () => {
  it('renders a local appointment payload without crashing', () => {
    const { getAllByText, getByText } = renderWithProviders(
      <AppointmentDetail appointmentId="appt-1" />,
      { useMemoryRouter: true, route: '/appointments/appt-1' }
    );

    expect(getAllByText('Pat One').length).toBeGreaterThan(0);
    expect(getByText(/with/i)).toBeInTheDocument();
    expect(getAllByText('Doc Two').length).toBeGreaterThan(0);
  });
});
