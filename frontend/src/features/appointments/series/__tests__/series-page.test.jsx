import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import AppointmentCreatePage from '../../pages/AppointmentCreatePage';
import AppointmentSeriesPage from '../AppointmentSeriesPage';
vi.mock('../../pages/appointment-create/useAppointmentCreateController', async () => {
  const { useForm } = await import('react-hook-form');
  return { useAppointmentCreateController: () => ({ form: useForm({ defaultValues: { patientId: 'patient-1', clinicId: 'clinic-1', appointmentTypeId: 'service-1' } }), loading: false, progress: { completed: 3, total: 4 }, appointmentTypes: [], clinics: [], patientOptions: [], practitionerOptions: [], watchPatientId: 'patient-1', watchClinicId: 'clinic-1', watchAppointmentTypeId: 'service-1', selectedPatientName: 'Synthetic Patient', selectedClinic: { name: 'Clinic A' }, selectedTypeName: 'Review', formReady: false, isPoolClinic: true, navigateToAppointments: vi.fn(), onSubmit: vi.fn(), handleSlotSelect: vi.fn() }) };
});
vi.mock('../../pages/appointment-create/AppointmentCreateSidebar', () => ({ AppointmentCreateSidebar: () => <p>Single appointment booking remains available.</p> }));
const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const start = new Date(Date.now() + 2 * 86400000); start.setUTCHours(9, 0, 0, 0);
const at = (hours) => new Date(start.getTime() + hours * 3600000).toISOString();
const slots = [0, 2].map((hours, i) => ({ id: `slot-${i}`, session_id: `session-${i}`, session_name: `Session ${i + 1}`, start: at(hours), end: at(hours + 1), clinic_id: 'clinic-1', status: 'available', capacity: { max: 1, remaining: 1, booked: 0, overbook_remaining: 0 } }));
const original = { id: 'series-1', patient_id: 'patient-1', patient_code: 'SYNTHETIC', patient_display_name: 'Synthetic Patient', clinic_id: 'clinic-1', clinic_name: 'Clinic A', service_id: 'service-1', service_name: 'Review', snapshot_token: 'original-snapshot', occurrence_count: 2, appointments: slots.map((slot, i) => ({ id: `appointment-${i}`, clinic_session_id: slot.session_id, starts_at: slot.start, ends_at: slot.end, status: 'scheduled' })) };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let client; let saved; let lostCreate; let lostCancel; let readFailure; let conflict; let receipt;
beforeEach(() => {
  saved = structuredClone(original); lostCreate = false; lostCancel = false; readFailure = false; conflict = false; receipt = null;
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1 } } });
  globalThis.fetch = vi.fn(async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/scheduling/availability')) return json({ data: { slots } });
    if (path.endsWith('/appointment-series') && options.method === 'POST') { if (lostCreate) throw new TypeError('Response lost after commit'); return json({ data: saved }); }
    if (path.includes('/appointment-series/requests/')) return json({ data: saved });
    if (path.endsWith('/series-1/cancel-future')) {
      if (conflict) return json({ error: { code: 'appointment_series_snapshot_changed', message: 'The group changed. Refresh and review it again.' } }, 409);
      if (!receipt) { saved = { ...saved, snapshot_token: 'cancelled-snapshot', appointments: [{ ...saved.appointments[0], status: 'cancelled' }, { ...saved.appointments[1], status: 'arrived' }] }; receipt = { series: saved, cutoff_at: '2026-10-16T00:00:00Z', cancelled_count: 1, cancelled_appointment_ids: ['appointment-0'], retained_appointment_ids: ['appointment-1'] }; }
      if (lostCancel) { lostCancel = false; throw new TypeError('Response lost after cancellation'); } return json({ data: receipt });
    }
    if (path.endsWith('/appointment-series/series-1')) return readFailure ? json({ error: { code: 'unavailable', message: 'Unavailable' } }, 503) : json({ data: saved });
    throw new Error('Unexpected appointment-group test request');
  });
});
afterEach(() => { client.clear(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
function renderPage(route = '/appointments/create') {
  return render(<HelmetProvider><AuthContext.Provider value={{ user: { id: 'actor-1', facilityCode: 'HMS', accessContext: { facility_id: 'facility-1', active_profile: 'profile-1' }, adminAccess: { capabilities: ['appointment.manage'] } } }}><QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><BreadcrumbProvider><Routes><Route path="/appointments/create" element={<AppointmentCreatePage />} /><Route path="/appointments/series/:id" element={<AppointmentSeriesPage />} /></Routes></BreadcrumbProvider></MemoryRouter></QueryClientProvider></AuthContext.Provider></HelmetProvider>);
}
function writes(suffix) { return globalThis.fetch.mock.calls.filter(([url, options]) => options.method === 'POST' && new URL(url).pathname.endsWith(suffix)); }
async function bookReview() { fireEvent.click(await screen.findByRole('button', { name: 'Several appointments' })); fireEvent.click(await screen.findByRole('button', { name: /Session 1/ })); fireEvent.click(screen.getByRole('button', { name: /Session 2/ })); fireEvent.click(screen.getByRole('button', { name: 'Review appointments' })); }
async function cancelReview() { fireEvent.click(await screen.findByRole('button', { name: 'Cancel future appointments' })); fireEvent.change(screen.getByLabelText('Reason for cancelling future appointments'), { target: { value: 'Plans changed' } }); }
describe('appointment series through reachable pages and the real generated client', () => {
  it('reaches final grouped booking from the existing create page without submitting the single form', async () => {
    renderPage(); await bookReview(); expect(writes('/appointment-series')).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Confirm all appointments' })); await screen.findByText('Booking confirmed');
    expect(writes('/appointment-series')).toHaveLength(1); const payload = JSON.parse(writes('/appointment-series')[0][1].body); expect(payload.occurrences).toEqual(slots.map((slot) => ({ session_id: slot.session_id, starts_at: slot.start, ends_at: slot.end }))); expect(payload).not.toHaveProperty('body');
    fireEvent.click(screen.getByRole('link', { name: 'Review this appointment group' })); await screen.findByRole('region', { name: 'Saved appointments' });
  });
  it('recovers a lost grouped booking response through its original request key without another write', async () => {
    lostCreate = true; renderPage(); await bookReview(); fireEvent.click(screen.getByRole('button', { name: 'Confirm all appointments' })); await screen.findByText('Booking status unknown'); const payload = JSON.parse(writes('/appointment-series')[0][1].body); expect(writes('/appointment-series')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Check saved booking' })); await screen.findByText('Saved booking found'); expect(globalThis.fetch.mock.calls.some(([url]) => new URL(url).pathname.endsWith(`/requests/${payload.client_request_id}`))).toBe(true); expect(writes('/appointment-series')).toHaveLength(1);
  });
  it('retains exact cancellation replay across close and fresh group refresh', async () => {
    lostCancel = true; renderPage('/appointments/series/series-1'); await cancelReview(); fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' })); await screen.findByText('Cancellation status unknown'); const first = JSON.parse(writes('/cancel-future')[0][1].body);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close', exact: true })[0]); fireEvent.click(await screen.findByRole('button', { name: 'Review cancellation request' })); await screen.findByText('Cancellation status unknown'); fireEvent.click(screen.getByRole('button', { name: 'Retry same cancellation' }));
    await screen.findByText('Cancellation confirmed'); expect(screen.getByText(/1 cancelled · 1 retained/)).toBeInTheDocument(); expect(JSON.parse(writes('/cancel-future')[1][1].body)).toEqual(first); expect(writes('/cancel-future')).toHaveLength(2);
  });
  it('preserves confirmed cancellation receipt when the subsequent group read fails', async () => {
    renderPage('/appointments/series/series-1'); await cancelReview(); readFailure = true; fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' })); await screen.findByText('Cancellation confirmed'); await screen.findByText('Appointment group unavailable'); expect(screen.getByRole('dialog')).toHaveTextContent('1 cancelled · 1 retained'); expect(writes('/cancel-future')).toHaveLength(1);
  });
  it('treats a changed snapshot as a definite review conflict, preserving the current group', async () => {
    conflict = true; renderPage('/appointments/series/series-1'); await cancelReview(); fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' })); await screen.findByText('Cancellation not confirmed'); expect(screen.queryByText('Cancellation status unknown')).not.toBeInTheDocument(); expect(writes('/cancel-future')).toHaveLength(1); await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm cancellation' })).not.toBeDisabled());
  });
});
