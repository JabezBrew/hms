import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EncounterDetail } from './EncounterDetail';

vi.mock('@/features/clinical-notes/hooks', () => ({
  useNoteEntriesForEncounter: () => ({
    data: [],
    isLoading: false,
  }),
}));

const inpatientEncounter = {
  id: 'encounter-1',
  patient: 'patient-1',
  patient_name: 'Ama Mensah',
  practitioner_name: 'Dr. Mensah',
  encounter_type: 'inpatient',
  status: 'in-progress',
  start_time: '2026-05-12T09:00:00Z',
  end_time: null,
  service_type: 'Medicine',
  reason: 'Admission review',
};

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/encounters/encounter-1']}>
      <EncounterDetail encounter={inpatientEncounter} loading={false} isError={false} />
    </MemoryRouter>,
  );
}

describe('EncounterDetail Rust V2 guards', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('hides unsupported inpatient discharge while keeping supported cancel in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderDetail();

    expect(screen.queryByRole('button', { name: /^discharge$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    expect(
      screen.getByText(/inpatient discharge is handled by admission discharge workflows in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps inpatient discharge available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderDetail();

    expect(screen.getByRole('button', { name: /^discharge$/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/inpatient discharge is handled by admission discharge workflows in rust v2/i),
    ).not.toBeInTheDocument();
  });
});
