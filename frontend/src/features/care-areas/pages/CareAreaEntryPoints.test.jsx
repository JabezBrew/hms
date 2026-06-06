import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EmergencyCareAreaPage from './EmergencyCareAreaPage';
import InpatientCareAreaPage from './InpatientCareAreaPage';
import OutpatientCareAreaPage from './OutpatientCareAreaPage';

vi.mock('@/features/dashboards/hooks', () => ({
  useDashboardModuleGates: () => ({
    appointmentsEnabled: true,
    patientChronicleEnabled: true,
    patientRegistrationEnabled: true,
    emergencyEncountersEnabled: true,
    outpatientEncountersEnabled: true,
  }),
}));

vi.mock('@/features/ward-board/hooks', () => ({
  useWardBoardContext: () => ({
    data: {
      assigned_wards: [],
      can_view_all_wards: false,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/features/wards/hooks/useWardQueries', () => ({
  useWards: () => ({
    data: {
      results: [
        {
          id: 'ward-1',
          name: 'Medical Ward',
          code: 'MW',
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useOrganization', () => ({
  useClinics: () => ({
    data: {
      results: [
        {
          id: 'clinic-1',
          name: 'General Clinic',
          code: 'GEN',
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useVisitQueries', () => ({
  useTriageQueue: () => ({
    data: { results: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useWaitingRoom: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}));

function renderCareArea(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('care-area identity entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes outpatient intake to Find or Register with clinic scope', () => {
    renderCareArea(<OutpatientCareAreaPage />);

    expect(screen.getByRole('link', { name: /Find or register/i })).toHaveAttribute(
      'href',
      '/patients/find-or-register?intent=outpatient&clinic_id=clinic-1',
    );
  });

  it('routes inpatient ward intake to Find or Register with ward scope', () => {
    renderCareArea(<InpatientCareAreaPage />);

    expect(screen.getByRole('link', { name: /Find or register/i })).toHaveAttribute(
      'href',
      '/patients/find-or-register?intent=inpatient&ward_id=ward-1',
    );
  });

  it('routes emergency walk-in intake to Find or Register with emergency intent', () => {
    renderCareArea(<EmergencyCareAreaPage />);

    expect(screen.getByText('Add Walk-In')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start/i })).toHaveAttribute(
      'href',
      '/patients/find-or-register?intent=emergency',
    );
  });
});
