import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import PatientIdentityHero from '@/components/chronicle/PatientIdentityHero';
import { buildChronicleWorkspaceProps } from '@/features/patients/chronicle/workspaceRegistry';
import { useChronicleWorkspaceActions } from '@/features/patients/chronicle/useChronicleWorkspaceActions';
import { useChronicleRouteActions } from '@/features/patients/chronicle/useChronicleRouteActions';
import { canUseAdmissionAdvisories } from '../access';
import { user, patientId, caseId, otherCaseId } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
afterEach(() => { cleanup(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('passes explicit Ready-case handoff while all-history never substitutes a current admission', () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
  const value = buildChronicleWorkspaceProps('admissionAdvisory', { patient: { id: patientId, local_data: { current_admission_id: otherCaseId } }, selectedAdmissionId: otherCaseId, chronicleAllHistory: true, requestedAdvisoryCaseId: caseId, clinicalPermissions: { can_view_full_clinical: true } }); expect(value.requestedCaseId).toBe(caseId); expect(value.selectedAdmissionId).toBeNull(); expect(value.allHistory).toBe(true);
});
it('opens an exact case route command without granting its clinical access', () => {
  const open = vi.fn(); const clear = vi.fn(); renderHook(() => useChronicleRouteActions({ actionParam: 'admission_follow_up', admissionParam: caseId, openChronicleWorkspace: open, clearQueryParams: clear })); expect(open).toHaveBeenCalledWith('admissionAdvisory', { advisoryCaseId: caseId }); expect(clear).toHaveBeenCalledOnce();
});
it('launches patient case selection from the workspace action without an active-case fallback', () => {
  const open = vi.fn(); const { result } = renderHook(() => useChronicleWorkspaceActions({ openChronicleWorkspace: open, patient: { current_admission_id: otherCaseId } })); act(() => result.current.handleViewAdmissionFollowUp()); expect(open).toHaveBeenCalledWith('admissionAdvisory');
});
it('uses actual Full, features and explicit capabilities rather than role inference', () => {
  expect(canUseAdmissionAdvisories(user, true)).toBe(true); expect(canUseAdmissionAdvisories(user, false)).toBe(false); expect(canUseAdmissionAdvisories({ role: 'admin' }, true)).toBe(false); expect(canUseAdmissionAdvisories({ ...user, adminAccess: { capabilities: ['clinical_documentation.view'] } }, true)).toBe(false);
});
it('exposes the real admission follow-up launch in the clinician menu without requiring an active stay', async () => {
  const open = vi.fn(); render(<PatientIdentityHero patient={{ name: 'Synthetic follow-up patient', local_data: { medical_record_number: 'SYNTHETIC-ADVISORY' } }} onViewAdmissionFollowUp={open} />); await userEvent.click(screen.getByRole('button', { name: 'More actions' })); await userEvent.click(await screen.findByRole('menuitem', { name: 'Admission follow-up' })); expect(open).toHaveBeenCalledOnce();
});
