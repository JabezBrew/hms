import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PractitionerAvailabilityPage from '../PractitionerAvailabilityPage';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { role: 'admin' },
  }),
}));

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}));

vi.mock('@/features/appointments/hooks/useAppointmentQueries', () => ({
  useAvailabilityRules: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useBlockedTimes: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDeleteAvailabilityRule: () => ({ mutate: vi.fn() }),
  useDeleteBlockedTime: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/features/encounters/hooks/useEncounterQueries', () => ({
  useSearchPractitioners: () => ({
    data: [],
    isLoading: false,
    setSearchTerm: vi.fn(),
  }),
}));

vi.mock('@/features/staff/hooks', () => ({
  usePractitioner: () => ({ data: null }),
  usePractitioners: () => ({ data: [] }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/practitioner-availability']}>
      <PractitionerAvailabilityPage />
    </MemoryRouter>,
  );
}

describe('PractitionerAvailabilityPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('hides availability and blocked-time mutation controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.queryByRole('button', { name: /new rule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /block time/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create rule/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/availability rule and blocked-time management is not available in this deployment/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/rust v2/i)).not.toBeInTheDocument();
  });

  it('keeps availability mutation controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /block time/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /create rule/i })).toBeInTheDocument();
  });
});
