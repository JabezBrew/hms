import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { patientsApi } from '@/features/patients/api';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { mergeRustV2Encounters } from '@/features/patients/chronicle/chronicleEncounterUtils';
import { useChronicleVisitScope } from '@/features/patients/chronicle/useChronicleVisitScope';
import { useChronicleWorkspaceActions } from '@/features/patients/chronicle/useChronicleWorkspaceActions';
import { at, caseId, encounterId, ids, json, patientId, wardId } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, oldFetch = globalThis.fetch;
const admission = revision => ({ admission_id: caseId, encounter_id: encounterId, placement_revision: revision, patient_id: patientId, ward_id: wardId, ward_name: 'Synthetic selected ward', bed_id: ids[5], bed_code: 'S-01', status: 'admitted', admitted_at: at, discharged_at: null });
function startup(revision = 4) { const encounter = { id: encounterId, patient_id: patientId, encounter_type: 'inpatient', status: 'in_progress', started_at: at, ended_at: null, admission: admission(revision), admission_link_ambiguous: false }; return { patient: { id: patientId, patient_code: 'SYNTHETIC', display_name: 'Synthetic patient' }, active_context: { encounter, admission: admission(revision) }, active_encounter: encounter, active_admission: admission(revision), encounters: [encounter], timeline: { data: [], page: { has_next: false, next_cursor: null } } }; }
beforeEach(() => { __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'synthetic-selected-token', getFacilityCode: () => 'QA' }); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = runtime; globalThis.fetch = oldFetch; });
function useSelected(source, selected = encounterId) {
  const visits = useChronicleVisitScope({ activeEncounter: source.active_encounter, activeEncounterId: source.active_encounter?.id, encounters: mergeRustV2Encounters(source), canFetchClinical: true, areEncountersLoading: false, visitParam: selected, formatEncounterScopeLabel: row => row.id, navigate: vi.fn(), pathname: '/synthetic', search: '' });
  return useChronicleWorkspaceActions({ chartContextEncounter: visits.chartContextEncounter, chartContextAdmissionId: visits.chartContextAdmissionId, isAllVisitsScope: visits.isAllVisitsScope, id: patientId, slideOvers: {} }).workspaceContext;
}
it('carries the actual selected encounter case/revision through transport, adapter, visit scope and workspace props across same-ward moves', async () => {
  fetch.mockResolvedValueOnce(json({ data: startup(4) })); const first = await patientsApi.getPatientChronicleStartup(patientId); const { result, rerender } = renderHook(({ source }) => useSelected(source), { initialProps: { source: first } }); expect(result.current).toMatchObject({ selectedAdmissionId: caseId, selectedWardId: wardId, selectedPlacementRevision: 4 });
  fetch.mockResolvedValueOnce(json({ data: startup(5) })); const next = await patientsApi.getPatientChronicleStartup(patientId); rerender({ source: next }); expect(result.current).toMatchObject({ selectedAdmissionId: caseId, selectedWardId: wardId, selectedPlacementRevision: 5 }); expect(new URL(fetch.mock.calls[0][0]).pathname).toBe(`/api/v2/patients/${patientId}/chronicle`);
});
it.each(['ambiguous', 'missing', 'all'])('never borrows the active case when selected linkage is %s', async kind => {
  const source = startup(); source.encounters[0] = { ...source.encounters[0], admission: null, admission_link_ambiguous: kind === 'ambiguous' }; source.active_context.encounter = source.encounters[0]; source.active_encounter = source.encounters[0];
  fetch.mockResolvedValueOnce(json({ data: source })); const read = await patientsApi.getPatientChronicleStartup(patientId); const { result } = renderHook(() => useSelected(read, kind === 'all' ? 'all' : encounterId)); expect(result.current.selectedAdmissionId).toBeNull(); expect(result.current.selectedPlacementRevision).toBeNull(); expect(result.current.selectedWardId).toBeNull();
});
it.each(['patient', 'encounter'])('rejects a wrong-but-valid %s admission linkage rather than rendering a foreign placement', async kind => { const source = startup(); source.encounters[0].admission[kind === 'patient' ? 'patient_id' : 'encounter_id'] = ids[20]; fetch.mockResolvedValueOnce(json({ data: source })); await expect(patientsApi.getPatientChronicleStartup(patientId)).rejects.toThrow(/could not be confirmed/); });
