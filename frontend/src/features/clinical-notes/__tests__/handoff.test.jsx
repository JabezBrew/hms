import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import CreateClinicalNotePage from '../pages/CreateClinicalNotePage';
import { encounterId, patientId, json, time } from './fixtures';
const originalFetch = globalThis.fetch; const runtime = window.__HMS_RUNTIME_CONFIG__;
function Destination() { const location = useLocation(); return <p>Chronicle destination: {location.pathname}{location.search}</p>; }
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/encounters/${encounterId}/clinical-notes`]}><Routes><Route path="/encounters/:id/clinical-notes" element={<CreateClinicalNotePage />} /><Route path="/patients/:id/chronicle" element={<Destination />} /></Routes></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['in_progress', 'completed'])('hands the authorized %s encounter to Chronicle without a standalone clinical form', async (status) => {
  globalThis.fetch.mockResolvedValue(json({ data: { id: encounterId, patient_id: patientId, patient_display_name: 'Synthetic Patient', status, encounter_type: 'outpatient', started_at: time } })); mount();
  const destination = await screen.findByText(/Chronicle destination:/); expect(destination.textContent).toContain(`/patients/${patientId}/chronicle?visit=${encounterId}`); expect(destination.textContent.includes('action=add_note')).toBe(status === 'in_progress'); expect(screen.queryByRole('button', { name: /Save|Complete Note/ })).not.toBeInTheDocument(); expect(globalThis.fetch).toHaveBeenCalledTimes(1); expect(globalThis.fetch.mock.calls[0][0]).toContain(`/encounters/${encounterId}`);
});
it('does not navigate or load patient notes when encounter access is denied', async () => { globalThis.fetch.mockResolvedValue(json({ error: { code: 'patient_access_denied' } }, 403)); mount(); await screen.findByText('Encounter unavailable'); expect(screen.queryByText(/Chronicle destination:/)).not.toBeInTheDocument(); expect(globalThis.fetch).toHaveBeenCalledTimes(1); });
