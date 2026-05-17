import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import AdmissionCaseDetailPage from '../AdmissionCaseDetailPage';

const baseAdmissionCase = {
  id: 'case-1',
  patient: 'patient-1',
  patient_name: 'Kojo Mensah',
  medical_record_number: 'MRN-002',
  status: 'intake_in_progress',
  admission_id: null,
  requested_at: '2026-05-12T08:00:00Z',
  requested_ward_name: 'Medical Ward',
  ready_for_activation_at: null,
  activated_at: null,
  can_activate: false,
  active_reservation: {
    ward_name: 'Medical Ward',
    bed_number: 'B-12',
    reserved_at: '2026-05-12T09:00:00Z',
  },
  tasks: [
    {
      id: 'task-registration',
      task_type: 'registration_completion',
      status: 'pending',
      blocking: true,
      assigned_role: 'admin',
    },
    {
      id: 'task-finance',
      task_type: 'financial_clearance',
      status: 'pending',
      blocking: true,
      assigned_role: 'admin',
    },
    {
      id: 'task-clinical',
      task_type: 'clinical_orientation',
      status: 'pending',
      blocking: true,
      assigned_role: 'admin',
    },
    {
      id: 'task-advisory',
      task_type: 'family_follow_up',
      status: 'pending',
      blocking: false,
      assigned_role: 'admin',
    },
  ],
};
let mockAdmissionCase = { ...baseAdmissionCase };

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}));

vi.mock('@/features/patients/hooks/usePatientQueries', () => ({
  usePatient: () => ({ data: { id: 'patient-1', gender: 'male' } }),
}));

vi.mock('@/features/wards/components/BedAssignment', () => ({
  BedAssignment: () => <div>Bed assignment control</div>,
}));

vi.mock('@/features/admissions/hooks/useAdmissionCaseQueries', () => ({
  useAdmissionCase: () => ({
    data: mockAdmissionCase,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useClearRegistration: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearFinancial: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReserveAdmissionBed: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActivateAdmissionCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompleteAdmissionIntake: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelAdmissionCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompleteAdmissionTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAcknowledgeAdmissionTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admissions/cases/case-1']}>
      <Routes>
        <Route path="/admissions/cases/:caseId" element={<AdmissionCaseDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdmissionCaseDetailPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdmissionCase = { ...baseAdmissionCase };
    useAuth.mockReturnValue({ user: { id: 'user-1', user_type: 'admin' } });
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('hides unsupported task clearance and intake controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.queryByRole('button', { name: /clear registration/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear finance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^complete$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete intake/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/admission task clearance and intake completion are not available for this deployment yet/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel case/i })).toBeInTheDocument();
  });

  it('keeps task workflow controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /clear registration/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear finance/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^complete$/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete intake/i })).toBeInTheDocument();
  });

  it('allows Rust V2 capability-based users to activate admission cases', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    mockAdmissionCase = {
      ...baseAdmissionCase,
      status: 'ready_for_activation',
      can_activate: true,
      active_reservation: {
        ward_name: 'Medical Ward',
        bed_number: 'B-12',
        reserved_at: '2026-05-12T09:00:00Z',
      },
      tasks: [],
    };
    useAuth.mockReturnValue({
      user: {
        id: 'user-1',
        user_type: 'staff',
        adminAccess: {
          capabilities: ['admission.manage', 'ward.manage_beds'],
        },
      },
    });

    renderPage();

    expect(screen.getByRole('button', { name: /activate admission/i })).toBeInTheDocument();
  });
});
