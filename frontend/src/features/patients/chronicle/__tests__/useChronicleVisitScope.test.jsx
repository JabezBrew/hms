import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patientsApi } from '@/features/patients/api';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { findActiveChronicleEncounter, mergeRustV2Encounters } from '../chronicleEncounterUtils';
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


// Exercise the public startup adapter with synthetic HTTP responses. No patient
// access, live authentication, SQL, or clinical write authority is inferred here.
describe('actual startup encounter linkage in visit selection', () => {
  const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
  const originalFetch = globalThis.fetch;
  const patientId = '27272727-1000-4000-8000-000000000001';
  const currentEncounterId = '27272727-1000-4000-8000-000000000002';
  const currentAdmissionId = '27272727-1000-4000-8000-000000000003';
  const olderEncounterId = '27272727-1000-4000-8000-000000000004';
  const olderAdmissionId = '27272727-1000-4000-8000-000000000005';
  const outpatientEncounterId = '27272727-1000-4000-8000-000000000006';
  const recordedAt = '2026-11-04T00:00:00Z';

  function admission(admissionId, encounterId) {
    return { admission_id: admissionId, encounter_id: encounterId, patient_id: patientId,
      status: 'admitted', admitted_at: recordedAt, discharged_at: null, placement_revision: 4 };
  }

  function encounter(id, { linkedAdmission = null, ambiguous = false, type = 'inpatient', status = 'in_progress' } = {}) {
    return { id, patient_id: patientId, encounter_type: type, status, started_at: recordedAt,
      ended_at: null, admission: linkedAdmission, admission_link_ambiguous: ambiguous };
  }

  function startup() {
    // The source-confirmed active context is an independent thin object. Sharing
    // the list object here would conceal the production overwrite regression.
    const thinActive = { id: currentEncounterId, patient_id: patientId, encounter_type: 'inpatient',
      status: 'in_progress', started_at: recordedAt, ended_at: null };
    return {
      patient: { id: patientId, patient_code: 'SYNTHETIC', display_name: 'Synthetic selected patient' },
      active_context: { encounter: thinActive, admission: admission(currentAdmissionId, currentEncounterId) },
      encounters: [
        encounter(currentEncounterId, { linkedAdmission: admission(currentAdmissionId, currentEncounterId) }),
        encounter(olderEncounterId, { linkedAdmission: admission(olderAdmissionId, olderEncounterId), status: 'completed' }),
        encounter(outpatientEncounterId, { type: 'outpatient', status: 'completed' }),
      ],
      timeline: { data: [], page: { has_next: false, next_cursor: null } },
    };
  }

  beforeEach(() => {
    __resetV2ApiClientForTests();
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    configureV2ApiClient({ getAccessToken: () => 'synthetic-selected-visit-token', getFacilityCode: () => 'SYNTHETIC' });
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
    globalThis.fetch = originalFetch;
  });

  async function readStartup(wire) {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: wire }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const source = await patientsApi.getPatientChronicleStartup(patientId);
    expect(fetch).toHaveBeenCalledTimes(1);
    return source;
  }

  function useActualSelection(source, visitParam) {
    const encounters = mergeRustV2Encounters(source);
    return useChronicleVisitScope({ ...defaults, encounters,
      activeEncounter: findActiveChronicleEncounter(encounters),
      activeEncounterId: source.active_encounter?.id,
      rustV2ActiveAdmissionId: source.active_admission?.admission_id,
      visitParam });
  }

  it('retains the confirmed list admission when the same active encounter is thin', async () => {
    const wire = startup();
    expect(wire.active_context.encounter).not.toBe(wire.encounters[0]);
    expect(wire.active_context.encounter).not.toHaveProperty('admission');
    const source = await readStartup(wire);
    expect(source.active_encounter.admission).toBeNull();
    expect(source.encounters[0].admission_id).toBe(currentAdmissionId);
    const { result } = renderHook(() => useActualSelection(source, currentEncounterId));
    expect(result.current.selectedEncounterId).toBe(currentEncounterId);
    expect(result.current.chartContextAdmissionId).toBe(currentAdmissionId);
    expect(result.current.chartContextEncounter.admission.placement_revision).toBe(4);
  });

  it.each(['ambiguous', 'explicit-null'])('does not borrow the global admission when the selected list link is %s', async kind => {
    const wire = startup();
    wire.encounters[0] = encounter(currentEncounterId, { ambiguous: kind === 'ambiguous' });
    const source = await readStartup(wire);
    expect(source.active_admission.admission_id).toBe(currentAdmissionId);
    const { result } = renderHook(() => useActualSelection(source, currentEncounterId));
    expect(result.current.chartContextAdmissionId).toBeNull();
    expect(result.current.chartContextEncounter.admission).toBeNull();
    if (kind === 'ambiguous') expect(result.current.chartContextEncounter.admission_link_ambiguous).toBe(true);
  });

  it('retains an explicitly selected earlier linked admission instead of the current global admission', async () => {
    const source = await readStartup(startup());
    const { result } = renderHook(() => useActualSelection(source, olderEncounterId));
    expect(result.current.selectedEncounterId).toBe(olderEncounterId);
    expect(result.current.chartContextAdmissionId).toBe(olderAdmissionId);
    expect(result.current.chartContextAdmissionId).not.toBe(source.active_admission.admission_id);
  });

  it.each(['older-unlinked', 'outpatient', 'all'])('leaves %s without the unrelated global active admission', async kind => {
    const wire = startup();
    if (kind === 'older-unlinked') wire.encounters[1] = encounter(olderEncounterId, { status: 'completed' });
    const source = await readStartup(wire);
    const visit = kind === 'older-unlinked' ? olderEncounterId : kind === 'outpatient' ? outpatientEncounterId : 'all';
    const { result } = renderHook(() => useActualSelection(source, visit));
    expect(source.active_admission.admission_id).toBe(currentAdmissionId);
    expect(result.current.chartContextAdmissionId).toBeNull();
    if (kind === 'all') expect(result.current.chartContextEncounter).toBeNull();
    else expect(result.current.selectedEncounterId).toBe(visit);
  });

  it('still adds a convenience active encounter absent from the list without inventing its admission link', async () => {
    const wire = startup();
    wire.encounters = wire.encounters.filter(row => row.id !== currentEncounterId);
    const source = await readStartup(wire);
    const merged = mergeRustV2Encounters(source);
    expect(merged).toHaveLength(3);
    expect(merged.filter(row => row.id === currentEncounterId)).toHaveLength(1);
    const { result } = renderHook(() => useActualSelection(source, currentEncounterId));
    expect(result.current.selectedEncounterId).toBe(currentEncounterId);
    expect(result.current.chartContextEncounter.id).toBe(currentEncounterId);
    expect(result.current.chartContextAdmissionId).toBeNull();
  });
});
