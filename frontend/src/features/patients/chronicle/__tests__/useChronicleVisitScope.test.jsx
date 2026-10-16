import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useChronicleVisitScope } from '../useChronicleVisitScope';
const active = { id: 'current-visit', admission_id: 'current-admission' };
const earlier = { id: 'earlier-visit', admission_id: 'earlier-admission' };
const outpatient = { id: 'outpatient-visit' };
const defaults = { activeEncounter: active, activeEncounterId: active.id, encounters: [active, earlier, outpatient], areEncountersLoading: false, canFetchClinical: true, rustV2ActiveAdmissionId: 'current-admission', navigate: vi.fn(), pathname: '/synthetic-chronicle', search: '', formatEncounterScopeLabel: (row) => row.id };
it('uses the selected earlier admission rather than the active admission', () => {
  const { result } = renderHook(() => useChronicleVisitScope({ ...defaults, visitParam: earlier.id }));
  expect(result.current.chartContextAdmissionId).toBe(earlier.admission_id); expect(result.current.chartContextEncounter).toBe(earlier);
});
it.each(['all', outpatient.id])('does not silently choose the current admission for %s', (visitParam) => {
  const { result } = renderHook(() => useChronicleVisitScope({ ...defaults, visitParam }));
  expect(result.current.chartContextAdmissionId).toBeNull();
});
it('does not borrow the active encounter while an explicit selected visit is unresolved', () => {
  const { result } = renderHook(() => useChronicleVisitScope({ ...defaults, encounters: [], areEncountersLoading: true, visitParam: 'pending-visit' }));
  expect(result.current.chartContextAdmissionId).toBeNull(); expect(result.current.chartContextEncounter).toBeNull();
});
it('preserves the actual selected current admission and clears it on all-history changes', () => {
  const { result, rerender } = renderHook(({ visitParam }) => useChronicleVisitScope({ ...defaults, visitParam }), { initialProps: { visitParam: active.id } });
  expect(result.current.chartContextAdmissionId).toBe(active.admission_id); rerender({ visitParam: 'all' }); expect(result.current.chartContextEncounter).toBeNull(); expect(result.current.chartContextAdmissionId).toBeNull();
});
