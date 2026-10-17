import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useChronicleRouteState } from '@/features/patients/chronicle/useChronicleRouteState';
import { useChronicleWorkspaceActions } from '@/features/patients/chronicle/useChronicleWorkspaceActions';
import { buildChronicleWorkspaceProps, chronicleWorkspaceLoaders } from '@/features/patients/chronicle/workspaceRegistry';
import { caseId, ids, patientId, wardId } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('captures exact-case route intent before URL cleanup and loads the workspace lazily without active-case substitution', async () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; const open = vi.fn(), clear = vi.fn();
  renderHook(() => useChronicleRouteState({ id: patientId, search: `?action=admission_move&admission=${caseId}&visit=all`, openChronicleWorkspace: open, clearQueryParams: clear })); await waitFor(() => expect(open).toHaveBeenCalledWith('admissionMove', { moveAdmissionId: caseId })); expect(clear).toHaveBeenCalled();
  const { result } = renderHook(() => useChronicleWorkspaceActions({ id: patientId, workspaceOptions: { moveAdmissionId: caseId }, chartContextAdmissionId: ids[20], chartContextEncounter: { id: ids[21], admission: { id: ids[20], placement_revision: 9, ward_id: wardId } }, slideOvers: {} }));
  const props = buildChronicleWorkspaceProps('admissionMove', { ...result.current.workspaceContext, patient: { id: patientId } });
  expect(props).toMatchObject({ requestedAdmissionId: caseId, selectedAdmissionId: ids[20], placementRevision: null }); expect(typeof chronicleWorkspaceLoaders.admissionMove).toBe('function');
});
it('propagates same-case physical revision separately from selected ward authority and never borrows current admission under all history', () => {
  const { result, rerender } = renderHook(({ revision }) => useChronicleWorkspaceActions({ id: patientId, chartContextAdmissionId: caseId, chartContextEncounter: { id: ids[21], admission: { id: caseId, placement_revision: revision, ward_id: wardId } }, slideOvers: {} }), { initialProps: { revision: 4 } });
  expect(result.current.workspaceContext).toMatchObject({ selectedWardId: wardId, selectedPlacementRevision: 4 }); rerender({ revision: 5 }); expect(result.current.workspaceContext).toMatchObject({ selectedWardId: wardId, selectedPlacementRevision: 5 });
  const props = buildChronicleWorkspaceProps('admissionMove', { patient: { current_admission_id: caseId }, selectedAdmissionId: null, chronicleAllHistory: true }); expect(props.selectedAdmissionId).toBeNull(); expect(props.requestedAdmissionId).toBeNull();
});
