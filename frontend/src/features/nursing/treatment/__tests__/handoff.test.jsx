import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import PatientIdentityHero from '@/components/chronicle/PatientIdentityHero';
import { buildChronicleWorkspaceProps } from '@/features/patients/chronicle/workspaceRegistry';
import { useChronicleWorkspaceActions } from '@/features/patients/chronicle/useChronicleWorkspaceActions';
import { patientId, caseId, otherCaseId } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
afterEach(() => { cleanup(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('passes the actual selected historical admission and never substitutes current admission in all history', () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; const context = { patient: { id: patientId, local_data: { current_admission_id: otherCaseId } }, selectedAdmissionId: caseId, clinicalPermissions: { can_view_full_clinical: true }, onReviewPrescriptions: vi.fn(), onReviewSelectedAdmissionMar: vi.fn() };
  expect(buildChronicleWorkspaceProps('medicationCourses', context)).toMatchObject({ selectedAdmissionId: caseId, allHistory: false, clinicalPermissions: context.clinicalPermissions, onReviewPrescriptions: context.onReviewPrescriptions, onReviewMar: context.onReviewSelectedAdmissionMar });
  expect(buildChronicleWorkspaceProps('medicationCourses', { ...context, chronicleAllHistory: true })).toMatchObject({ selectedAdmissionId: null, allHistory: true });
});
it('opens actual selected-case MAR rather than a different current stay or encounter ID', () => {
  const open = vi.fn(); const set = vi.fn(); const { result, rerender } = renderHook((props) => useChronicleWorkspaceActions({ openChronicleWorkspace: open, setRequestedTreatmentSheetAdmissionId: set, rustV2ActiveAdmissionId: otherCaseId, activeEncounter: { id: 'synthetic-encounter' }, chartContextAdmissionId: caseId, ...props }));
  act(() => result.current.handleViewMedicationCourses()); expect(open).toHaveBeenCalledWith('medicationCourses');
  act(() => result.current.workspaceContext.onReviewSelectedAdmissionMar()); expect(set).toHaveBeenCalledWith(caseId); expect(open).toHaveBeenLastCalledWith('treatmentSheet');
  open.mockClear(); set.mockClear(); rerender({ isAllVisitsScope: true }); act(() => result.current.handleViewSelectedAdmissionMar()); expect(set).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});
it('exposes medication courses for a selected historical stay without requiring an active-stay badge', async () => {
  const open = vi.fn(); render(<PatientIdentityHero patient={{ name: 'Synthetic course patient', local_data: { medical_record_number: 'SYNTHETIC-COURSE' } }} onViewMedicationCourses={open} />);
  await userEvent.click(screen.getByRole('button', { name: 'More actions' })); await userEvent.click(await screen.findByRole('menuitem', { name: 'Medication courses' })); expect(open).toHaveBeenCalledOnce();
});
it('clears an explicit MAR target on close so a later ordinary launch cannot reuse the previous historical case', () => {
  const clearMar = vi.fn(); const close = vi.fn(); const { result } = renderHook(() => useChronicleWorkspaceActions({ setRequestedTreatmentSheetAdmissionId: clearMar, setRequestedDischargeAdmissionId: vi.fn(), slideOvers: { close } })); act(() => result.current.workspaceContext.onClose()); expect(close).toHaveBeenCalledOnce(); expect(clearMar).toHaveBeenCalledWith(null);
});
