import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TriageQueueList } from './TriageQueueList';

const entries = [
  { id: 't1', patient: 'p1', patient_name: 'Waiting patient', encounter_id: 'e1', visit_id: 'v1', status: 'waiting', priority: 'urgent' },
  { id: 't2', patient: 'p2', patient_name: 'Assigned patient', status: 'assigned', priority: 'emergency', assigned_to_name: 'Test clinician' },
  { id: 't3', patient: 'p3', patient_name: 'Completed patient', status: 'triaged', priority: 'routine' },
  { id: 't4', patient: 'p4', patient_name: 'Cancelled patient', status: 'cancelled', priority: 'routine' },
];
function LocationDisplay() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
function renderQueue(props = {}) {
  const actions = { onTriage: vi.fn(), onAssign: vi.fn(), onCancel: vi.fn() };
  render(<MemoryRouter><TriageQueueList data={{ results: entries }} {...actions} {...props} /><LocationDisplay /></MemoryRouter>);
  return actions;
}
describe('Triage queue actions and patient visibility', () => {
  beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; });
  afterEach(() => { delete window.__HMS_RUNTIME_CONFIG__; });

  it('renders assigned patients and only exposes actions accepted by their Rust state', async () => {
    const user = userEvent.setup();
    const actions = renderQueue();
    const waiting = within(screen.getByRole('region', { name: 'Waiting for assessment' }));
    const assigned = within(screen.getByRole('region', { name: 'Assigned for assessment' }));
    const completed = within(screen.getByRole('region', { name: 'Assessment completed' }));
    const cancelled = within(screen.getByRole('region', { name: 'Cancelled' }));
    expect(assigned.getByText('Assigned patient')).toBeInTheDocument();
    expect(assigned.getByText('Assigned: Test clinician')).toBeInTheDocument();
    expect(waiting.getByRole('button', { name: 'Assign staff' })).toBeInTheDocument();
    expect(assigned.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(completed.queryByRole('button', { name: /^(Assign staff|Reassign staff|Assess|Cancel)$/ })).not.toBeInTheDocument();
    expect(cancelled.queryByRole('button', { name: /^(Assign staff|Reassign staff|Assess|Cancel)$/, exact: true })).not.toBeInTheDocument();
    await user.click(assigned.getByRole('button', { name: 'Assess' }));
    await user.click(assigned.getByRole('button', { name: 'Reassign staff' }));
    expect(actions.onTriage).toHaveBeenCalledWith(entries[1]);
    expect(actions.onAssign).toHaveBeenCalledWith(entries[1]);
  });

  it('opens the exact encounter in Chronicle and never treats a visit id as an encounter', async () => {
    const user = userEvent.setup();
    renderQueue();
    await user.click(screen.getByRole('button', { name: 'Waiting patient' }));
    expect(screen.getByRole('status')).toHaveTextContent('/patients/p1?visit=e1');
    await user.click(screen.getByRole('button', { name: 'Assigned patient' }));
    expect(screen.getByRole('status')).toHaveTextContent('/patients/p2');
  });

  it('keeps the legacy post-assessment clinic assignment action', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    renderQueue();
    expect(screen.getByRole('button', { name: 'Assign to Clinic' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign staff' })).not.toBeInTheDocument();
  });
});
