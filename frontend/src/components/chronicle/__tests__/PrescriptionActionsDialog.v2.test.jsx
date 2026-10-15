import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/lib/api/v2/runtime', () => ({ isRustV2ApiMode: () => actions.rustV2 }));

const prescription = { id: 'rx-1', patient_id: 'patient-1', medication_name: 'Medication', dose: '5 mg', frequency: 'daily', duration_days: 7, route: 'oral', status: 'active' };
const renderAction = (action) => render(<PrescriptionActionsDialog open action={action} prescription={prescription} onOpenChange={vi.fn()} />);

describe('Rust V2 prescription lifecycle controls', () => {
  beforeEach(() => {
    actions.rustV2 = true;
    for (const action of ['update', 'stop', 'hold', 'resume', 'renew']) actions[action].mockResolvedValue({ id: 'rx-1' });
  });

  it('edits the supported duration without offering instructions that cannot be saved', async () => {
    const user = userEvent.setup();
    renderAction('edit');
    expect(screen.getByLabelText('Dosage *')).toHaveValue('5 mg');
    expect(screen.queryByLabelText('Special Instructions')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Duration (days)'), { target: { value: '14' } });
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith({
      prescriptionId: 'rx-1', data: { dosage: '5 mg', frequency: 'daily', duration_days: 14 },
    }));
  });

  it('does not present a blank update duration as clearing an existing course', async () => {
    const user = userEvent.setup();
    renderAction('edit');
    fireEvent.change(screen.getByLabelText('Duration (days)'), { target: { value: '' } });
    expect(screen.getByText('Leave empty to keep the current duration.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith({
      prescriptionId: 'rx-1', data: { dosage: '5 mg', frequency: 'daily' },
    }));
  });

  it.each([['discontinue', 'Discontinue', 'stop'], ['hold', 'Put on Hold', 'hold']])('does not collect an unsupported reason for %s', async (action, button, mutation) => {
    const user = userEvent.setup();
    renderAction(action);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(actions[mutation]).toHaveBeenCalledTimes(1));
  });

  it('blocks forced renewal and offers a clear close action', () => {
    renderAction('renew');
    expect(screen.getByText(/create a new prescription from the current care context/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renew' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
    expect(actions.renew).not.toHaveBeenCalled();
  });

  it('keeps instructions available in the legacy workflow', () => {
    actions.rustV2 = false;
    renderAction('edit');
    expect(screen.getByLabelText('Special Instructions')).toBeInTheDocument();
  });

  it('renders the Rust stopped state without an Active badge', () => {
    render(<MedicationContent medication={{ ...prescription, status: 'stopped' }} />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prescription actions' })).not.toBeInTheDocument();
  });

  it('omits unavailable renewal from the active medication menu', async () => {
    const user = userEvent.setup();
    render(<MedicationContent medication={prescription} />);
    await user.click(screen.getByRole('button', { name: 'Prescription actions' }));
    expect(screen.getByRole('menuitem', { name: 'Edit Prescription' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Renew' })).not.toBeInTheDocument();
  });
});
