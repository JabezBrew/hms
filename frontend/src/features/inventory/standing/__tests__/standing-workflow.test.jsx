import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { standingApi } from '../api';
import { StandingRequestReviewDialog } from '../StandingRequestReviewDialog';
import { StandingTemplateFormDialog, standingTemplatePayload } from '../StandingTemplateFormDialog';
import { StandingTemplateDetailDialog } from '../StandingTemplateDetailDialog';
vi.mock('../api', () => ({ standingApi: { choices: vi.fn(), create: vi.fn(), update: vi.fn(), status: vi.fn(), run: vi.fn(), get: vi.fn(), review: vi.fn(), approve: vi.fn(), issue: vi.fn(), cancel: vi.fn() } }));
const item = { id: 'catalog-1', item_id: 'catalog-1', code: 'BAND', name: 'Bandages', unit: 'pack', quantity: 2 };
const template = { id: 'template-1', name: 'Weekly supplies', requesting_location_id: 'ward', requesting_location_name: 'Ward A', fulfilling_location_id: 'store', fulfilling_location_name: 'Main store', frequency: 'weekly', status: 'active', next_run_on: '2026-01-01', monthly_day: null, version: 4, line_count: 1, notes: null, items: [{ ...item, id: 'line-1', item_name: item.name, item_code: item.code, current_unit: 'pack', requires_unit_review: false }] };
const manager = { adminAccess: { capabilities: ['inventory.manage'] } };
let client;
let currentRequest;
function wrapper({ children }) { return <AuthContext.Provider value={{ user: manager }}><QueryClientProvider client={client}>{children}</QueryClientProvider></AuthContext.Provider>; }
const envelope = (data, next = null) => ({ data, page: { limit: 25, has_next: Boolean(next), next_cursor: next } });
beforeEach(() => {
  vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1 } } });
  standingApi.choices.mockImplementation(async (kind) => envelope(kind === 'items' ? [item, { ...item, id: 'controlled', name: 'Controlled item', controlled: true }] : [{ id: 'ward', name: 'Ward A', code: 'WA' }, { id: 'store', name: 'Main store', code: 'MS' }]));
  standingApi.create.mockResolvedValue(template); standingApi.update.mockResolvedValue({ ...template, version: 5 }); standingApi.get.mockResolvedValue(template); standingApi.status.mockResolvedValue({ ...template, version: 5, status: 'paused' });
  standingApi.run.mockResolvedValue({ id: 'request-1', requesting_location_name: 'Ward A', fulfilling_location_name: 'Main store', status: 'requested', source_template_id: template.id, template_version: template.version, scheduled_for: template.next_run_on, items: [{ id: 'request-line-1', item_id: item.id, item_name: item.name, item_code: item.code, unit: item.unit, quantity_requested: 2, quantity_issued: 0 }] });
  currentRequest = { id: 'request-1', requesting_location_name: 'Ward A', fulfilling_location_name: 'Main store', status: 'requested', source_template_id: template.id, template_version: template.version, scheduled_for: template.next_run_on, items: [{ id: 'request-line-1', item_id: item.id, item_name: item.name, item_code: item.code, unit: item.unit, quantity_requested: 2, quantity_issued: 0 }] };
  standingApi.review.mockImplementation(async () => structuredClone(currentRequest));
  standingApi.approve.mockImplementation(async () => { currentRequest = { ...currentRequest, status: 'approved' }; return structuredClone(currentRequest); });
  standingApi.issue.mockImplementation(async () => { currentRequest = { ...currentRequest, status: 'fulfilled', items: currentRequest.items.map((line) => ({ ...line, quantity_issued: line.quantity_requested })) }; return structuredClone(currentRequest); });
  standingApi.cancel.mockImplementation(async () => { currentRequest = { ...currentRequest, status: 'cancelled', cancelled_at: '2026-10-15T12:00:00Z' }; return structuredClone(currentRequest); });

});
afterEach(() => client.clear());
async function choose(label, name) {
  const region = screen.getByRole('region', { name: label }); fireEvent.click(within(region).getByRole('button', { name: 'Choose' }));
  fireEvent.click(await within(region).findByRole('button', { name: new RegExp(name) }));
}
async function fillNew() {
  fireEvent.change(screen.getByLabelText('Template name'), { target: { value: ' Weekly supplies ' } });
  await choose('Requesting location', 'Ward A'); await choose('Fulfilling location', 'Main store');
  fireEvent.click(screen.getByRole('button', { name: 'Add item' })); await choose('Item 1', 'Bandages');
  fireEvent.change(screen.getByLabelText('Quantity (pack)'), { target: { value: '2' } });
}
describe('standing template workflows', () => {
  it('creates explicit line-backed configuration with distinct locations and exact unit quantities', async () => {
    render(<StandingTemplateFormDialog onClose={vi.fn()} />, { wrapper }); await fillNew();
    expect(screen.queryByRole('button', { name: /Controlled item/ })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await screen.findByText('Saved configuration'); expect(standingApi.create).toHaveBeenCalledTimes(1);
    expect(standingApi.create.mock.calls[0][0]).toMatchObject({ name: 'Weekly supplies', requesting_location_id: 'ward', fulfilling_location_id: 'store', frequency: 'weekly', monthly_day: null, items: [{ item_id: item.id, quantity: 2, expected_unit: 'pack' }] });
    expect(screen.getByText('Saving this configuration does not reserve or move stock.')).toBeInTheDocument();
  });
  it('rejects duplicate, unsafe or empty quantities before mutation', () => {
    const draft = { name: 'Supplies', requesting: { id: 'ward' }, fulfilling: { id: 'store' }, frequency: 'weekly', next_run_on: '2026-10-15', monthly_day: '', notes: '', items: [item] };
    expect(() => standingTemplatePayload({ ...draft, items: [{ ...item, quantity: Number.MAX_SAFE_INTEGER + 1 }] })).toThrow(/whole-number/);
    expect(() => standingTemplatePayload({ ...draft, items: [item, item] })).toThrow(/different inventory/);
    expect(() => standingTemplatePayload({ ...draft, fulfilling: draft.requesting })).toThrow(/different facility/);
    expect(() => standingTemplatePayload({ ...draft, frequency: 'monthly', monthly_day: '32' })).toThrow(/1 to 31/);
  });
  it('requires explicit changed-unit quantity review and sends expected version and current unit', async () => {
    render(<StandingTemplateFormDialog template={{ ...template, items: [{ ...template.items[0], unit: 'piece', current_unit: 'pack', requires_unit_review: true }] }} onClose={vi.fn()} />, { wrapper });
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled(); expect(screen.getByText(/Saved unit piece; current unit pack/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed quantities/ })); fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await screen.findByText('Saved configuration'); expect(standingApi.update).toHaveBeenCalledWith(template.id, expect.objectContaining({ expected_version: 4, template: expect.objectContaining({ items: [{ item_id: item.id, quantity: 2, expected_unit: 'pack' }] }) }));
  });
  it('preserves the saved unit warning when reselecting the same catalog item', async () => {
    render(<StandingTemplateFormDialog template={{ ...template, items: [{ ...template.items[0], unit: 'piece', current_unit: 'pack', requires_unit_review: true }] }} onClose={vi.fn()} />, { wrapper });
    await choose('Item 1', 'Bandages');
    expect(screen.getByText(/Saved unit piece; current unit pack/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled(); expect(screen.getByRole('checkbox', { name: /reviewed quantities/ })).not.toBeChecked(); expect(standingApi.update).not.toHaveBeenCalled();
  });
  it('blocks duplicate/pending dismissal and does not auto-retry an uncertain create', async () => {
    let reject; standingApi.create.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })); const close = vi.fn();
    render(<StandingTemplateFormDialog onClose={close} />, { wrapper }); await fillNew(); fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(close).not.toHaveBeenCalled();
    reject(Object.assign(new Error('May already be saved'), { code: 'standing_write_unconfirmed' })); await screen.findByText('Save status unknown'); expect(standingApi.create).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
  });
  it('confirms a due occurrence and shows only persisted requested/issued snapshots', async () => {
    render(<StandingTemplateDetailDialog id={template.id} user={manager} onClose={vi.fn()} onEdit={vi.fn()} onReviewRequest={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate due request' })); expect(standingApi.run).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Request saved'); expect(standingApi.run).toHaveBeenCalledWith(template.id, { scheduled_for: template.next_run_on, expected_version: 4 }); expect(screen.getByText('requested')).toBeInTheDocument(); expect(screen.getByText('0')).toBeInTheDocument(); expect(screen.queryByText('fulfilled')).not.toBeInTheDocument();
  });
  it('keeps pause separate from a potentially inactive template configuration', async () => {
    render(<StandingTemplateDetailDialog id={template.id} user={manager} onClose={vi.fn()} onEdit={vi.fn()} onReviewRequest={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Pause template' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); await screen.findByText('Saved configuration');
    expect(standingApi.status).toHaveBeenCalledWith(template.id, { expected_version: 4, status: 'paused' }); expect(standingApi.update).not.toHaveBeenCalled();
  });
  it('hides mutation controls without the explicit capability', async () => {
    render(<StandingTemplateDetailDialog id={template.id} user={{ adminAccess: { capabilities: [] } }} onClose={vi.fn()} onEdit={vi.fn()} onReviewRequest={vi.fn()} />, { wrapper }); await screen.findByText('Bandages'); expect(screen.queryByRole('button', { name: 'Generate due request' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Edit template' })).not.toBeInTheDocument();
  });
});

describe('governed stock request issue', () => {
  it.each(['requested', 'pending', 'approved'])('explicitly cancels a %s request without issuing stock', async (status) => {
    currentRequest.status = status;
    render(<StandingRequestReviewDialog id="request-1" onClose={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' })); expect(standingApi.cancel).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await screen.findByText('Cancellation confirmed'); expect(standingApi.cancel).toHaveBeenCalledWith('request-1', { expected_source_version: 4 }); expect(standingApi.issue).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Issue requested stock' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
  });
  it('keeps cancellation uncertain until an authoritative read succeeds', async () => {
    standingApi.cancel.mockImplementationOnce(async () => { currentRequest.status = 'cancelled'; throw Object.assign(new Error('May already be cancelled'), { code: 'standing_write_unconfirmed' }); });
    render(<StandingRequestReviewDialog id="request-1" onClose={vi.fn()} />, { wrapper }); fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await screen.findByText('Change status unknown'); expect(screen.getByRole('button', { name: 'Confirm cancellation' })).toBeDisabled(); expect(standingApi.cancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh request status' })); await waitFor(() => expect(screen.queryByText('Change status unknown')).not.toBeInTheDocument()); expect(screen.getByText('cancelled')).toBeInTheDocument(); expect(standingApi.cancel).toHaveBeenCalledTimes(1);
  });
  it('requires separate explicit approval and a fresh approved review before issue', async () => {
    render(<StandingRequestReviewDialog id="request-1" onClose={vi.fn()} />, { wrapper });
    const approve = await screen.findByRole('button', { name: 'Approve request' }); expect(screen.queryByRole('button', { name: 'Issue requested stock' })).not.toBeInTheDocument();
    fireEvent.click(approve); expect(standingApi.approve).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText('Approval confirmed'); fireEvent.click(await screen.findByRole('button', { name: 'Issue requested stock' })); expect(standingApi.issue).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm stock issue' }));
    await screen.findByText('Stock issue confirmed'); expect(standingApi.approve).toHaveBeenCalledWith('request-1', { expected_source_version: 4 }); expect(standingApi.issue).toHaveBeenCalledWith('request-1', { expected_source_version: 4 });
    expect(screen.getByText('The issued quantities above are the saved stock transfer.')).toBeInTheDocument();
    expect(screen.getByText('fulfilled')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Issue requested stock' })).not.toBeInTheDocument();
  });
  it('never automatically repeats a persisted-but-unconfirmed issue and resolves it by authoritative review', async () => {
    currentRequest.status = 'approved';
    standingApi.issue.mockImplementationOnce(async () => { currentRequest = { ...currentRequest, status: 'fulfilled', items: currentRequest.items.map((line) => ({ ...line, quantity_issued: 2 })) }; throw Object.assign(new Error('May already be issued'), { code: 'standing_write_unconfirmed' }); });
    render(<StandingRequestReviewDialog id="request-1" onClose={vi.fn()} />, { wrapper }); fireEvent.click(await screen.findByRole('button', { name: 'Issue requested stock' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm stock issue' }));
    await screen.findByText('Change status unknown'); expect(standingApi.issue).toHaveBeenCalledTimes(1); expect(screen.queryByText('Stock issue confirmed')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh request status' })); await waitFor(() => expect(screen.queryByText('Change status unknown')).not.toBeInTheDocument());
    expect(screen.getByText('fulfilled')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Issue requested stock' })).not.toBeInTheDocument(); expect(standingApi.issue).toHaveBeenCalledTimes(1);
  });
  it('preserves a confirmed issue when its subsequent read fails and blocks stock actions', async () => {
    currentRequest.status = 'approved'; standingApi.issue.mockImplementationOnce(async () => { currentRequest = { ...currentRequest, status: 'fulfilled', items: currentRequest.items.map((line) => ({ ...line, quantity_issued: 2 })) }; standingApi.review.mockRejectedValue(new Error('Read unavailable')); return structuredClone(currentRequest); });
    render(<StandingRequestReviewDialog id="request-1" onClose={vi.fn()} />, { wrapper }); fireEvent.click(await screen.findByRole('button', { name: 'Issue requested stock' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm stock issue' }));
    await screen.findByText('Stock issue confirmed'); await screen.findByText(/latest request status could not refresh/); expect(screen.getByText('fulfilled')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Issue requested stock' })).not.toBeInTheDocument();
  });
});
