import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPrescription } from '@/hooks/usePrescriptionMutations';
import { useDispenseMedication } from '@/hooks/useNursingQueries';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { patientId, prescriptionId, requestId, user } from './fixtures';
const principal = { id: user.id, facility_id: user.accessContext.facility_id, active_profile: 'hospital' };
const json = (data) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
const originalFetch = globalThis.fetch; const runtime = window.__HMS_RUNTIME_CONFIG__;
function activate() { const guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-stock-authority', principal }); guard.update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal); }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'synthetic-private-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); activate(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
async function assertDurableBlock() { expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); resetWriteUncertaintyForTests({ preserveStorage: true }); activate(); await expect(v2Request({ method: 'POST', path: '/api/v2/patients/{patient_id}/clinical/prescriptions', pathParams: { patient_id: patientId }, body: { medication_name: 'Synthetic different command', dose: '1 tablet', frequency: 'daily' } })).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(globalThis.fetch).toHaveBeenCalledTimes(1); const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); for (const secret of [patientId, prescriptionId, requestId, 'SYNTHETIC-PRIVATE', 'synthetic-private-token']) expect(stored).not.toContain(secret); }
it.each([null, { stock_unit: 'tablet', stock_units_per_dose: 1 }])('keeps a saved create with an ignored or changed policy uncertain after remount (%j) without following up with MAR', async (scheduled_stock_policy) => {
  globalThis.fetch.mockResolvedValueOnce(json({ id: prescriptionId, patient_id: patientId, inventory_item_id: requestId, scheduled_stock_policy }));
  await expect(createPrescription({ patient_id: patientId, medication_name: 'SYNTHETIC-PRIVATE-MEDICATION', dose: '500 mg', frequency: 'daily', inventory_item_id: requestId, scheduled_stock_policy: { expected_stock_unit: 'tablet', stock_units_per_dose: 2 }, generate_mar: true, admission_case_id: requestId })).rejects.toMatchObject({ name: 'PrescriptionWriteUnconfirmedError' }); await assertDurableBlock();
});
it('keeps a malformed physical stock receipt uncertain after a real supply attempt and remount', async () => {
  globalThis.fetch.mockResolvedValueOnce(json({ fulfillment: { id: requestId, inventory_item_id: prescriptionId, requested_dose_count: 1, dispensed_dose_count: 1, frequency: 'daily', scheduled_stock_policy: { stock_unit: 'tablet', stock_units_per_dose: 2 } }, dispensed_dose_count: 1, remaining_dose_count: 0, issued_stock_quantity: 1, issued_stock_unit: 'tablet' }));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 2 } } }); const { result, unmount } = renderHook(() => useDispenseMedication(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await act(async () => { await expect(result.current.mutateAsync({ fulfillmentId: requestId, itemId: prescriptionId, locationId: patientId, quantity: 1, stockPolicy: { stock_unit: 'tablet', stock_units_per_dose: 2 } })).rejects.toMatchObject({ name: 'PharmacyDispenseUnconfirmedError' }); }); unmount(); client.clear(); await assertDurableBlock();
});
