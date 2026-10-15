import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const { reserveMutation, activateMutation } = vi.hoisted(() => ({ reserveMutation: vi.fn(), activateMutation: vi.fn() }));

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
  BedAssignment: ({ onBedSelect }) => <button onClick={() => onBedSelect({ id: 'selected-bed' })}>Choose fixture bed</button>,
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
  useReserveAdmissionBed: () => ({ mutateAsync: reserveMutation, isPending: false }),
  useActivateAdmissionCase: () => ({ mutateAsync: activateMutation, isPending: false }),
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
    reserveMutation.mockResolvedValue({});
    activateMutation.mockResolvedValue({});
    mockAdmissionCase = { ...baseAdmissionCase };
    useAuth.mockReturnValue({ user: { id: 'user-1', user_type: 'admin' } });
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('hides unsupported task clearance and intake controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    mockAdmissionCase = { ...baseAdmissionCase, status: 'ready_for_activation' };

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

  it('keeps native request bed selection, reservation, and activation available in the eligible phase', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    mockAdmissionCase = { ...baseAdmissionCase, status: 'ready_for_activation', can_activate: true, active_reservation: null, tasks: [] };
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('button', { name: 'Cancel Case' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reserve Selected Bed' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Choose fixture bed' }));
    await user.click(screen.getByRole('button', { name: 'Reserve Selected Bed' }));
    expect(reserveMutation).toHaveBeenCalledWith({ caseId: 'case-1', data: { bed_id: 'selected-bed' } });
    await user.click(screen.getByRole('button', { name: 'Activate Admission' }));
    expect(activateMutation).toHaveBeenCalledWith({ caseId: 'case-1', data: {} });
    const summary = within(screen.getByText('Admission Summary').closest('[data-slot="card"]'));
    expect(summary.getByText('Requested')).toBeInTheDocument();
    expect(summary.queryByText('Ready for Activation')).not.toBeInTheDocument();
    expect(summary.getByText('Admitted')).toBeInTheDocument();
    expect(summary.getByText('Discharged')).toBeInTheDocument();
  });

  it('shows a native reserved bed without inventing a reservation timestamp', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    mockAdmissionCase = { ...baseAdmissionCase, status: 'ready_for_activation', can_activate: true, tasks: [] };
    renderPage();
    expect(screen.getByText('Bed Reserved')).toBeInTheDocument();
    expect(screen.queryByText(/Reserved at/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate Admission' })).toBeInTheDocument();
  });

  it.each(['admitted', 'discharge_pending'])('shows occupied native placement without pre-admission actions for %s', (status) => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    mockAdmissionCase = { ...baseAdmissionCase, status, admission_id: status === 'admitted' ? 'case-1' : null, admitted_at: '2026-05-13T10:00:00Z', can_activate: true, tasks: [] };
    renderPage();
    expect(screen.getByText('Bed Occupied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active Stay' })).toBeInTheDocument();
    expect(screen.queryByText('Bed Reserved')).not.toBeInTheDocument();
    expect(screen.queryByText('Placement', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel Case' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate Admission' })).not.toBeInTheDocument();
  });

  it.each(['discharged', 'cancelled'])('shows actual terminal case facts without actionable stay or reservation claims for %s', (status) => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    mockAdmissionCase = {
      ...baseAdmissionCase, status, admission_id: 'stale-active-stay', can_activate: true, tasks: [],
      admitted_at: '2026-05-13T10:00:00Z', discharged_at: status === 'discharged' ? '2026-05-14T12:00:00Z' : null,
      ready_for_activation_at: '2099-01-01T00:00:00Z', activated_at: '2099-01-01T00:00:00Z',
    };
    renderPage();
    expect(screen.getByText(status === 'cancelled' ? 'Cancelled' : 'discharged', { exact: true })).toBeInTheDocument();
    for (const label of ['Cancel Case', 'Activate Admission', 'Active Stay', 'Reserve Selected Bed']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Placement', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Bed Reserved')).not.toBeInTheDocument();
    expect(screen.queryByText('Bed Occupied')).not.toBeInTheDocument();
    const summary = within(screen.getByText('Admission Summary').closest('[data-slot="card"]'));
    expect(summary.getByText('Requested').nextElementSibling).toHaveTextContent('May 12');
    expect(summary.getByText('Admitted').nextElementSibling).toHaveTextContent('May 13');
    expect(summary.getByText('Discharged').nextElementSibling).toHaveTextContent(status === 'discharged' ? 'May 14' : 'Not set');
    expect(summary.queryByText('Ready for Activation')).not.toBeInTheDocument();
    expect(summary.queryByText(/2099/)).not.toBeInTheDocument();
  });

  it('preserves legacy readiness, reservation timing, and pre-activation presentation', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    mockAdmissionCase = { ...baseAdmissionCase, ready_for_activation_at: '2026-05-12T09:00:00Z' };
    renderPage();
    expect(screen.getByText('Bed Reserved')).toBeInTheDocument();
    expect(screen.getByText(/Reserved at/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel Case' })).toBeInTheDocument();
    const summary = within(screen.getByText('Admission Summary').closest('[data-slot="card"]'));
    expect(summary.getByText('Ready for Activation').nextElementSibling).toHaveTextContent('May 12');
    expect(summary.getByText('Activated')).toBeInTheDocument();
  });
});
