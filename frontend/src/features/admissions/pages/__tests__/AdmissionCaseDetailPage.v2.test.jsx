import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/lib/auth';
import AdmissionCaseDetailPage from '../AdmissionCaseDetailPage';
import { user as advisoryUser, patientId as advisoryPatient, caseId as advisoryCase } from '../../advisory/__tests__/fixtures';
import { user as moveUser } from '../../moves/__tests__/fixtures';

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

function ChronicleLocation() { const location = useLocation(); return <div data-testid="chronicle-location">{location.pathname}{location.search}</div>; }

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admissions/cases/case-1']}>
      <Routes>
        <Route path="/admissions/cases/:caseId" element={<AdmissionCaseDetailPage />} />
        <Route path="/patients/:id/chronicle" element={<ChronicleLocation />} />
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

  it('hands off the exact Ready case to Chronicle for explicitly authorized full clinical users', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    mockAdmissionCase = { ...baseAdmissionCase, id: advisoryCase, patient: advisoryPatient, status: 'ready_for_activation', tasks: [] };
    useAuth.mockReturnValue({ user: advisoryUser }); renderPage(); fireEvent.click(screen.getByRole('button', { name: 'Admission follow-up' }));
    const destination = new URL(screen.getByTestId('chronicle-location').textContent, 'http://localhost');
    expect(destination.pathname).toBe(`/patients/${advisoryPatient}/chronicle`); expect(destination.searchParams.get('admission')).toBe(advisoryCase); expect(destination.searchParams.get('visit')).toBe('all'); expect(destination.searchParams.get('action')).toBe('admission_follow_up');
  });

  it('does not infer a follow-up launch from an admin role or Summary visibility', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    useAuth.mockReturnValue({ user: { ...advisoryUser, role: 'admin', accessContext: { ...advisoryUser.accessContext, patient_visibility: ['clinical_summary'] } } }); renderPage(); expect(screen.queryByRole('button', { name: 'Admission follow-up' })).not.toBeInTheDocument();
  });
  it('hands off an actual admitted case for a reviewed move without requiring note or encounter authority', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    mockAdmissionCase = { ...baseAdmissionCase, id: advisoryCase, patient: advisoryPatient, status: 'admitted', admission_id: advisoryCase, tasks: [] };
    useAuth.mockReturnValue({ user: { ...moveUser, accessContext: { ...moveUser.accessContext, features: ['patients', 'admissions'] }, adminAccess: { capabilities: ['admission.manage', 'patient.demographics.view'] } } }); renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Move bed' })); const destination = new URL(screen.getByTestId('chronicle-location').textContent, 'http://localhost');
    expect(destination.searchParams.get('action')).toBe('admission_move'); expect(destination.searchParams.get('admission')).toBe(advisoryCase); expect(destination.searchParams.get('visit')).toBe('all');
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
