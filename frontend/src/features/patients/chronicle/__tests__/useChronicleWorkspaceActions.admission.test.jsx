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
