import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getV2NursingTasks } from '@/hooks/nursingQueriesV2Bridge';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { ExpandedPatientDetailPanel } from '@/features/ward-board/components/ExpandedPatientDetailPanel';
import { useWardBoardPatient } from '@/features/ward-board/hooks';
vi.mock('@/features/ward-board/hooks', () => ({ useWardBoardPatient: vi.fn() }));
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch;
const row = { id: 'synthetic-task', patient_id: 'synthetic-patient', admission_case_id: 'synthetic-case', ward_id: 'origin-ward', service_ward_id: 'destination-ward', route_version: 1, task_type: 'observation', status: 'open', due_at: '2026-10-31T12:00:00Z', title: 'Synthetic routed task', assigned_to_user_id: null };
const user = { id: 'synthetic-actor', adminAccess: { capabilities: ['nursing.task.manage'] }, accessContext: { features: ['nursing'], patient_visibility: ['full_clinical'] } };
const patient = { patient_id: row.patient_id, admission_id: row.admission_case_id, ward_id: row.service_ward_id };
const json = value => new Response(JSON.stringify({ data: value, page: { has_next: false, next_cursor: null } }), { status: 200, headers: { 'content-type': 'application/json' } });
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC', getFacilityCode: () => 'QA' }); globalThis.fetch = vi.fn(); vi.mocked(useWardBoardPatient).mockReturnValue({ data: { tasks: [row] }, isLoading: false, isError: false }); });
afterEach(() => { __resetV2ApiClientForTests(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('validates task filtering against effective service ward while preserving immutable origin and route version', async () => {
  fetch.mockResolvedValueOnce(json([row])); const result = await getV2NursingTasks({ patient: row.patient_id, admission: row.admission_case_id, ward: row.service_ward_id }); expect(result[0]).toMatchObject({ ward_id: row.ward_id, service_ward_id: row.service_ward_id, route_version: 1, ward: row.service_ward_id }); expect(new URL(fetch.mock.calls[0][0]).searchParams.get('ward_id')).toBe(row.service_ward_id);
});
it.each(['missing', 'wrong', 'version'])('rejects %s effective-routing evidence instead of guessing it from origin or current admission', async fault => {
  const value = { ...row, ward_id: row.service_ward_id }; if (fault === 'missing') delete value.service_ward_id; if (fault === 'wrong') value.service_ward_id = 'other-ward'; if (fault === 'version') value.route_version = -1; fetch.mockResolvedValueOnce(json([value])); await expect(getV2NursingTasks({ ward: row.service_ward_id })).rejects.toThrow(/scope/);
});
function mount(action = vi.fn()) { render(<AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { access_allowed: true, read_only: false } }}><MemoryRouter><ExpandedPatientDetailPanel patient={patient} onTaskAction={action} /></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider>); return action; }
it('permits a routed task decision in its effective current ward, showing origin separately', () => {
  const action = mount(); expect(screen.getByText(/Created in another ward/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled(); fireEvent.click(screen.getByRole('button', { name: 'Complete' })); expect(action).toHaveBeenCalledWith({ taskId: row.id, patientId: row.patient_id, admissionId: row.admission_case_id, action: 'complete' });
});
it('does not offer a decision from missing effective-routing metadata', () => {
  const value = { ...row }; delete value.service_ward_id; vi.mocked(useWardBoardPatient).mockReturnValue({ data: { tasks: [value] }, isLoading: false, isError: false }); mount(); expect(screen.getByText(/Task routing could not be confirmed/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Complete' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
});
