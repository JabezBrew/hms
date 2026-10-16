import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { ExpandedPatientDetailPanel } from '@/features/ward-board/components/ExpandedPatientDetailPanel';
import { useWardBoardPatient } from '@/features/ward-board/hooks';
vi.mock('@/features/ward-board/hooks', () => ({ useWardBoardPatient: vi.fn() }));
const runtime = window.__HMS_RUNTIME_CONFIG__;
const patient = { patient_id: 'synthetic-patient', admission_id: 'synthetic-admission', patient_name: 'Synthetic patient' };
const user = { id: 'synthetic-user', adminAccess: { capabilities: ['nursing.task.manage'] }, accessContext: { patient_visibility: ['full_clinical'], features: ['nursing'] } };
const tasks = Array.from({ length: 13 }, (_, i) => ({ id: `synthetic-task-${i}`, title: `Synthetic nursing task ${i + 1}`, patient_id: patient.patient_id, status: 'open', _action_source: 'nursing_task' }));
const action = vi.fn();
function panel(actor = user, network = { confirmed: true, decision: { access_allowed: true, read_only: false } }) { return <AuthContext.Provider value={{ user: actor }}><ReadOnlyModeProvider network={network}><MemoryRouter><ExpandedPatientDetailPanel patient={patient} onTaskAction={action} /></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider>; }
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; vi.mocked(useWardBoardPatient).mockReturnValue({ data: { tasks }, isLoading: false, isError: false }); action.mockClear(); });
afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('makes tasks beyond the eighth row reachable and omits unsupported priority and acknowledgment claims', () => {
  render(panel()); expect(screen.queryByRole('columnheader', { name: 'Ack' })).not.toBeInTheDocument(); expect(screen.queryByRole('columnheader', { name: 'Priority' })).not.toBeInTheDocument(); expect(screen.queryByText('Synthetic nursing task 13')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next tasks' })); expect(screen.getByText('Synthetic nursing task 13')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Next tasks' })).toBeDisabled();
  expect(useWardBoardPatient).toHaveBeenCalledWith('synthetic-patient', { admissionId: 'synthetic-admission', enabled: true });
});
it('removes cached task narratives immediately on Full-to-Summary downgrade', () => {
  const view = render(panel()); expect(screen.getByText('Synthetic nursing task 1')).toBeInTheDocument();
  view.rerender(panel({ ...user, accessContext: { ...user.accessContext, patient_visibility: ['clinical_summary'] } }));
  expect(screen.queryByText('Synthetic nursing task 1')).not.toBeInTheDocument(); expect(screen.getByText(/Task details require full clinical/)).toBeInTheDocument(); expect(useWardBoardPatient).toHaveBeenLastCalledWith('synthetic-patient', { admissionId: 'synthetic-admission', enabled: false });
});
it('shows read failure instead of stale cached task text and disables decisions on a read-only connection', () => {
  const view = render(panel(user, { confirmed: true, decision: { access_allowed: true, read_only: true } })); expect(screen.getAllByRole('button', { name: 'Complete' }).every((button) => button.disabled)).toBe(true);
  vi.mocked(useWardBoardPatient).mockReturnValue({ data: { tasks }, isLoading: false, isError: true, error: new Error('Synthetic task refresh unavailable') }); view.rerender(panel()); expect(screen.getByText('Synthetic task refresh unavailable')).toBeInTheDocument(); expect(screen.queryByText('Synthetic nursing task 1')).not.toBeInTheDocument();
});

it('labels a captured earlier ward and offers retirement without treating it as current-ward work', () => {
  const previousWardTask = { ...tasks[0], ward_id: 'synthetic-previous-ward', admission_case_id: patient.admission_id };
  vi.mocked(useWardBoardPatient).mockReturnValue({ data: { tasks: [previousWardTask] }, isLoading: false, isError: false });
  render(<AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { access_allowed: true, read_only: false } }}><MemoryRouter><ExpandedPatientDetailPanel patient={{ ...patient, ward_id: 'synthetic-current-ward' }} onTaskAction={action} /></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider>);
  expect(screen.getByText('Recorded for an earlier ward')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Complete' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(action).toHaveBeenCalledWith({ taskId: previousWardTask.id, patientId: patient.patient_id, admissionId: patient.admission_id, action: 'cancel' });
});
