import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TriageAssignDialog } from './TriageAssignDialog';
import { appointmentsApi } from '@/features/appointments/api';
import { clinicsApi } from '@/features/clinics/api';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    facilityCode: 'HMS',
  }),
}));

vi.mock('@/hooks/useVisitQueries', () => ({
  useTriageActions: () => ({
    assignToClinic: {
      mutate: vi.fn(),
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
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('requires a practitioner assignment in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderDialog();

    expect(screen.getByText('Practitioner *')).toBeInTheDocument();
    expect(screen.getByText(/select a practitioner before assigning/i)).toBeInTheDocument();
    expect(screen.queryByText(/rust v2/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Any available')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign to clinic/i })).toBeDisabled();
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
