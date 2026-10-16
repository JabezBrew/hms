import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { seriesApi } from '../api';
import { SeriesBookingEntry } from '../SeriesBookingEntry';
import { SeriesCancellationDialog } from '../SeriesCancellationDialog';
import AppointmentSeriesPage from '../AppointmentSeriesPage';
vi.mock('../api', () => ({ seriesApi: { slots: vi.fn(), create: vi.fn(), recover: vi.fn(), get: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }));
const start = new Date(Date.now() + 2 * 86400000); start.setUTCHours(9, 0, 0, 0);
const at = (hours) => new Date(start.getTime() + hours * 3600000).toISOString();
const slots = [0, 2].map((hours, index) => ({ id: `slot-${index}`, session_id: `session-${index}`, session_name: `Session ${index + 1}`, start: at(hours), end: at(hours + 1), status: 'available', capacity: { remaining: 1, overbook_remaining: 0 } }));
const detail = { id: 'series-1', patient_id: 'patient-1', patient_display_name: 'Synthetic Patient', clinic_id: 'clinic-1', clinic_name: 'Clinic A', service_id: 'service-1', service_name: 'Review', snapshot_token: 'snapshot-original', occurrence_count: 2, appointments: slots.map((slot, index) => ({ id: `appointment-${index}`, clinic_session_id: slot.session_id, starts_at: slot.start, ends_at: slot.end, status: 'scheduled' })) };
const context = { patientId: detail.patient_id, patientName: detail.patient_display_name, clinicId: detail.clinic_id, clinicName: detail.clinic_name, serviceId: detail.service_id, serviceName: detail.service_name };
const user = { id: 'actor-1', facilityCode: 'HMS', accessContext: { facility_id: 'facility-1', active_profile: 'profile-1' }, adminAccess: { capabilities: ['appointment.manage'] } };
let client;
beforeEach(() => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1 } } });
  seriesApi.slots.mockResolvedValue(slots); seriesApi.get.mockResolvedValue(detail); seriesApi.create.mockResolvedValue(detail); seriesApi.recover.mockResolvedValue(detail);
  seriesApi.cancel.mockResolvedValue({ series: { ...detail, appointments: detail.appointments.map((member) => ({ ...member, status: 'cancelled' })) }, cutoff_at: new Date().toISOString(), cancelled_count: 2, cancelled_appointment_ids: ['appointment-0', 'appointment-1'], retained_appointment_ids: [] });
});
afterEach(() => { client.clear(); delete window.__HMS_RUNTIME_CONFIG__; });
function wrapper({ children }) { return <AuthContext.Provider value={{ user }}><QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider></AuthContext.Provider>; }
async function selected() {
  fireEvent.click(screen.getByRole('button', { name: 'Several appointments' }));
  fireEvent.click(await screen.findByRole('button', { name: /Session 1/ })); fireEvent.click(screen.getByRole('button', { name: /Session 2/ })); fireEvent.click(screen.getByRole('button', { name: 'Review appointments' }));
}
describe('multiple-appointment review and recovery', () => {
  it('collects actual slots and requires final explicit review before one atomic request', async () => {
    render(<form onSubmit={vi.fn()}><SeriesBookingEntry context={context} /></form>, { wrapper }); await selected(); expect(seriesApi.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm all appointments' })); await screen.findByText('Booking confirmed');
    expect(seriesApi.create).toHaveBeenCalledTimes(1); expect(seriesApi.create.mock.calls[0][0]).toMatchObject({ patient_id: detail.patient_id, occurrences: slots.map((slot) => ({ session_id: slot.session_id, starts_at: slot.start, ends_at: slot.end })) }); expect(screen.getByRole('link', { name: 'Review this appointment group' })).toHaveAttribute('href', '/appointments/series/series-1');
  });
  it('freezes uncertain payload and key across close/reopen and explicitly retries the same request', async () => {
    seriesApi.create.mockRejectedValueOnce(Object.assign(new Error('May be saved'), { name: 'AppointmentSeriesUnconfirmedError' }));
    render(<SeriesBookingEntry context={context} />, { wrapper }); await selected(); fireEvent.click(screen.getByRole('button', { name: 'Confirm all appointments' })); await screen.findByText('Booking status unknown');
    const first = structuredClone(seriesApi.create.mock.calls[0][0]); expect(seriesApi.create).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: 'Change selection' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close booking' })); fireEvent.click(screen.getByRole('button', { name: 'Several appointments' })); await screen.findByText('Booking status unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Retry same booking request' })); await screen.findByText('Saved booking found'); expect(seriesApi.create.mock.calls[1][0]).toEqual(first);
  });
  it('checks the saved result by the original request key without another booking write', async () => {
    seriesApi.create.mockRejectedValueOnce(Object.assign(new Error('May be saved'), { name: 'AppointmentSeriesUnconfirmedError' }));
    render(<SeriesBookingEntry context={context} />, { wrapper }); await selected(); fireEvent.click(screen.getByRole('button', { name: 'Confirm all appointments' })); await screen.findByText('Booking status unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Check saved booking' })); await screen.findByText('Saved booking found'); expect(seriesApi.recover.mock.calls[0][0]).toBe(seriesApi.create.mock.calls[0][0].client_request_id); expect(seriesApi.create).toHaveBeenCalledTimes(1);
  });
  it('blocks pending dismissal and duplicate submission', async () => {
    let finish; seriesApi.create.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(detail); }));
    render(<SeriesBookingEntry context={context} />, { wrapper }); await selected(); const confirm = screen.getByRole('button', { name: 'Confirm all appointments' }); fireEvent.click(confirm); fireEvent.click(confirm);
    await screen.findByRole('button', { name: 'Booking…' }); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(seriesApi.create).toHaveBeenCalledTimes(1); finish(); await screen.findByText('Booking confirmed');
  });
  it('discards the old draft when patient or authorization identity changes', async () => {
    const view = render(<SeriesBookingEntry context={context} />, { wrapper }); await selected(); view.rerender(<SeriesBookingEntry context={{ ...context, patientId: 'patient-2', patientName: 'Other synthetic patient' }} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Several appointments' })); expect(screen.getByText('Selected appointments · 0 / 50')).toBeInTheDocument(); expect(seriesApi.create).not.toHaveBeenCalled();
  });
  it('discards a draft when the active profile changes even for the same patient', async () => {
    const tree = (actor) => <AuthContext.Provider value={{ user: actor }}><QueryClientProvider client={client}><MemoryRouter><SeriesBookingEntry context={context} /></MemoryRouter></QueryClientProvider></AuthContext.Provider>;
    const view = render(tree(user)); await selected(); view.rerender(tree({ ...user, accessContext: { ...user.accessContext, active_profile: 'profile-2' } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Several appointments' })); expect(screen.getByText('Selected appointments · 0 / 50')).toBeInTheDocument(); expect(seriesApi.create).not.toHaveBeenCalled();
  });
  it('requires explicit permission before exposing series creation', () => {
    render(<AuthContext.Provider value={{ user: { ...user, adminAccess: { capabilities: [] } } }}><SeriesBookingEntry context={context} /></AuthContext.Provider>, { wrapper }); expect(screen.queryByRole('button', { name: 'Several appointments' })).not.toBeInTheDocument();
  });
});
describe('future-only cancellation', () => {
  it('clears an open cancellation draft when the same profile loses management permission', async () => {
    const tree = (actor) => <QueryClientProvider client={client}><AuthContext.Provider value={{ user: actor }}><MemoryRouter initialEntries={['/appointments/series/series-1']}><Routes><Route path="/appointments/series/:id" element={<AppointmentSeriesPage />} /></Routes></MemoryRouter></AuthContext.Provider></QueryClientProvider>;
    const view = render(tree(user)); fireEvent.click(await screen.findByRole('button', { name: 'Cancel future appointments' })); fireEvent.change(screen.getByLabelText('Reason for cancelling future appointments'), { target: { value: 'Plans changed' } });
    view.rerender(tree({ ...user, adminAccess: { capabilities: [] } })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Confirm cancellation' })).not.toBeInTheDocument(); expect(seriesApi.cancel).not.toHaveBeenCalled();
  });
  it('requires a reason within the server UTF-8 bound before cancellation', () => {
    render(<SeriesCancellationDialog series={detail} onClose={vi.fn()} />, { wrapper }); fireEvent.change(screen.getByLabelText('Reason for cancelling future appointments'), { target: { value: '🙂'.repeat(300) } });
    expect(screen.getByText('The reason is too long. Shorten it before cancelling.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirm cancellation' })).toBeDisabled(); expect(seriesApi.cancel).not.toHaveBeenCalled();
  });
  it('sends the reviewed snapshot with a stable key and displays actual retained counts and cutoff', async () => {
    seriesApi.cancel.mockResolvedValueOnce({ series: { ...detail, appointments: [{ ...detail.appointments[0], status: 'cancelled' }, { ...detail.appointments[1], status: 'arrived' }] }, cutoff_at: new Date().toISOString(), cancelled_count: 1, cancelled_appointment_ids: ['appointment-0'], retained_appointment_ids: ['appointment-1'] });
    render(<SeriesCancellationDialog series={detail} onClose={vi.fn()} />, { wrapper }); fireEvent.change(screen.getByLabelText('Reason for cancelling future appointments'), { target: { value: ' Plans changed ' } }); expect(seriesApi.cancel).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await screen.findByText('Cancellation confirmed'); expect(seriesApi.cancel.mock.calls[0][0]).toBe(detail.id); expect(seriesApi.cancel.mock.calls[0][1]).toMatchObject({ expected_snapshot_token: detail.snapshot_token, reason: 'Plans changed' }); expect(screen.getByText(/1 cancelled · 1 retained/)).toBeInTheDocument(); expect(screen.getByText('arrived')).toBeInTheDocument();
  });
  it('keeps an unknown cancellation reason and key frozen for the same explicit retry', async () => {
    seriesApi.cancel.mockRejectedValueOnce(Object.assign(new Error('May be saved'), { name: 'AppointmentSeriesUnconfirmedError' }));
    render(<SeriesCancellationDialog series={detail} onClose={vi.fn()} />, { wrapper }); const reason = screen.getByLabelText('Reason for cancelling future appointments'); fireEvent.change(reason, { target: { value: 'Plans changed' } }); fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' })); await screen.findByText('Cancellation status unknown'); const first = structuredClone(seriesApi.cancel.mock.calls[0][1]); expect(reason).toBeDisabled(); expect(seriesApi.cancel).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Retry same cancellation' })); await screen.findByText('Cancellation confirmed'); expect(seriesApi.cancel.mock.calls[1][1]).toEqual(first);
  });
  it('does not render stale cached membership before a denied authoritative read', async () => {
    const { seriesKeys } = await import('../hooks'); client.setQueryData(seriesKeys.detail(detail.id), detail); seriesApi.get.mockRejectedValueOnce(Object.assign(new Error('Denied'), { status: 403 }));
    render(<QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><MemoryRouter initialEntries={['/appointments/series/series-1']}><Routes><Route path="/appointments/series/:id" element={<AppointmentSeriesPage />} /></Routes></MemoryRouter></AuthContext.Provider></QueryClientProvider>);
    expect(screen.queryByText('Synthetic Patient')).not.toBeInTheDocument(); await screen.findByText('Appointment group unavailable'); expect(screen.queryByRole('button', { name: 'Cancel future appointments' })).not.toBeInTheDocument();
  });
});
