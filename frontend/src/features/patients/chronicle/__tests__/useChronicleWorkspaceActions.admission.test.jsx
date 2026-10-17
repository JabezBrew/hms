import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useChronicleWorkspaceActions } from '../useChronicleWorkspaceActions';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

function actions(overrides = {}) {
  const props = { rustV2Mode: true, activeEncounter: { id: 'encounter-id' }, openChronicleWorkspace: vi.fn(), setRequestedTreatmentSheetAdmissionId: vi.fn(), ...overrides };
  const { result } = renderHook(() => useChronicleWorkspaceActions(props));
  act(() => result.current.handleViewTreatmentSheet());
  return props;
}

describe('Chronicle treatment sheet admission routing', () => {
  it('uses the authoritative admission case rather than the active encounter identifier', () => {
    const props = actions({ rustV2ActiveAdmissionId: 'current-admission-case' });
    expect(props.setRequestedTreatmentSheetAdmissionId).toHaveBeenCalledWith('current-admission-case');
    expect(props.openChronicleWorkspace).toHaveBeenCalledWith('treatmentSheet');
  });
  it('refuses to invent an admission from a Rust encounter without admission evidence', () => {
    const props = actions();
    expect(props.setRequestedTreatmentSheetAdmissionId).not.toHaveBeenCalled();
    expect(props.openChronicleWorkspace).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('No active admission found for this patient');
  });
  it('retains the older inpatient identifier fallback outside Rust mode', () => {
    const props = actions({ rustV2Mode: false });
    expect(props.setRequestedTreatmentSheetAdmissionId).toHaveBeenCalledWith('encounter-id');
  });
});

it.each([undefined, { can_add_note: false, can_record_vitals: false, can_prescribe: false }])('does not open a direct write or copy a note without current server action proof (%j)', (clinicalPermissions) => {
  const open = vi.fn(); const { result } = renderHook(() => useChronicleWorkspaceActions({ rustV2Mode: true, clinicalPermissions, openChronicleWorkspace: open })); act(() => { result.current.handleAddNote(); result.current.handleRecordVitals(); result.current.handlePrescribe(); result.current.handleCopyNote({ template: { id: 'synthetic' }, data: { assessment: 'SYNTHETIC-PRIVATE' } }); result.current.handleEditNote({ template: { id: 'synthetic' }, data: {} }); }); expect(open).not.toHaveBeenCalled(); expect(result.current.workspaceContext.copyForwardData).toBeNull(); expect(result.current.workspaceContext.editNoteData).toBeNull();
});
it('uses each current authoritative write flag independently', () => {
  const open = vi.fn(); const { result } = renderHook(() => useChronicleWorkspaceActions({ rustV2Mode: true, clinicalPermissions: { can_add_note: true, can_record_vitals: false, can_prescribe: false }, openChronicleWorkspace: open })); act(() => { result.current.handleAddNote(); result.current.handleRecordVitals(); result.current.handlePrescribe(); }); expect(open.mock.calls).toEqual([['note']]);
});

it('opens the separate read-only template preview only with current Full proof', () => {
  const open = vi.fn(); const { result, rerender } = renderHook((props) => useChronicleWorkspaceActions({ rustV2Mode: true, openChronicleWorkspace: open, ...props }), { initialProps: { clinicalPermissions: { can_view_full_clinical: false } } }); act(() => result.current.handlePreviewNoteTemplate()); expect(open).not.toHaveBeenCalled(); rerender({ clinicalPermissions: { can_view_full_clinical: true, can_add_note: false } }); act(() => result.current.handlePreviewNoteTemplate()); expect(open).toHaveBeenCalledWith('noteTemplatePreview');
});
