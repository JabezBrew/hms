import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  EmergencyQueueTable,
  OutpatientVisitTable,
} from './CareAreaWorkTables';

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('care area work tables', () => {
  it('links outpatient rows to Chronicle with a real encounter scope when available', () => {
    renderWithRouter(
      <OutpatientVisitTable
        clinicName="General Clinic"
        visits={[
          {
            id: 'visit-1',
            visit_id: 'visit-1',
            encounter_id: 'encounter-1',
            patient_id: 'patient-1',
            patient_name: 'Patient One',
            patient_mrn: 'MRN-1',
            visit_status: 'called',
            checked_in_at: '2026-06-06T09:00:00Z',
          },
          {
            id: 'visit-2',
            visit_id: 'visit-2',
            encounter_id: null,
            patient_id: 'patient-2',
            patient_name: 'Patient Two',
            patient_mrn: 'MRN-2',
            visit_status: 'waiting',
            checked_in_at: '2026-06-06T09:15:00Z',
          },
        ]}
      />,
    );

    const chronicleLinks = screen.getAllByRole('link', { name: /chronicle/i });
    expect(chronicleLinks[0]).toHaveAttribute('href', '/patients/patient-1?visit=encounter-1');
    expect(chronicleLinks[1]).toHaveAttribute('href', '/patients/patient-2');
  });

  it('shows emergency assignment fields without loading full patient records', () => {
    renderWithRouter(
      <EmergencyQueueTable
        entries={[
          {
            id: 'triage-1',
            visit_id: 'visit-1',
            encounter_id: 'encounter-1',
            patient_id: 'patient-1',
            patient_name: 'Patient One',
            patient_mrn: 'MRN-1',
            acuity: 'urgent',
            status: 'assigned',
            assigned_to_name: 'Dr Assigned',
            created_at: '2026-06-06T09:00:00Z',
          },
        ]}
      />,
    );

    expect(screen.getByText('Dr Assigned')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /chronicle/i })).toHaveAttribute('href', '/patients/patient-1?visit=encounter-1');
  });
});
