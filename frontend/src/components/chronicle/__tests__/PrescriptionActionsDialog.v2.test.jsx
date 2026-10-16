import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import PrescriptionActionsDialog from '../PrescriptionActionsDialog';
import { MedicationContent } from '../TimelineEntryMedicationContent';

const actions = vi.hoisted(() => ({ update: vi.fn(), stop: vi.fn(), hold: vi.fn(), resume: vi.fn(), renew: vi.fn(), rustV2: true }));
vi.mock('@/hooks/usePrescriptionMutations', () => ({
  useUpdatePrescription: () => ({ mutateAsync: actions.update, isPending: false }),
  useDiscontinuePrescription: () => ({ mutateAsync: actions.stop, isPending: false }),
  useHoldPrescription: () => ({ mutateAsync: actions.hold, isPending: false }),
  useResumePrescription: () => ({ mutateAsync: actions.resume, isPending: false }),
  useRenewPrescription: () => ({ mutateAsync: actions.renew, isPending: false }),
}));
vi.mock('@/features/pharmacy/prescribing/PrescriptionCourseDialog', () => ({ PrescriptionCourseDialog: ({ action }) => <p>Reviewed workflow: {action}</p> }));
vi.mock('@/lib/api/v2/runtime', () => ({ isRustV2ApiMode: () => actions.rustV2 }));
const prescription = { id: 'rx-1', patient_id: 'patient-1', medication_name: 'Synthetic medication', dose: '5 mg', frequency: 'daily', duration_days: 7, route: 'oral', status: 'active' };
const renderAction = (action) => render(<PrescriptionActionsDialog open action={action} prescription={prescription} onOpenChange={vi.fn()} />);
const renderMedication = (status) => render(<AuthContext.Provider value={{ user: { adminAccess: { capabilities: ['clinical_documentation.manage'] } } }}><MedicationContent medication={{ ...prescription, status }} /></AuthContext.Provider>);

describe('prescription action compatibility integration', () => {
  beforeEach(() => { actions.rustV2 = true; vi.clearAllMocks(); for (const action of ['update', 'stop', 'hold', 'resume', 'renew']) actions[action].mockResolvedValue({ id: 'rx-1' }); });
  it.each(['view', 'edit', 'renew', 'replace'])('routes Rust %s into the reviewed feature workflow', (action) => { renderAction(action); expect(screen.getByText(`Reviewed workflow: ${action}`)).toBeInTheDocument(); expect(actions.update).not.toHaveBeenCalled(); expect(actions.renew).not.toHaveBeenCalled(); });
  it.each([['discontinue', 'Discontinue', 'stop'], ['hold', 'Put on Hold', 'hold']])('does not collect an unsupported status-action reason for %s', async (action, button, mutation) => { const events = userEvent.setup(); renderAction(action); expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); await events.click(screen.getByRole('button', { name: button })); expect(actions[mutation]).toHaveBeenCalledTimes(1); });
  it('keeps legacy documentation fields available', () => { actions.rustV2 = false; renderAction('edit'); expect(screen.getByLabelText('Special Instructions')).toBeInTheDocument(); });
  it('offers terminal-only reviewed renewal and preserves the stopped badge', async () => { renderMedication('stopped'); expect(screen.getByText('Stopped')).toBeInTheDocument(); expect(screen.queryByText('Active')).not.toBeInTheDocument(); const events = userEvent.setup(); await events.click(screen.getByRole('button', { name: 'Prescription actions' })); expect(screen.getByRole('menuitem', { name: 'Review renewal course' })).toBeInTheDocument(); expect(screen.queryByRole('menuitem', { name: 'Review replacement course' })).not.toBeInTheDocument(); });
  it('offers active-course replacement and dedicated documentation instead of implicit renewal', async () => { renderMedication('active'); const events = userEvent.setup(); await events.click(screen.getByRole('button', { name: 'Prescription actions' })); expect(screen.getByRole('menuitem', { name: 'Edit documentation' })).toBeInTheDocument(); expect(screen.getByRole('menuitem', { name: 'Review replacement course' })).toBeInTheDocument(); expect(screen.queryByRole('menuitem', { name: 'Review renewal course' })).not.toBeInTheDocument(); });
});
