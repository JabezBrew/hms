import { beforeEach, describe, expect, it, vi } from 'vitest';
import { patientsApi } from '../index';
const mocks = vi.hoisted(() => ({ request: vi.fn(), legacy: vi.fn(), native: true }));
vi.mock('@/lib/api/v2/client', () => ({ v2Request: mocks.request }));
vi.mock('@/lib/api/v2/runtime', () => ({ isRustV2ApiMode: () => mocks.native }));
vi.mock('@/lib/api/patients', () => ({ patientsApi: { requestBreakGlass: mocks.legacy } }));
vi.mock('@/lib/api/my-patients', () => ({ myPatientsApi: {} }));
beforeEach(() => { vi.clearAllMocks(); mocks.native = true; mocks.request.mockResolvedValue({ data: { id: 'synthetic-grant' } }); });
describe('audited native break-glass adapter', () => {
  it('uses generated native paths and suppresses automatic authentication refresh/replay', async () => {
    const payload = { category: 'handover_or_assignment_gap', reason_text: 'Synthetic urgent reason' };
    expect(await patientsApi.requestBreakGlass('synthetic-patient', payload)).toEqual({ id: 'synthetic-grant' });
    expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'POST', path: '/api/v2/patients/{id}/break-glass', pathParams: { id: 'synthetic-patient' }, body: payload, skipAuthRefresh: true }));
    await patientsApi.endBreakGlass('synthetic-patient');
    expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'POST', path: '/api/v2/patients/{id}/break-glass/end', pathParams: { id: 'synthetic-patient' }, body: undefined, skipAuthRefresh: true }));
  });
  it('preserves server errors and never retries a failed native write', async () => {
    const error = { status: 403, data: { error: { code: 'reauth_required' } } };
    mocks.request.mockRejectedValue(error);
    await expect(patientsApi.requestBreakGlass('synthetic-patient', { category: 'urgent_clinical_continuity' })).rejects.toBe(error);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('preserves the legacy adapter when Rust mode is disabled', async () => {
    mocks.native = false;
    mocks.legacy.mockResolvedValue({ break_glass: { expires_at: 'synthetic-expiry' } });
    const payload = { reason: 'Synthetic legacy reason', scope: 'clinical' };
    await patientsApi.requestBreakGlass('synthetic-patient', payload);
    expect(mocks.legacy).toHaveBeenCalledExactlyOnceWith('synthetic-patient', payload);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
