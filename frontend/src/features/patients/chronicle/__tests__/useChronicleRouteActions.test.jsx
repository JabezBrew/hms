import { StrictMode, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChronicleRouteActions } from '../useChronicleRouteActions';
import { useChronicleRouteState } from '../useChronicleRouteState';

describe('Chronicle navigation commands', () => {
  it('opens once with unstable callbacks while cleanup navigation is deferred, including StrictMode replay', () => {
    const opened = vi.fn();
    const clearQueryParams = vi.fn();
    function Harness({ action = 'add_note', intentScope = 'patient-1:encounter-1:navigation-1' }) {
      const [workspace, setWorkspace] = useState(null);
      const [draft, setDraft] = useState('');
      useChronicleRouteActions({
        intentScope, canOpenClinicalActions: true,
        actionParam: action, noteTitleParam: 'Discharge Summary', noteTypeParam: 'doctor_note',
        clearQueryParams,
        openChronicleWorkspace: (_id, options) => {
          opened(options);
          if (opened.mock.calls.length > 8) throw new Error('Navigation command replayed');
          setWorkspace(options);
        },
      });
      return <>
        <p>{workspace ? 'Note workspace open' : 'No workspace'}</p>
        <label>Note draft<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      </>;
    }
    const { rerender } = render(<StrictMode><Harness /></StrictMode>);
    expect(screen.getByText('Note workspace open')).toBeInTheDocument();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(clearQueryParams).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Note draft'), { target: { value: 'Clinician entered content' } });
    rerender(<StrictMode><Harness /></StrictMode>);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Note draft')).toHaveValue('Clinician entered content');
    // An explicit new navigation can intentionally request the identical action.
    rerender(<StrictMode><Harness intentScope="patient-1:encounter-1:navigation-2" /></StrictMode>);
    expect(opened).toHaveBeenCalledTimes(2);
    // A cleaned URL also releases the previous command, preserving a future request.
    rerender(<StrictMode><Harness action={null} /></StrictMode>);
    rerender(<StrictMode><Harness /></StrictMode>);
    expect(opened).toHaveBeenCalledTimes(3);
  });

  it('does not consume a command before clinical access is ready and scopes future commands to patient and encounter', () => {
    const opened = vi.fn();
    function Harness({ allowed, patientId, encounterId }) {
      useChronicleRouteActions({
        intentScope: `${patientId}:${encounterId}`, canOpenClinicalActions: allowed,
        actionParam: 'add_note', clearQueryParams: vi.fn(), openChronicleWorkspace: opened,
      });
      return null;
    }
    const { rerender } = render(<Harness allowed={false} patientId="patient-1" encounterId="encounter-1" />);
    expect(opened).not.toHaveBeenCalled();
    rerender(<Harness allowed patientId="patient-1" encounterId="encounter-1" />);
    expect(opened).toHaveBeenCalledTimes(1);
    rerender(<Harness allowed patientId="patient-2" encounterId="encounter-2" />);
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it('waits for the requested care encounter before opening a patient-scoped workspace', () => {
    const opened = vi.fn();
    function Harness({ encounters, loading = false, allowed = true }) {
      useChronicleRouteState({
        id: 'patient-1', locationKey: 'navigation-1',
        search: '?action=add_note&visit=encounter-1',
        patient: { id: 'patient-1' }, canOpenClinicalActions: allowed,
        encounters, areEncountersLoading: loading,
        clearQueryParams: vi.fn(), openChronicleWorkspace: opened,
      });
      return null;
    }
    const { rerender } = render(<Harness encounters={[]} loading />);
    expect(opened).not.toHaveBeenCalled();
    rerender(<Harness encounters={[{ id: 'other-encounter' }]} />);
    expect(opened).not.toHaveBeenCalled();
    rerender(<Harness encounters={[{ id: 'encounter-1' }]} allowed={false} />);
    expect(opened).not.toHaveBeenCalled();
    rerender(<Harness encounters={[{ id: 'encounter-1' }]} />);
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
