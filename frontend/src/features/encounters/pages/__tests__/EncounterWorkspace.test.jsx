import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { encountersApi } from '@/features/encounters/api';
import EncounterWorkspace from '../EncounterWorkspace';

const { useLegacyPatient } = vi.hoisted(() => ({ useLegacyPatient: vi.fn() }));
vi.mock('@/features/patients/hooks/usePatientQueries', () => ({ usePatient: useLegacyPatient }));
vi.mock('@/components/patient/PatientHeader', () => ({ PatientHeader: () => <h1>Legacy patient workspace</h1> }));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }));

const originalFetch = globalThis.fetch;
const route = '/encounters/requested-encounter/workspace';

function Location() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

function renderWorkspace() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/encounters/:id/workspace" element={<EncounterWorkspace />} />
          <Route path="/patients/:id/chronicle" element={<h1>Patient Chronicle destination</h1>} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function encounterResponse(data = { id: 'requested-encounter', patient_id: 'confirmed-patient', status: 'in_progress', type: 'emergency' }) {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function expectNoDemonstrationWorkspace() {
  for (const content of ['Hypertension', 'Type 2 Diabetes', 'Lisinopril 10mg', 'Metformin 500mg', /Oct 15, 2023/]) {
    expect(screen.queryByText(content)).not.toBeInTheDocument();
  }
  expect(screen.queryByRole('tab', { name: 'Clinical Note' })).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText("Type '/' for commands...")).not.toBeInTheDocument();
}

describe('Encounter workspace compatibility route', () => {
  beforeEach(() => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    __resetV2ApiClientForTests();
    configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'TEST' });
    globalThis.fetch = vi.fn().mockImplementation(async () => encounterResponse());
    useLegacyPatient.mockReset();
    useLegacyPatient.mockReturnValue({ data: { id: 'confirmed-patient' }, isLoading: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__HMS_RUNTIME_CONFIG__;
    __resetV2ApiClientForTests();
    globalThis.fetch = originalFetch;
  });

  it('waits for the authorized encounter and opens Chronicle with confirmed patient and encounter context', async () => {
    let respond;
    globalThis.fetch.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    renderWorkspace();
    expect(screen.getByRole('status', { name: 'Loading encounter' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent(route);
    expectNoDemonstrationWorkspace();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/encounters/requested-encounter',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await act(async () => respond(encounterResponse()));
    expect(await screen.findByRole('heading', { name: 'Patient Chronicle destination' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/patients/confirmed-patient/chronicle?visit=requested-encounter');
    expectNoDemonstrationWorkspace();
    expect(useLegacyPatient).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps denied encounter access on the error view and allows a real request retry', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Access denied' } }), { status: 403, headers: { 'content-type': 'application/json' } }));
    const user = userEvent.setup();
    renderWorkspace();
    expect(await screen.findByRole('alert', { name: 'Encounter unavailable' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent(route);
    expectNoDemonstrationWorkspace();
    expect(useLegacyPatient).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Patient Chronicle destination' })).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { id: 'requested-encounter' },
    { patient_id: 'confirmed-patient' },
    { id: 'wrong-encounter', patient_id: 'confirmed-patient' },
  ])('rejects missing or mismatched encounter context without showing demonstration data', async (data) => {
    globalThis.fetch.mockResolvedValueOnce(encounterResponse(data));
    renderWorkspace();
    expect(await screen.findByRole('alert', { name: 'Encounter unavailable' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent(route);
    expectNoDemonstrationWorkspace();
  });

  it('preserves the legacy workspace outside Rust mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
    vi.spyOn(encountersApi, 'getEncounter').mockResolvedValue({ id: 'requested-encounter', patient_id: 'confirmed-patient' });
    renderWorkspace();
    expect(await screen.findByRole('tab', { name: 'Clinical Note' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Review of Systems' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Orders & Plan' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent(route);
    expect(useLegacyPatient).toHaveBeenCalledWith('confirmed-patient');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
