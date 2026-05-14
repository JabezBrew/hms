import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppointmentTypeManager from './AppointmentTypeManager';

vi.mock('@/features/appointments/hooks/useAppointmentQueries', () => ({
  useAppointmentTypes: () => ({
    data: [
      {
        id: 'general',
        name: 'General',
        duration_minutes: 30,
        description: 'Default appointment type',
        color: '#1976D2',
        is_active: true,
        category: 'in_person',
      },
    ],
    isLoading: false,
  }),
  useCreateAppointmentType: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAppointmentType: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAppointmentType: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('AppointmentTypeManager Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('lists default appointment types but hides unsupported management controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    render(<AppointmentTypeManager />);

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add new/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/edit/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/delete/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/appointment type management is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps management controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    render(<AppointmentTypeManager />);

    expect(screen.getByRole('button', { name: /add new/i })).toBeInTheDocument();
    expect(screen.getByTitle(/edit/i)).toBeInTheDocument();
    expect(screen.getByTitle(/delete/i)).toBeInTheDocument();
  });
});
