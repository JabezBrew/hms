import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PharmacyQueue } from '../PharmacyQueue';

const refetch = vi.fn();
const bulkDispense = vi.fn();
const dispenseMedication = vi.fn();

const pendingMedication = {
  id: 'group-1',
  patient: 'patient-1',
  patient_name: 'Ama Mensah',
  patient_mrn: 'MRN-2026-0001',
  patient_ward: 'Medical Ward A',
  medication_name: 'Amoxicillin',
  dosage: '500 mg',
  route: 'PO',
  frequency: 'TDS',
  scheduled_time: '2026-05-16T08:00:00Z',
  dose_count: 3,
  mar_entry_ids: ['mar-1', 'mar-2', 'mar-3'],
  prescriber_name: 'Dr. Boateng',
  is_overdue: false,
};

vi.mock('@/features/nursing/hooks', () => ({
  usePendingDispensingGrouped: () => ({
    data: [pendingMedication],
    isLoading: false,
    error: null,
    refetch,
  }),
  useBulkDispense: () => ({
    mutateAsync: bulkDispense,
    isPending: false,
  }),
  useDispenseMedication: () => ({
    mutateAsync: dispenseMedication,
    isPending: false,
  }),
}));

vi.mock('@/components/patients/PatientContextPanel', () => ({
  default: () => null,
}));

describe('PharmacyQueue Rust V2 dispensing controls', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
    vi.clearAllMocks();
  });

  it('keeps per-row dispensing visible but hides bulk selection in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    render(<PharmacyQueue />);

    expect(screen.getByText('Ama Mensah')).toBeInTheDocument();
    expect(screen.getByText('Amoxicillin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^dispense$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dispense selected/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.getByText(/rust v2 dispensing is available per medication row/i),
    ).toBeInTheDocument();
  });

  it('keeps dispensing controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    render(<PharmacyQueue />);

    expect(screen.getByRole('button', { name: /^dispense$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(
      screen.queryByText(/rust v2 dispensing is available per medication row/i),
    ).not.toBeInTheDocument();
  });
});
