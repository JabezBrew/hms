import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TriageAssessmentDialog } from './TriageAssessmentDialog';

const { assess, saveVitals } = vi.hoisted(() => ({ assess: vi.fn(), saveVitals: vi.fn() }));
vi.mock('@/hooks/useVisitQueries', () => ({
  useTriageActions: () => ({ triagePatient: { mutateAsync: assess, isPending: false } }),
}));
vi.mock('@/hooks/useChartQueries', () => ({
  useCreateChartEntries: () => ({ mutateAsync: saveVitals, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderAssessment(props = {}) {
  const callbacks = { onSuccess: vi.fn(), onClose: vi.fn() };
  render(<TriageAssessmentDialog open entry={{ id: 'triage-1', patient_id: 'patient-1', visit_id: 'visit-1', encounter_id: 'encounter-1', patient_name: 'Test patient', priority: 'routine' }} {...callbacks} {...props} />);
  return callbacks;
}

async function enterTwoVitals(user) {
  await user.type(screen.getByLabelText('Temperature (C)'), '37.2');
  await user.type(screen.getByLabelText('Pulse (bpm)'), '80');
}

describe('Triage assessment persistence and recovery', () => {
  beforeEach(() => { assess.mockResolvedValue({ id: 'triage-1' }); saveVitals.mockResolvedValue([{ id: 'measurement-1' }]); });

  it('preserves encounter and visit context for every measurement', async () => {
    const user = userEvent.setup();
    const callbacks = renderAssessment();
    await enterTwoVitals(user);
    await user.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await waitFor(() => expect(callbacks.onSuccess).toHaveBeenCalledOnce());
    expect(assess).toHaveBeenCalledOnce();
    expect(saveVitals).toHaveBeenCalledTimes(2);
    for (const [entries] of saveVitals.mock.calls) {
      expect(entries).toEqual([expect.objectContaining({ patient_id: 'patient-1', encounter_id: 'encounter-1', visit_id: 'visit-1' })]);
    }
  });

  it('retains failed measurements and retries only the unsaved vital, without repeating assessment', async () => {
    let pulseFailed = false;
    saveVitals.mockImplementation(async ([entry]) => {
      if (entry.entry_type === 'pulse' && !pulseFailed) { pulseFailed = true; throw new Error('Temporary save failure'); }
      return [{ id: 'measurement-1' }];
    });
    const user = userEvent.setup();
    const callbacks = renderAssessment();
    await enterTwoVitals(user);
    await user.click(screen.getByRole('button', { name: 'Save Assessment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Assessment saved. Vitals still need to be saved.');
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Pulse (bpm)')).toHaveValue(80);
    expect(screen.getByLabelText('Temperature (C)')).toHaveValue(37.2);
    const failedEntry = saveVitals.mock.calls.find(([entries]) => entries[0].entry_type === 'pulse')[0][0];
    await user.click(screen.getByRole('button', { name: 'Retry Saving Vitals' }));
    await waitFor(() => expect(callbacks.onSuccess).toHaveBeenCalledOnce());
    expect(assess).toHaveBeenCalledOnce();
    expect(saveVitals).toHaveBeenCalledTimes(3);
    expect(saveVitals.mock.calls[2][0]).toEqual([failedEntry]);
  });

  it('requires an explicit discard decision when closing with unsaved vitals', async () => {
    saveVitals.mockRejectedValue(new Error('Offline'));
    const user = userEvent.setup();
    const callbacks = renderAssessment();
    await user.type(screen.getByLabelText('Pulse (bpm)'), '80');
    await user.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Close assessment', exact: true }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Close with unsaved vitals?');
    expect(callbacks.onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep measurements' }));
    expect(screen.getByLabelText('Pulse (bpm)')).toHaveValue(80);
    await user.click(screen.getByRole('button', { name: 'Close assessment', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Discard unsaved vitals' }));
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });

  it('keeps all entered values when assessment itself fails and makes no vital writes', async () => {
    assess.mockRejectedValue(new Error('Offline'));
    const user = userEvent.setup();
    const callbacks = renderAssessment();
    await enterTwoVitals(user);
    await user.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Assessment' })).toBeEnabled());
    expect(saveVitals).not.toHaveBeenCalled();
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Pulse (bpm)')).toHaveValue(80);
  });

  it('prevents closing while persistence is in progress', async () => {
    let completeAssessment;
    assess.mockImplementation(() => new Promise((resolve) => { completeAssessment = resolve; }));
    const user = userEvent.setup();
    const callbacks = renderAssessment();
    await user.click(screen.getByRole('button', { name: 'Save Assessment' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled());
    await user.keyboard('{Escape}');
    expect(callbacks.onClose).not.toHaveBeenCalled();
    completeAssessment({ id: 'triage-1' });
    await waitFor(() => expect(callbacks.onSuccess).toHaveBeenCalledOnce());
  });
});
