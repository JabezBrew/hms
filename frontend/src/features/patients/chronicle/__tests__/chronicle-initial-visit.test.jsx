// Actual record + visit hooks; only query lifecycle and non-owning peripheral
// hooks are injected. This does not prove native auth/transport/clock admission.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useChroniclePatientRecord } from '../useChroniclePatientRecord';
import { useChronicleVisitScope } from '../useChronicleVisitScope';

const state = vi.hoisted(() => ({ startup: null }));
vi.mock('@/features/patients/hooks/usePatientQueries', () => ({
  usePatientChronicleStartup: () => state.startup,
  usePatient: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
}));
vi.mock('@/features/billing/hooks', () => ({ usePatientInsurance: () => ({ data: null }) }));
vi.mock('@/features/encounters/hooks/useEncounterQueries', () => ({ usePatientEncounters: () => ({ data: [], isLoading: false, refetch: vi.fn() }) }));
vi.mock('@/hooks/useChronicleContext', () => ({ useChronicleContext: () => ({ data: null, isLoading: false, refetch: vi.fn() }) }));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }));

const ids = Array.from({ length: 8 }, (_, i) => `27272727-0027-4272-8272-${String(i + 1).padStart(12, '0')}`);
const [patientId, encounterA, admissionA, outpatient, older, admissionOlder, globalAdmissionB, invalid] = ids;
const linked = (id, admission, status = 'in-progress') => ({ id, patient_id: patientId, encounter_type: 'inpatient', status,
  admission_id: admission, admission: { id: admission, admission_id: admission, patient_id: patientId, encounter_id: id } });
const startup = () => ({ patient: { id: patientId, name: 'Synthetic initial visit patient' },
  encounters: [linked(encounterA, admissionA), { id: outpatient, patient_id: patientId, encounter_type: 'outpatient', status: 'in-progress', admission: null }, linked(older, admissionOlder, 'finished')],
  // The thin active duplicate and unrelated global admission cannot authorize a
  // selected visit. The actual merge/visit helpers decide from the linked row.
  active_encounter: { id: encounterA, patient_id: patientId, encounter_type: 'inpatient', status: 'in-progress' },
  active_admission: { admission_id: globalAdmissionB },
});
const query = (data, extra = {}) => ({ data, isLoading: false, isFetchedAfterMount: true, error: null, refetch: vi.fn(), ...extra });
function useSubject(visitParam) {
  const record = useChroniclePatientRecord({ id: patientId, rustV2Mode: true });
  const visit = useChronicleVisitScope({ activeEncounter: record.activeEncounter, activeEncounterId: record.chronicleContext?.active_encounter?.id,
    areEncountersLoading: record.areEncountersLoading, canFetchClinical: record.canFetchClinical, encounters: record.encounters,
    visitParam, search: `?mode=ward-round&visit=${visitParam}`, pathname: '/synthetic-chronicle', navigate: vi.fn(), formatEncounterScopeLabel: () => 'Synthetic visit' });
  return { record, visit };
}
beforeEach(() => { state.startup = query(undefined, { isLoading: true, isFetchedAfterMount: false }); });

it('preserves the requested visit while initial startup is pending, then forwards its exact linked admission', async () => {
  const view = renderHook(() => useSubject(encounterA));
  expect(view.result.current.record.areEncountersLoading).toBe(true);
  expect(view.result.current.visit.visitScopeRedirectSearch).toBeNull();
  expect(view.result.current.visit.resolvedVisitScope).toBe(encounterA);
  expect(view.result.current.visit.chartContextAdmissionId).toBeNull();
  await act(async () => { state.startup = query(startup()); view.rerender(); });
  await waitFor(() => expect(view.result.current.record.areEncountersLoading).toBe(false));
  expect(view.result.current.visit.visitScopeRedirectSearch).toBeNull();
  expect(view.result.current.visit.selectedEncounterId).toBe(encounterA);
  expect(view.result.current.visit.chartContextAdmissionId).toBe(admissionA);
});
it('does not treat a cached projection awaiting this mount authorization as ready', () => {
  state.startup = query(startup(), { isLoading: false, isFetchedAfterMount: false });
  const { result } = renderHook(() => useSubject(encounterA));
  expect(result.current.record.patient).toBeUndefined();
  expect(result.current.record.areEncountersLoading).toBe(true);
  expect(result.current.visit.visitScopeRedirectSearch).toBeNull();
  expect(result.current.visit.chartContextAdmissionId).toBeNull();
});
it.each([403, 500])('does not normalize retry intent or fabricate readiness on startup status %s', status => {
  state.startup = query(startup(), { error: Object.assign(new Error('Synthetic startup refusal'), { status }) });
  const { result } = renderHook(() => useSubject(encounterA));
  expect(result.current.record.canFetchClinical).toBe(false);
  expect(result.current.record.areEncountersLoading).toBe(true);
  expect(result.current.visit.visitScopeRedirectSearch).toBeNull();
  expect(result.current.visit.chartContextAdmissionId).toBeNull();
});
it('normalizes an invalid visit only after actual fresh startup is ready', async () => {
  const view = renderHook(() => useSubject(invalid));
  expect(view.result.current.visit.resolvedVisitScope).toBe(invalid);
  expect(view.result.current.visit.visitScopeRedirectSearch).toBeNull();
  await act(async () => { state.startup = query(startup()); view.rerender(); });
  await waitFor(() => expect(view.result.current.record.areEncountersLoading).toBe(false));
  expect(new URLSearchParams(view.result.current.visit.visitScopeRedirectSearch).get('visit')).toBe(encounterA);
  expect(view.result.current.visit.chartContextAdmissionId).toBe(admissionA);
});
it.each([{ selected: 'all', admission: null }, { selected: outpatient, admission: null }, { selected: older, admission: admissionOlder }])('keeps exact history/outpatient/older visit scope $selected without a global fallback', async ({ selected, admission }) => {
  state.startup = query(startup()); const { result } = renderHook(() => useSubject(selected));
  await waitFor(() => expect(result.current.record.areEncountersLoading).toBe(false));
  expect(result.current.visit.visitScopeRedirectSearch).toBeNull();
  expect(result.current.visit.chartContextAdmissionId).toBe(admission);
  expect(result.current.visit.chartContextAdmissionId).not.toBe(globalAdmissionB);
});
it('suppresses automatic redirection when clinical access is absent even if a caller marks the list loaded', () => {
  const { result } = renderHook(() => useChronicleVisitScope({ activeEncounter: null, activeEncounterId: null, areEncountersLoading: false,
    canFetchClinical: false, encounters: [], visitParam: encounterA, search: `?mode=ward-round&visit=${encounterA}`, navigate: vi.fn(), formatEncounterScopeLabel: () => 'Synthetic visit' }));
  expect(result.current.visitScopeRedirectSearch).toBeNull();
  expect(result.current.chartContextAdmissionId).toBeNull();
});
