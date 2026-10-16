import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import AddFluidBalanceSlideOver from '../AddFluidBalanceSlideOver';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
const ids = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [id, patientId, admissionId, nextId] = ids;
const pointerDescriptors = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'].map((name) => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)]);
beforeAll(() => { for (const [name, descriptor] of pointerDescriptors) if (!descriptor) Object.defineProperty(Element.prototype, name, { configurable: true, value: name === 'hasPointerCapture' ? () => false : () => {} }); });
afterAll(() => { for (const [name, descriptor] of pointerDescriptors) { if (descriptor) Object.defineProperty(Element.prototype, name, descriptor); else delete Element.prototype[name]; } });
let proofVersion = 1;
let permissions = ['nursing.task.manage', 'admin.authority.manage'];
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'synthetic-user', adminAccess: { capabilities: permissions }, accessContext: { permission_version: proofVersion, features: ['nursing'], patient_visibility: ['demographics'] } } }) }));
const originalFetch = globalThis.fetch; const originalConfig = window.__HMS_RUNTIME_CONFIG__;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const policy = { version: 0, configured: false, values: { min_daily_intake_target: 1500, max_daily_output_threshold: 3000, negative_balance_alert_threshold: -500, positive_balance_alert_threshold: 2000, enable_intake_alerts: false, enable_output_alerts: false, enable_balance_alerts: false } };
let row; let posts; let failWrite; let failReads; let failNext; let firstPageMore;
function serve(url, options = {}) {
  const parsed = new URL(url); const path = parsed.pathname;
  if (options.method === 'POST') {
    const body = JSON.parse(options.body); posts.push({ path, body });
    if (failWrite) return Promise.resolve(json({ error: { code: 'fluid_write_unconfirmed', message: 'Could not confirm persistence' } }, 409));
    const action = path.endsWith('/corrections') ? 'corrected' : path.endsWith('/void') ? 'voided' : 'created';
    if (action === 'corrected') row = { ...row, id: nextId, revision: 2, values: body.replacement };
    if (action === 'voided') row = { ...row, current: false, closed_by_action: 'voided', correction_reason: body.reason, closed_at: new Date().toISOString(), closed_by_display_name: 'Synthetic clinician' };
    return Promise.resolve(json({ data: { client_request_id: body.client_request_id, root_entry_id: id, entry_id: row.id, revision: row.revision, action, replayed: false } }));
  }
  if (failReads) return Promise.resolve(json({ error: { code: 'unavailable' } }, 503));
  if (path.endsWith('/summary')) return Promise.resolve(json({ data: { entry_count: 1000, total_intake_ml: 300000, total_output_ml: 100000, net_ml: 200000, intake_breakdown: [{ category: 'oral', total_ml: 300000 }], output_breakdown: [{ category: 'urine', total_ml: 100000 }] } }));
  if (path.endsWith('/assessment')) return Promise.resolve(json({ data: { patient_id: patientId, admission_case_id: admissionId, date: parsed.searchParams.get('date'), evaluated_at: new Date().toISOString(), partial_day: true, status: 'unconfigured', settings: policy, entry_count: 1, total_intake_ml: 300, total_output_ml: 100, net_ml: 200, conditions: [] } }));
  if (path.endsWith('/history')) return Promise.resolve(json({ data: [row], page: { has_next: false, next_cursor: null, limit: 25 } }));
  if (path.endsWith('/fluid-observations')) {
    expect(parsed.searchParams.get('patient_id')).toBe(patientId);
    if (parsed.searchParams.has('cursor') && failNext) return Promise.resolve(json({ error: { code: 'later_page_failed' } }, 503));
    return Promise.resolve(json({ data: (row.current || parsed.searchParams.get('include_closed') === 'true') && (!parsed.searchParams.has('recorded_from') || Date.parse(row.values.recorded_at) >= Date.parse(parsed.searchParams.get('recorded_from'))) && (!parsed.searchParams.has('recorded_before') || Date.parse(row.values.recorded_at) < Date.parse(parsed.searchParams.get('recorded_before'))) ? [row] : [], page: { has_next: firstPageMore && !parsed.searchParams.has('cursor'), next_cursor: firstPageMore ? 'opaque-next' : null, limit: 25 } }));
  }
  return Promise.resolve(json({ data: path.endsWith(`/${id}`) && row.id !== id ? { ...row, id, current: false } : row }));
}
function view(props = {}, host = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 1, retryDelay: 0 } } });
  const defaults = { open: true, patient: { id: patientId, name: 'Synthetic patient' }, admission: { id: admissionId }, onClose: vi.fn() };
  const wrap = (next) => <QueryClientProvider client={client}><MemoryRouter>{host ? <ChronicleWorkspaceHost activeWorkspace={next.open === false ? null : 'fluids'} workspaceContext={{ patient: { ...defaults.patient, current_admission_id: admissionId }, onClose: defaults.onClose, activeEncounter: { id: 'synthetic-encounter' } }} /> : <AddFluidBalanceSlideOver {...defaults} {...next} />}</MemoryRouter></QueryClientProvider>;
  const rendered = render(wrap(props)); return { ...rendered, client, update: (next) => rendered.rerender(wrap({ ...props, ...next })) };
}
beforeEach(() => { proofVersion = 1; permissions = ['nursing.task.manage', 'admin.authority.manage']; window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); row = { id, root_entry_id: id, patient_id: patientId, admission_case_id: admissionId, revision: 1, current: true, created_at: '2026-05-16T08:00:00Z', recorded_by_display_name: 'Synthetic clinician', values: { recorded_at: `${new Date().toISOString().slice(0, 10)}T00:00:00.123Z`, intake_ml: 300, output_ml: 100, metadata: { intake_category: 'oral', output_category: 'urine', notes: 'Synthetic recorded note' } } }; posts = []; failWrite = false; failReads = false; failNext = false; firstPageMore = false; globalThis.fetch = vi.fn(serve); });
afterEach(() => { globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalConfig; __resetV2ApiClientForTests(); vi.useRealTimers(); });
describe('Chronicle immutable fluid workflow using real generated client', () => {
  it('shows complete server totals, saved metadata, scoped UTC rows and non-alarming unconfigured rules', async () => {
    view(); expect(await screen.findByText('Synthetic recorded note')).toBeInTheDocument(); expect(screen.getByLabelText('Complete fluid totals')).toHaveTextContent('300000'); expect(screen.getByText(/1000 effective observations/)).toBeInTheDocument(); expect(await screen.findByText(/Facility rules have not been configured/)).toBeInTheDocument(); expect(screen.getByText(/Current admission/)).toBeInTheDocument();
    for (const [url] of globalThis.fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/fluid-observations'))) expect(new URL(url).searchParams.get('admission_case_id')).toBe(admissionId);
  });
  it('records category/notes without automatic repeats and retains an unknown UUID/payload across close and reopen', async () => {
    const user = userEvent.setup(); failWrite = true; const rendered = view(); await screen.findByText('Synthetic recorded note');
    fireEvent.change(screen.getByLabelText('Intake volume (ml)'), { target: { value: '250' } }); await user.click(screen.getByLabelText('Intake category')); await user.click(screen.getByRole('option', { name: 'Oral' })); fireEvent.change(screen.getByLabelText('Observation notes (optional)'), { target: { value: 'Synthetic new note' } });
    await user.click(screen.getByRole('button', { name: 'Record fluid observation' })); expect(await screen.findByText(/This change may already be saved/)).toBeInTheDocument(); expect(posts).toHaveLength(1); expect(screen.getByLabelText('Intake volume (ml)')).toBeDisabled(); expect(screen.queryByRole('button', { name: 'Start another observation' })).not.toBeInTheDocument();
    rendered.update({ open: false }); rendered.update({ open: true }); expect(screen.getByLabelText('Intake volume (ml)')).toBeDisabled(); await user.click(screen.getByRole('button', { name: 'Retry exact observation' })); await waitFor(() => expect(posts).toHaveLength(2)); expect(posts[1].body).toEqual(posts[0].body); expect(posts[0].body.values.metadata.notes).toBe('Synthetic new note'); expect(posts[0].body.values.output_ml).toBe(0);
  });
  it('corrects both sides after fresh source review and preserves the original precise observation time', async () => {
    const user = userEvent.setup(); view(); await user.click(await screen.findByRole('button', { name: 'Correct' })); await screen.findByText(/Current observation:/); const intake = screen.getAllByLabelText('Intake volume (ml)').at(-1); fireEvent.change(intake, { target: { value: '450' } }); fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Synthetic measured correction' } }); await user.click(screen.getByRole('button', { name: 'Review change' })); await user.click(screen.getByRole('button', { name: 'Confirm change' })); expect(await screen.findByText(/Correction confirmed/)).toBeInTheDocument(); expect(posts).toHaveLength(1); expect(posts[0].body.replacement).toMatchObject({ intake_ml: 450, output_ml: 100, recorded_at: `${new Date().toISOString().slice(0, 10)}T00:00:00.123Z` }); expect(posts[0].path).toMatch(new RegExp(`${id}/corrections$`));
  });
  it('requires an explicit reason and review before void and preserves the receipt after refresh', async () => {
    const user = userEvent.setup(); view(); await user.click(await screen.findByRole('button', { name: 'Void' })); await screen.findByText(/Current observation:/); await user.click(screen.getByRole('button', { name: 'Review change' })); expect(screen.getByRole('alert')).toHaveTextContent('Record a reason'); expect(posts).toHaveLength(0); fireEvent.change(screen.getByLabelText('Reason for void'), { target: { value: 'Synthetic duplicate observation' } }); await user.click(screen.getByRole('button', { name: 'Review change' })); await user.click(screen.getByRole('button', { name: 'Confirm change' })); expect(await screen.findByText(/Void confirmed/)).toBeInTheDocument(); expect(posts[0].path).toMatch(/\/void$/);
  });
  it('surfaces later-page and aggregate failures without pretending the partial list is complete or missing values are zero', async () => {
    firstPageMore = true; failNext = true; const user = userEvent.setup(); view(); await user.click(await screen.findByRole('button', { name: 'Load more observations' })); expect(await screen.findByText(/Observations could not be completely loaded/)).toBeInTheDocument(); expect(screen.getByLabelText('Complete fluid totals')).toHaveTextContent('1000 effective');
  });
  it('suppresses unread data and scopes open correction state to the patient/admission', async () => {
    const user = userEvent.setup(); const rendered = view(); await user.click(await screen.findByRole('button', { name: 'Correct' })); await screen.findByLabelText('Reason for correction'); rendered.update({ admission: { id: ids[6] }, allowEntry: false }); expect(screen.queryByLabelText('Reason for correction')).not.toBeInTheDocument(); expect(posts).toHaveLength(0);
  });
  it('keeps no-admission views read only and patient scoped', async () => { view({ admission: null }); await screen.findByText('Synthetic recorded note'); expect(screen.queryByRole('button', { name: 'Record fluid observation' })).not.toBeInTheDocument(); for (const [url] of globalThis.fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/fluid-observations'))) expect(new URL(url).searchParams.has('admission_case_id')).toBe(false); });
  it('rolls rows and complete totals across the same explicit UTC midnight', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T23:59:59Z')); row.values.recorded_at = '2026-10-15T00:00:00.123Z'; view(); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); const before = globalThis.fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/summary')).at(-1); expect(new URL(before[0]).searchParams.get('recorded_from')).toBe('2026-10-15T00:00:00.000Z'); await act(async () => { await vi.advanceTimersByTimeAsync(1001); }); const after = globalThis.fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/summary')).at(-1); expect(new URL(after[0]).searchParams.get('recorded_from')).toBe('2026-10-16T00:00:00.000Z'); expect(screen.getByLabelText('Observation date (UTC)')).toHaveValue('2026-10-16');
  });
});

it('blocks Escape while correction is pending and retains an uncertain change above the dismissible portal', async () => {
  const user = userEvent.setup(); let finish; let pendingWrite = true;
  globalThis.fetch.mockImplementation((url, options) => {
    if (options.method === 'POST' && pendingWrite) { posts.push({ path: new URL(url).pathname, body: JSON.parse(options.body) }); return new Promise((resolve) => { finish = resolve; }); }
    return serve(url, options);
  });
  view(); await user.click(await screen.findByRole('button', { name: 'Correct' })); await screen.findByLabelText('Reason for correction'); fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Synthetic preserved correction' } }); await user.click(screen.getByRole('button', { name: 'Review change' })); await user.click(screen.getByRole('button', { name: 'Confirm change' })); await waitFor(() => expect(posts).toHaveLength(1));
  await user.keyboard('{Escape}'); expect(screen.getByText('Correct fluid observation')).toBeInTheDocument(); expect(screen.getByLabelText('Reason for correction')).toBeDisabled();
  pendingWrite = false; failWrite = true; await act(async () => { finish(json({ error: { code: 'fluid_write_unconfirmed' } }, 409)); }); await screen.findByText(/This change may already be saved/); await user.keyboard('{Escape}'); expect(screen.queryByText('Correct fluid observation')).not.toBeInTheDocument(); await user.click(screen.getByRole('button', { name: 'Review pending change' })); expect(screen.getByLabelText('Reason for correction')).toHaveValue('Synthetic preserved correction'); expect(screen.getByLabelText('Reason for correction')).toBeDisabled(); await user.click(screen.getByRole('button', { name: 'Retry exact change' })); await waitFor(() => expect(posts).toHaveLength(2)); expect(posts[1].body).toEqual(posts[0].body);
});
it('removes copied source and entry controls immediately when nursing capability is lost', async () => {
  const user = userEvent.setup(); const rendered = view(); await user.click(await screen.findByRole('button', { name: 'Correct' })); await screen.findByLabelText('Reason for correction'); fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'A copied change in the old scope' } }); permissions = []; rendered.update({}); expect(screen.getByText('Fluid balance unavailable')).toBeInTheDocument(); expect(screen.queryByLabelText('Reason for correction')).not.toBeInTheDocument(); expect(screen.queryByText('Synthetic recorded note')).not.toBeInTheDocument(); expect(posts).toHaveLength(0);
});
it('reviews all effective history with full server totals and no date-scoped assessment claim', async () => {
  const user = userEvent.setup(); view(); await screen.findByText('Synthetic recorded note'); await user.click(screen.getByRole('button', { name: 'Review all history' })); expect(await screen.findByText(/complete selected history/)).toBeInTheDocument(); expect(screen.getByLabelText('Observation date (UTC)')).toBeDisabled(); const request = globalThis.fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/fluid-observations')).at(-1); expect(new URL(request[0]).searchParams.has('recorded_from')).toBe(false); expect(new URL(request[0]).searchParams.get('admission_case_id')).toBe(admissionId); expect(screen.getByText(/Choose a specific UTC day/)).toBeInTheDocument();
});

it('keeps voided evidence and its reason reachable after closing the confirmed receipt', async () => {
 const user=userEvent.setup();view();await user.click(await screen.findByRole('button',{name:'Void'}));await screen.findByLabelText('Reason for void');fireEvent.change(screen.getByLabelText('Reason for void'),{target:{value:'Synthetic preserved void reason'}});await user.click(screen.getByRole('button',{name:'Review change'}));await user.click(screen.getByRole('button',{name:'Confirm change'}));await screen.findByText(/Void confirmed/);await user.click(screen.getByRole('button',{name:'Done'}));await user.click(screen.getByRole('button',{name:'Show voided observations'}));await screen.findByText(/Voided · excluded from totals/);expect(screen.queryByRole('button',{name:'Correct'})).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'History'}));await screen.findByText('Reason: Synthetic preserved void reason');expect(screen.getByText(/Revision 1 · Voided/)).toBeInTheDocument();
});

it('retains the exact uncertain command through the real Chronicle workspace host close/reopen boundary', async () => {
 const user=userEvent.setup();failWrite=true;const rendered=view({},true);await screen.findByLabelText('Intake volume (ml)');fireEvent.change(screen.getByLabelText('Intake volume (ml)'),{target:{value:'275'}});await user.click(screen.getByLabelText('Intake category'));await user.click(screen.getByRole('option',{name:'Oral'}));await user.click(screen.getByRole('button',{name:'Record fluid observation'}));await screen.findByText(/This change may already be saved/);expect(posts).toHaveLength(1);rendered.update({open:false});rendered.update({open:true});await screen.findByLabelText('Intake volume (ml)');expect(screen.getByLabelText('Intake volume (ml)')).toBeDisabled();expect(screen.getByLabelText('Intake volume (ml)')).toHaveValue(275);await user.click(screen.getByRole('button',{name:'Retry exact observation'}));await waitFor(()=>expect(posts).toHaveLength(2));expect(posts[1].body).toEqual(posts[0].body);
});

it('defers the fluid workspace until first open and leaves no fluid DOM or active reads while closed', async () => {
 const uuid=vi.spyOn(crypto,'randomUUID');const before=uuid.mock.calls.length;const rendered=view({open:false},true);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(globalThis.fetch).not.toHaveBeenCalled();expect(uuid.mock.calls).toHaveLength(before);rendered.update({open:true});await screen.findByText('Synthetic recorded note');await waitFor(()=>expect(rendered.client.isFetching()).toBe(0));rendered.update({open:false});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByText('Synthetic recorded note')).not.toBeInTheDocument();const reads=globalThis.fetch.mock.calls.length;await act(async()=>{await rendered.client.invalidateQueries({queryKey:['fluid-observations']});});expect(globalThis.fetch).toHaveBeenCalledTimes(reads);uuid.mockRestore();
});
it('drops retained clinical form content when durable authorization proof changes even if permissions remain', async () => {
 const rendered=view({},true);await screen.findByLabelText('Observation notes (optional)');fireEvent.change(screen.getByLabelText('Observation notes (optional)'),{target:{value:'Synthetic old authorization draft'}});rendered.update({open:false});proofVersion=2;rendered.update({open:true});await screen.findByLabelText('Observation notes (optional)');expect(screen.getByLabelText('Observation notes (optional)')).toHaveValue('');expect(screen.queryByDisplayValue('Synthetic old authorization draft')).not.toBeInTheDocument();expect(posts).toHaveLength(0);
});
