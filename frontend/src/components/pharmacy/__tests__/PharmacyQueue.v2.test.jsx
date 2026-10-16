import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/lib/auth/AuthContext';
import { getDispensingLocations } from '@/features/pharmacy/api/dispensingLocations';

import { PharmacyQueue } from '../PharmacyQueue';

const refetch = vi.fn();
const bulkDispense = vi.fn();
const dispenseMedication = vi.fn();
let client;
const actor = { id: 'actor-1', facilityCode: 'HMS', accessContext: { facility_id: 'facility-1', active_profile: 'pharmacy-1' }, adminAccess: { capabilities: ['pharmacy.dispense'] } };
function renderQueue(user = actor) { return render(<AuthContext.Provider value={{ user }}><QueryClientProvider client={client}><PharmacyQueue /></QueryClientProvider></AuthContext.Provider>); }
vi.mock('@/features/pharmacy/api/dispensingLocations', async (original) => ({ ...(await original()), getDispensingLocations: vi.fn() }));

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
  beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); getDispensingLocations.mockResolvedValue({ data: [{ id: 'location-one', name: 'Main pharmacy', code: 'PHARM' }], page: { limit: 25, has_next: false, next_cursor: null } }); });
  afterEach(() => {
    client.clear();
    delete window.__HMS_RUNTIME_CONFIG__;
    delete pendingMedication.inventory_item_id;
    delete pendingMedication.prn_policy;
    delete pendingMedication.inventory_item_name; delete pendingMedication.inventory_item_code; delete pendingMedication.inventory_item_unit;
    vi.clearAllMocks();
  });

  it('keeps per-row dispensing visible but hides bulk selection in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderQueue();

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

    renderQueue();

    expect(screen.getByRole('button', { name: /^dispense$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(
      screen.queryByText(/rust v2 dispensing is available per medication row/i),
    ).not.toBeInTheDocument();
  });
  it('shows the explicit PRN stock basis and prevents another issue after an uncertain save', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    pendingMedication.inventory_item_id = 'stock-one';
    pendingMedication.inventory_item_name = 'Amoxicillin capsules'; pendingMedication.inventory_item_code = 'AMOX'; pendingMedication.inventory_item_unit = 'tablet';
    pendingMedication.prn_policy = { stock_units_per_dose: 2, stock_unit: 'tablet' };
    const error = new Error('Supply may have been recorded');
    error.name = 'PharmacyDispenseUnconfirmedError';
    dispenseMedication.mockRejectedValue(error);
    const user = userEvent.setup();
    renderQueue();
    await user.click(screen.getByRole('button', { name: /^dispense$/i }));
    expect(screen.getByText(/Each dose uses 2 tablet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Doses to supply')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Dispense' })).toBeDisabled();
    expect(screen.queryByText('stock-one')).not.toBeInTheDocument(); expect(screen.queryByLabelText('Location ID')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Main pharmacy/ }));
    await user.dblClick(screen.getByRole('button', { name: 'Confirm Dispense' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('may have been recorded'));
    expect(screen.getByRole('button', { name: 'Confirm Dispense' })).toBeDisabled();
    expect(dispenseMedication).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: /^dispense$/i }));
    expect(screen.getByRole('button', { name: 'Confirm Dispense' })).toBeDisabled();
  });

});
