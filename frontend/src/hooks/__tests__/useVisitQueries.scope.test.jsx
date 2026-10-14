import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScopedQueryKey, getAuthQueryScope } from '@/shared/lib/queryKeys';
import { triageKeys, useTriageQueue, useTriageEntry, useVisit, useWaitingRoom } from '../useVisitQueries';

const mocks = vi.hoisted(() => ({
  auth: {},
  list: vi.fn(),
  entry: vi.fn(),
  visit: vi.fn(),
  waitingRoom: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/features/triage/api', () => ({
  triageApi: { list: mocks.list, get: mocks.entry },
  visitsApi: { get: mocks.visit, waitingRoom: mocks.waitingRoom },
}));

function auth(overrides = {}) {
  return {
    facilityCode: 'SYNTHETIC',
    user: {
      id: 'synthetic-clinician',
      email: 'private-email@synthetic.invalid',
      accessContext: {
        facility_id: 'synthetic-facility',
        active_profile: 'hospital',
        session_version: 1,
        permission_version: 1,
        permissions: ['patient.demographics.view', 'triage.view'],
        features: ['patients', 'triage'],
        patient_visibility: ['demographics'],
        ...overrides,
      },
    },
  };
}

describe('visit and triage authorization cache scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = auth();
  });

  it('changes the opaque scope for every authorization fact and keeps identifying input out of keys', () => {
    const original = getAuthQueryScope(auth());
    for (const change of [
      { facility_id: 'other-facility' },
      { active_profile: 'clinic' },
      { session_version: 2 },
      { permission_version: 2 },
      { permissions: [] },
      { features: [] },
      { patient_visibility: [] },
    ]) {
      expect(getAuthQueryScope(auth(change))).not.toBe(original);
    }
    const otherUser = auth();
    otherUser.user.id = 'another-clinician';
    expect(getAuthQueryScope(otherUser)).not.toBe(original);
    const switchedFacility = auth();
    switchedFacility.facilityCode = 'OTHER-SYNTHETIC';
    expect(getAuthQueryScope(switchedFacility)).not.toBe(original);
    const switchedRole = auth();
    switchedRole.user.role = 'nurse';
    expect(getAuthQueryScope(switchedRole)).not.toBe(original);
    expect(getAuthQueryScope(auth({ permissions: ['triage.view', 'patient.demographics.view'] }))).toBe(original);
    const key = triageKeys.list({ search: 'private-patient-search' }, original);
    expect(JSON.stringify(key)).not.toContain('private-patient-search');
    expect(JSON.stringify(key)).not.toContain('synthetic-clinician');
    expect(JSON.stringify(key)).not.toContain('private-email');
    expect(createScopedQueryKey(['triage'], original)).toEqual(['triage', 'scope', original]);
    const legacy = { facilityCode: 'SYNTHETIC', user: { id: 'legacy-user', role: 'doctor', adminAccess: { capabilities: ['patient.view'] } } };
    const legacyScope = getAuthQueryScope(legacy);
    expect(getAuthQueryScope({ ...legacy, user: { ...legacy.user, role: 'nurse' } })).not.toBe(legacyScope);
    expect(getAuthQueryScope({ ...legacy, user: { ...legacy.user, adminAccess: { capabilities: [] } } })).not.toBe(legacyScope);
  });

  it.each([
    ['triage queue', () => useTriageQueue(), mocks.list],
    ['triage entry', () => useTriageEntry('synthetic-entry'), mocks.entry],
    ['visit', () => useVisit('synthetic-visit'), mocks.visit],
    ['waiting room', () => useWaitingRoom('synthetic-clinic'), mocks.waitingRoom],
  ])('does not display cached %s data after permissions change in the same session', async (_label, hook, api) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    api.mockResolvedValueOnce({ syntheticSensitiveRecord: true });
    const { result, rerender, unmount } = renderHook(hook, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ syntheticSensitiveRecord: true });

    mocks.auth = auth({ permissions: [], permission_version: 2 });
    api.mockRejectedValueOnce(new Error('permission denied'));
    rerender();
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(api).toHaveBeenCalledTimes(2);
    unmount();
    queryClient.clear();
  });
});
