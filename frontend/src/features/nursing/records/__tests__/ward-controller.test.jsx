import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { useWardBoardPageController } from '@/features/ward-board/pages/useWardBoardPageController';
const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
const patients = [{ patient_id: 'synthetic-a', admission_id: 'admission-a', ward_id: 'synthetic-ward' }, { patient_id: 'synthetic-b', admission_id: 'admission-b', ward_id: 'synthetic-ward' }];
vi.mock('@/features/ward-board/hooks', () => ({ useWardBoard: () => ({ data: { results: patients }, isLoading: false }), useWardBoardContext: () => ({ data: { assigned_wards: [], can_view_all_wards: true }, isLoading: false }), useWardBoardTaskAction: () => ({ mutate: mocks.mutate }), useWardBoardLiveUpdates: () => ({ isConnected: false }) }));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => ({}) }));
vi.mock('@/shared/hooks/useAfterInitialPaint', () => ({ useAfterInitialPaint: () => true }));
const user = { id: 'synthetic-actor', accessContext: { facility_id: 'synthetic-facility', active_profile: 'hospital' } };
const decision = { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 };
const runtime = window.__HMS_RUNTIME_CONFIG__; let success, errors;
beforeEach(() => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token' });
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal: { id: user.id, facility_id: 'synthetic-facility', active_profile: 'hospital' } }).update({ confirmed: true, decision });
  mocks.mutate.mockReset(); success = vi.spyOn(toast, 'success').mockImplementation(() => undefined); errors = vi.spyOn(toast, 'error').mockImplementation(() => undefined);
});
afterEach(() => { success.mockRestore(); errors.mockRestore(); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
function Wrapper({ children }) { return <AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision }}><MemoryRouter initialEntries={['/wards/synthetic-ward/board']}><Routes><Route path="/wards/:wardId/board" element={children} /></Routes></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider>; }
function start(result, patientId, taskId) { act(() => result.current.actions.handleOpenPatientDetail(patientId)); act(() => result.current.actions.handleTaskAction({ patientId, taskId, admissionId: patientId === 'synthetic-a' ? 'admission-a' : 'admission-b', action: 'complete' })); }
it('clears the originating pending decision after A→B→settle→A without publishing a stale patient result', () => {
  const { result } = renderHook(() => useWardBoardPageController(), { wrapper: Wrapper }); start(result, 'synthetic-a', 'task-a');
  const callbacks = mocks.mutate.mock.calls[0][1]; expect(mocks.mutate.mock.calls[0][0]).toMatchObject({ patientId: 'synthetic-a', admissionId: 'admission-a' });
  act(() => result.current.actions.handleOpenPatientDetail('synthetic-b')); expect(result.current.board.pendingAction).toBeNull();
  act(() => { callbacks.onSuccess(); callbacks.onSettled(); }); act(() => result.current.actions.handleOpenPatientDetail('synthetic-a'));
  expect(result.current.board.pendingAction).toBeNull(); expect(success).not.toHaveBeenCalled();
  act(() => result.current.actions.handleTaskAction({ patientId: 'synthetic-a', taskId: 'task-a', action: 'complete' })); expect(mocks.mutate).toHaveBeenCalledTimes(2);
});
it('does not let a delayed earlier-patient callback clear a newer pending decision', () => {
  const { result } = renderHook(() => useWardBoardPageController(), { wrapper: Wrapper }); start(result, 'synthetic-a', 'task-a'); const previous = mocks.mutate.mock.calls[0][1];
  start(result, 'synthetic-b', 'task-b'); const next = mocks.mutate.mock.calls[1][1];
  act(() => { previous.onError(new Error('Synthetic earlier context error')); previous.onSettled(); });
  expect(result.current.board.pendingAction).toMatchObject({ taskId: 'task-b' }); expect(errors).not.toHaveBeenCalled();
  act(() => next.onSettled()); expect(result.current.board.pendingAction).toBeNull();
});
