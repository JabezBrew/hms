import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicationStockPicker } from './MedicationStockPicker';
const getCatalog = vi.fn();
vi.mock('../api/medicationCatalog', () => ({
  getMedicationCatalog: (...args) => getCatalog(...args),
  medicationCatalogKeys: { search: (request) => ['medication-catalog', request] },
}));
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelect = vi.fn();
  render(<QueryClientProvider client={client}><MedicationStockPicker onSelect={onSelect} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Choose facility medication' }));
  return { onSelect, client };
}
describe('Facility medication stock picker', () => {
  beforeEach(() => getCatalog.mockReset());
  it('uses the returned cursor to reach more choices and selects only an explicit product', async () => {
    const first = { id: 'first', code: 'MED-A', name: 'First product', unit: 'tablet' };
    const second = { id: 'second', code: 'MED-B', name: 'Second product', unit: 'vial', controlled: true };
    getCatalog.mockResolvedValueOnce({ data: [first], page: { has_next: true, next_cursor: 'opaque-next' } })
      .mockResolvedValueOnce({ data: [second], page: { has_next: false } });
    const { onSelect } = setup();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more medication choices' }));
    fireEvent.click(await screen.findByRole('button', { name: /second product.*med-b.*controlled medication/i }));
    expect(getCatalog.mock.calls[1][0]).toMatchObject({ cursor: 'opaque-next', signal: expect.any(AbortSignal) });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(second);
  });
  it('offers a visible retry after a catalog failure', async () => {
    getCatalog.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ data: [], page: { has_next: false } });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry catalog' }));
    expect(await screen.findByText(/No matching facility medications/)).toBeInTheDocument();
    expect(getCatalog).toHaveBeenCalledTimes(2);
  });
  it('keeps entered text out of cache keys and searches the server after debounce', async () => {
    getCatalog.mockResolvedValue({ data: [], page: { has_next: false } });
    const { client } = setup();
    fireEvent.change(screen.getByLabelText('Search facility medication catalog'), { target: { value: 'Private typed search' } });
    await waitFor(() => expect(getCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Private typed search' })));
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain('Private typed search');
  });
});
