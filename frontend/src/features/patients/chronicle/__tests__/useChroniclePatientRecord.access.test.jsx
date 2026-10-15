import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patientsApi } from '@/features/patients/api';
import { useChroniclePatientRecord } from '../useChroniclePatientRecord';
import { patientKeys } from '@/features/patients/hooks/usePatientQueries';

vi.mock('@/features/patients/api', () => ({ patientsApi: { getPatientChronicleStartup: vi.fn() } }));
vi.mock('@/features/billing/hooks', () => ({ usePatientInsurance: () => ({ data: [] }) }));
vi.mock('@/features/encounters/hooks/useEncounterQueries', () => ({ usePatientEncounters: () => ({ data: [], refetch: vi.fn() }) }));
vi.mock('@/hooks/useChronicleContext', () => ({ useChronicleContext: () => ({ data: null, refetch: vi.fn() }) }));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }));

const cached = { patient: { id: 'patient-1', name: 'Synthetic patient' }, clinical_marker: 'Previously authorized clinical text', access_source: 'break_glass' };
let queryClient;
let observations;
function Gate() {
  const record = useChroniclePatientRecord({ id: 'patient-1', rustV2Mode: true });
  observations.push(record.chronicleStartup?.clinical_marker);
  if (record.isLoading) return <p>Checking record access</p>;
  if (record.error) return <p>Record access denied</p>;
  return <p>{record.chronicleStartup?.clinical_marker}</p>;
}
function mount() {
  return render(<QueryClientProvider client={queryClient}><Gate /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  observations = [];
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => queryClient.clear());

describe('Chronicle authorization on remount', () => {
  it('never renders cached clinical data when a remounted record is now forbidden', async () => {
    patientsApi.getPatientChronicleStartup.mockResolvedValueOnce(cached);
    const first = mount();
    await screen.findByText(cached.clinical_marker);
    first.unmount();
    observations = [];
    let rejectFreshRead;
    patientsApi.getPatientChronicleStartup.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFreshRead = reject; }));
    mount();
    expect(screen.getByText('Checking record access')).toBeInTheDocument();
    expect(screen.queryByText(cached.clinical_marker)).not.toBeInTheDocument();
    await waitFor(() => expect(patientsApi.getPatientChronicleStartup).toHaveBeenCalledTimes(2));
    await act(async () => { rejectFreshRead(Object.assign(new Error('Forbidden'), { status: 403 })); });
    await screen.findByText('Record access denied');
    expect(screen.queryByText(cached.clinical_marker)).not.toBeInTheDocument();
    expect(observations).not.toContain(cached.clinical_marker);
  });

  it('waits for the authoritative mounted read then renders only fresh clinical content', async () => {
    patientsApi.getPatientChronicleStartup.mockResolvedValueOnce(cached);
    const first = mount();
    await screen.findByText(cached.clinical_marker);
    first.unmount();
    observations = [];
    let resolveFreshRead;
    patientsApi.getPatientChronicleStartup.mockImplementationOnce(() => new Promise((resolve) => { resolveFreshRead = resolve; }));
    mount();
    expect(screen.queryByText(cached.clinical_marker)).not.toBeInTheDocument();
    await waitFor(() => expect(patientsApi.getPatientChronicleStartup).toHaveBeenCalledTimes(2));
    await act(async () => { resolveFreshRead({ ...cached, clinical_marker: 'Freshly authorized clinical text' }); });
    await screen.findByText('Freshly authorized clinical text');
    expect(observations).not.toContain(cached.clinical_marker);
  });

  it('continues to render a fresh authorized read after grant-related query resets', async () => {
    patientsApi.getPatientChronicleStartup.mockResolvedValueOnce(cached);
    const first = mount();
    await screen.findByText(cached.clinical_marker);
    first.unmount();
    patientsApi.getPatientChronicleStartup.mockResolvedValueOnce({ ...cached, clinical_marker: 'Mounted fresh record' });
    mount();
    await screen.findByText('Mounted fresh record');
    patientsApi.getPatientChronicleStartup.mockResolvedValueOnce({ ...cached, clinical_marker: 'Refreshed after access change' });
    await act(async () => { await queryClient.resetQueries({ queryKey: patientKeys.detail('patient-1') }); });
    await screen.findByText('Refreshed after access change');
    expect(screen.queryByText('Checking record access')).not.toBeInTheDocument();
  });
});
