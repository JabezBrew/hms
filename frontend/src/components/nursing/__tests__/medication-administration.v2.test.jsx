import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicationAdministration } from '../MedicationAdministration';

const { administer } = vi.hoisted(() => ({ administer: vi.fn() }));
vi.mock('@/features/nursing/hooks', () => ({
  usePatientMAR: () => ({
    data: { medications: [{ id: 'dose-1', medication_name: 'Test medication', dosage: '1 g', route: 'oral', frequency: 'Daily', scheduled_time: '2026-01-01T08:00:00Z', status: 'scheduled', is_dispensed: true }] },
    isLoading: false, refetch: vi.fn(),
  }),
  useAdministerMedication: () => ({ mutateAsync: administer, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('Medication administration supported outcomes', () => {
  beforeEach(() => { administer.mockResolvedValue({ status: 'administered' }); });
  afterEach(() => { delete window.__HMS_RUNTIME_CONFIG__; });

  it('offers only given-dose recording in Rust V2 and directs other outcomes to nursing notes', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    const user = userEvent.setup();
    render(<MedicationAdministration patient={{ id: 'patient-1' }} />);
    await user.click(screen.getAllByRole('button', { name: /Administer/i })[0]);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('combobox')).toBeDisabled();
    expect(dialog.getByText(/Document missed, refused or held doses/)).toBeInTheDocument();
    expect(dialog.queryByText('Notes (optional)')).not.toBeInTheDocument();
    expect(dialog.queryByText('Reason *')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Record Administration' }));
    expect(administer).toHaveBeenCalledWith(expect.objectContaining({ medicationId: 'dose-1', data: expect.objectContaining({ status: 'administered' }) }));
  });

  it('preserves legacy outcome selection and note inputs', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    const user = userEvent.setup();
    render(<MedicationAdministration patient={{ id: 'patient-1' }} />);
    await user.click(screen.getAllByRole('button', { name: /Administer/i })[0]);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('combobox')).toBeEnabled();
    expect(dialog.getByText('Notes (optional)')).toBeInTheDocument();
    expect(dialog.queryByText(/Document missed, refused or held doses/)).not.toBeInTheDocument();
  });
});
