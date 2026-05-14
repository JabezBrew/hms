import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TreatmentSheetGrid } from '../TreatmentSheetGrid';

vi.mock('@/features/nursing/hooks', () => ({
  useDiscontinueTreatmentEntry: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

const entries = [
  {
    id: 'treatment-1',
    medication_name: 'Paracetamol',
    dosage: '1 g',
    route: 'PO',
    frequency: 'BD',
    start_datetime: '2026-05-12T09:00:00Z',
    ordered_by_name: 'Dr. Mensah',
    is_legacy_prescription: false,
    total_doses_administered: 1,
    total_doses_ordered: 4,
  },
];

describe('TreatmentSheetGrid Rust V2 guards', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('keeps treatment rows visible but hides discontinuation actions in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    render(<TreatmentSheetGrid entries={entries} />);

    expect(screen.getByText('Paracetamol')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /actions/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/treatment-sheet discontinuation is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps discontinuation actions available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    render(<TreatmentSheetGrid entries={entries} />);

    expect(screen.getByRole('columnheader', { name: /actions/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/treatment-sheet discontinuation is not available in rust v2/i),
    ).not.toBeInTheDocument();
  });
});
