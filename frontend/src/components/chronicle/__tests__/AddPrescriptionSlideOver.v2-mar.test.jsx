import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

import AddPrescriptionSlideOver from '../AddPrescriptionSlideOver';

const safetyMutate = vi.fn();
const createPrescription = vi.fn();
const getMedicationCatalog = vi.fn();
const onClose = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const patient = {
  id: 'patient-1',
  name: 'Ama Mensah',
  is_admitted: true,
  current_admission_id: 'admission-1',
};

vi.mock('@/hooks/useDrugSafetyQueries', () => ({
  useSafetyCheck: () => ({
    mutateAsync: safetyMutate,
    isPending: false,
  }),
  usePatientAllergies: () => ({ data: [] }),
  useDrugForms: () => ({ data: { forms: [] }, isLoading: false }),
}));

vi.mock('@/components/drug-safety/DrugSafetyDialog', () => ({
  DrugSafetyDialog: () => null,
}));

vi.mock('@/components/drug-safety/MedicationAutocomplete', () => ({
  MedicationAutocomplete: ({ value, onSelect }) => (
    <input
      aria-label="Medication"
      value={value}
      onChange={(event) => onSelect({ name: event.target.value, rxcui: 'rx-1' })}
    />
  ),
}));

vi.mock('@/hooks/usePrescriptionMutations', () => ({
  createPrescription: (...args) => createPrescription(...args),
  invalidatePrescriptionMutationQueries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/onboarding', () => ({
  emitOnboardingEvent: vi.fn(),
}));

vi.mock('@/features/pharmacy/api/medicationCatalog', () => ({
  getMedicationCatalog: (...args) => getMedicationCatalog(...args),
  medicationCatalogKeys: { search: (scope) => ['medication-catalog', scope] },
}));

function renderPanel({ selectedPatient = patient, onPrescriptionCreated } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const panel = (nextPatient) => <QueryClientProvider client={queryClient}>
    <AddPrescriptionSlideOver open onClose={onClose} patient={nextPatient} onPrescriptionCreated={onPrescriptionCreated} />
  </QueryClientProvider>;
  const result = render(panel(selectedPatient));
  return { ...result, changePatient: (nextPatient) => result.rerender(panel(nextPatient)) };
}

async function reviewedScheduledStock(name = 'Medication') {
  getMedicationCatalog.mockResolvedValue({ data: [{ id: 'stock-1', code: 'MED-1', name, unit: 'tablet', controlled: false }], page: { has_next: false } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose facility medication' }));
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${name}.*MED-1`, 'i') }));
  expect(screen.getByLabelText('Stock units for one scheduled dose (tablet)')).toHaveValue(null);
  fireEvent.change(screen.getByLabelText('Stock units for one scheduled dose (tablet)'), { target: { value: '2' } });
}

describe('AddPrescriptionSlideOver Rust V2 MAR guard', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
    vi.clearAllMocks();
  });

  it('shows MAR generation controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPanel();

    expect(
      screen.getByText(/generate medication administration record/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/mar generation is not available in rust v2/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Special Instructions')).toBeInTheDocument();
    expect(screen.getByLabelText('Reason for Prescription')).toBeInTheDocument();
  });

  it('keeps MAR generation controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPanel();

    expect(
      screen.getByText(/generate medication administration record/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/mar generation is not available in rust v2/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Special Instructions')).toBeInTheDocument();
  });

  it('creates prescriptions in Rust V2 without calling unavailable drug-safety checks', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-1', patient: 'patient-1' });

    renderPanel();

    fireEvent.change(screen.getByLabelText('Medication'), {
      target: { value: 'Amoxicillin' },
    });
    fireEvent.change(screen.getByPlaceholderText(/500 mg/i), {
      target: { value: '500 mg' },
    });
    fireEvent.change(screen.getByLabelText('Special Instructions'), { target: { value: 'Synthetic administration instruction' } });
    fireEvent.change(screen.getByLabelText('Reason for Prescription'), { target: { value: 'Synthetic prescribing reason' } });
    await reviewedScheduledStock('Amoxicillin');
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));

    await waitFor(() => expect(createPrescription).toHaveBeenCalledTimes(1));

    expect(safetyMutate).not.toHaveBeenCalled();
    expect(createPrescription).toHaveBeenCalledWith({
      patient: 'patient-1',
      medication_name: 'Amoxicillin',
      dosage: '500 mg',
      instructions: 'Synthetic administration instruction',
      reason: 'Synthetic prescribing reason',
      route: 'oral',
      frequency: 'daily',
      start_date: expect.any(String),
      generate_mar: 'yes',
      mar_days: 7,
      admission_case_id: 'admission-1',
      inventory_item_id: 'stock-1',
      scheduled_stock_policy: { expected_stock_unit: 'tablet', stock_units_per_dose: 2 },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('creates an outpatient prescription without requesting an unavailable admission schedule', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-outpatient', patient: 'patient-1' });
    renderPanel({ selectedPatient: { id: 'patient-1', is_admitted: false } });
    expect(screen.getByText('MAR generation requires an active admission.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Medication' } });
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '5 mg' } });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(createPrescription).toHaveBeenCalledTimes(1));
    expect(createPrescription.mock.calls[0][0]).not.toHaveProperty('generate_mar');
    expect(createPrescription.mock.calls[0][0]).not.toHaveProperty('admission_case_id');
  });

  it('links the explicitly selected stock item and clears that link if medication text changes', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    getMedicationCatalog.mockResolvedValue({
      data: [{ id: 'stock-1', code: 'MED-1', name: 'Synthetic catalog medication', unit: 'tablet', controlled: false }],
      page: { has_next: false, next_cursor: null },
    });
    createPrescription.mockResolvedValueOnce({ id: 'rx-stock' });
    renderPanel({ selectedPatient: { id: 'patient-1', is_admitted: false } });
    // The catalog is deferred until requested and never fuzzy-matches typed text.
    expect(getMedicationCatalog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Choose facility medication' }));
    fireEvent.click(await screen.findByRole('button', { name: /synthetic catalog medication.*med-1/i }));
    expect(screen.getByLabelText('Medication')).toHaveValue('Synthetic catalog medication');
    expect(screen.getByText('Linked: MED-1 · Synthetic catalog medication')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '1 tablet' } });
    fireEvent.change(screen.getByLabelText('Stock units for one scheduled dose (tablet)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(createPrescription).toHaveBeenCalledTimes(1));
    expect(createPrescription.mock.calls[0][0]).toMatchObject({ inventory_item_id: 'stock-1', medication_name: 'Synthetic catalog medication', dosage: '1 tablet', scheduled_stock_policy: { expected_stock_unit: 'tablet', stock_units_per_dose: 2 } });
  });

  it('removes an old stock binding after editing the medication name', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    getMedicationCatalog.mockResolvedValue({ data: [{ id: 'stock-1', code: 'MED-1', name: 'Synthetic catalog medication', unit: 'tablet' }], page: { has_next: false } });
    createPrescription.mockResolvedValueOnce({ id: 'rx-free-text' });
    renderPanel({ selectedPatient: { id: 'patient-1', is_admitted: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose facility medication' }));
    fireEvent.click(await screen.findByRole('button', { name: /synthetic catalog medication.*med-1/i }));
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Different medication' } });
    expect(screen.queryByText(/^Linked:/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '1 tablet' } });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(createPrescription).toHaveBeenCalledTimes(1));
    expect(createPrescription.mock.calls[0][0]).not.toHaveProperty('inventory_item_id');
  });

  it.each(['failed', 'unconfirmed'])('warns after a saved prescription with %s MAR, closes, and prevents create retry', async (status) => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-saved', patient: 'patient-1', mar_generation_status: status, mar_generated: false });
    renderPanel();
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Medication' } });
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '5 mg' } });
    await reviewedScheduledStock();
    const submit = screen.getByRole('button', { name: /create prescription/i });
    fireEvent.click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/prescription saved/i), expect.objectContaining({ description: expect.stringMatching(/do not recreate/i) }));
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.click(submit);
    expect(createPrescription).toHaveBeenCalledTimes(1);
  });

  it('still closes a saved prescription when the completion callback fails', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-saved', patient: 'patient-1' });
    renderPanel({ onPrescriptionCreated: () => { throw new Error('Refresh unavailable'); } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Medication' } });
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '5 mg' } });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
    expect(createPrescription).toHaveBeenCalledTimes(1);
  });

  it('explains as-needed schedule handling instead of claiming scheduled doses were generated', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'prescription-prn', mar_generated: false, mar_generation_status: 'skipped', mar_generation: { skipped_reason: 'prn' } });
    renderPanel(); await preparePrn(); await enterPrnLimits();
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Prescription saved. As-needed doses are not automatically scheduled.');
  });
  async function chooseSelect(label, option) {
    fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: option, exact: true }));
  }
  async function preparePrn({ controlled = false } = {}) {
    getMedicationCatalog.mockResolvedValue({ data: [{ id: 'stock-1', code: 'MED-1', name: 'Synthetic catalog medication', unit: 'tablet', controlled }], page: { has_next: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose facility medication' }));
    fireEvent.click(await screen.findByRole('button', { name: /synthetic catalog medication.*med-1/i }));
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '2 tablets' } });
    await chooseSelect('Frequency *', 'As Needed (PRN)');
  }
  async function enterPrnLimits({ cap = '3', units = '2' } = {}) {
    await chooseSelect('Minimum hours between doses', '6 hours');
    fireEvent.change(screen.getByLabelText('Maximum doses in any 24 hours'), { target: { value: cap } });
    fireEvent.change(screen.getByLabelText('Ordered indication'), { target: { value: 'Synthetic indication' } });
    fireEvent.change(screen.getByLabelText('Stock units used for one dose (tablet)'), { target: { value: units } });
  }
  it('requires explicit PRN limits and sends the selected stock unit without a fixed MAR schedule', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockResolvedValueOnce({ id: 'rx-prn', prn_policy: { stock_unit: 'tablet' } });
    renderPanel(); await preparePrn();
    expect(screen.getByLabelText('Maximum doses in any 24 hours')).toHaveValue(null);
    expect(screen.getByLabelText('Stock units used for one dose (tablet)')).toHaveValue(null);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('(required for as-needed doses)')).toBeInTheDocument();
    await enterPrnLimits(); fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createPrescription.mock.calls[0][0]).toMatchObject({ frequency: 'prn', inventory_item_id: 'stock-1', prn_policy: {
      minimum_interval_hours: 6, maximum_doses_per_24_hours: 3, indication: 'Synthetic indication', stock_units_per_dose: 2, expected_stock_unit: 'tablet' } });
    expect(createPrescription.mock.calls[0][0]).not.toHaveProperty('generate_mar');
    expect(safetyMutate).not.toHaveBeenCalled();
  });
  it.each([{ cap: '5', units: '2' }, { cap: '3', units: '9007199254740992' }])(
    'does not write an invalid or unsupported PRN order (%j)', async (values) => {
      window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; renderPanel();
      await preparePrn(values); await enterPrnLimits(values);
      fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
      expect(createPrescription).not.toHaveBeenCalled(); expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
  it('clears previous PRN limits after leaving and returning to the frequency', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; renderPanel(); await preparePrn(); await enterPrnLimits();
    await chooseSelect('Frequency *', 'Once Daily'); await chooseSelect('Frequency *', 'As Needed (PRN)');
    expect(screen.getByLabelText('Maximum doses in any 24 hours')).toHaveValue(null);
    expect(screen.getByLabelText('Ordered indication')).toHaveValue('');
    expect(screen.getByLabelText('Stock units used for one dose (tablet)')).toHaveValue(null);
  });
  it('locks an uncertain prescription write until the medication list is reviewed', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockRejectedValueOnce(Object.assign(new Error('Unconfirmed'), { name: 'PrescriptionWriteUnconfirmedError' })); renderPanel();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Synthetic' } });
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '1 tablet' } });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await screen.findByText(/prescription may have been saved/i);
    expect(screen.getByRole('button', { name: /create prescription/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    expect(createPrescription).toHaveBeenCalledTimes(1); expect(onClose).not.toHaveBeenCalled();
  });
  it('remounts on a patient switch without closing the new draft when the old write settles', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; let completeOld;
    createPrescription.mockImplementationOnce(() => new Promise((resolve) => { completeOld = resolve; })); const panel = renderPanel();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Synthetic old draft' } });
    fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '1 tablet' } });
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(createPrescription).toHaveBeenCalledTimes(1));
    panel.changePatient({ ...patient, id: 'patient-2', current_admission_id: 'admission-2' });
    expect(screen.getByLabelText('Medication')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Synthetic new draft' } });
    await act(async () => { completeOld({ id: 'rx-old', patient: 'patient-1' }); });
    expect(screen.getByLabelText('Medication')).toHaveValue('Synthetic new draft');
    expect(onClose).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
  });

  it('clears a stale stock basis and its limits after an explicit unit conflict', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    createPrescription.mockRejectedValueOnce(Object.assign(new Error('Review the stock unit'), { name: 'PrescriptionStockUnitChangedError' }));
    renderPanel(); await preparePrn(); await enterPrnLimits();
    fireEvent.click(screen.getByRole('button', { name: /create prescription/i }));
    await waitFor(() => expect(screen.queryByText(/^Linked:/)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Maximum doses in any 24 hours')).toHaveValue(null);
    expect(screen.getByLabelText('Dosage *')).toHaveValue('2 tablets');
    expect(screen.getByRole('button', { name: 'Choose facility medication' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets PRN limits when the same stock item is reselected with a corrected unit', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; renderPanel(); await preparePrn(); await enterPrnLimits();
    getMedicationCatalog.mockResolvedValue({ data: [{ id: 'stock-1', code: 'MED-1', name: 'Synthetic catalog medication', unit: 'pack', controlled: false }], page: { has_next: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Change stock link' }));
    fireEvent.click(await screen.findByRole('button', { name: /synthetic catalog medication.*med-1/i }));
    expect(screen.getByLabelText('Maximum doses in any 24 hours')).toHaveValue(null);
    expect(screen.getByLabelText('Stock units used for one dose (pack)')).toHaveValue(null);
    expect(screen.getByLabelText('Ordered indication')).toHaveValue('');
  });

  it('requires stock review for scheduled MAR without deriving units from clinical dosage', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; renderPanel();
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Synthetic' } }); fireEvent.change(screen.getByLabelText('Dosage *'), { target: { value: '500 mg' } }); fireEvent.click(screen.getByRole('button', { name: /create prescription/i })); expect(createPrescription).not.toHaveBeenCalled(); expect(screen.getByText(/Choose a stock item and review its units/)).toBeInTheDocument();
    await reviewedScheduledStock('Synthetic'); fireEvent.change(screen.getByLabelText('Stock units for one scheduled dose (tablet)'), { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: /create prescription/i })); expect(createPrescription).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent(/positive whole number/);
  });
  it('clears scheduled units when the same catalog item is reselected with a changed unit', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; renderPanel(); await reviewedScheduledStock();
    getMedicationCatalog.mockResolvedValue({ data: [{ id: 'stock-1', code: 'MED-1', name: 'Medication', unit: 'pack', controlled: false }], page: { has_next: false } }); fireEvent.click(screen.getByRole('button', { name: 'Change stock link' })); fireEvent.click(await screen.findByRole('button', { name: /Medication.*MED-1/i })); expect(screen.getByLabelText('Stock units for one scheduled dose (pack)')).toHaveValue(null); expect(createPrescription).not.toHaveBeenCalled();
  });

});
