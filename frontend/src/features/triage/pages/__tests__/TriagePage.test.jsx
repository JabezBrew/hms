import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TriagePage from '../TriagePage';

const { useQueue } = vi.hoisted(() => ({ useQueue: vi.fn() }));
vi.mock('@/hooks/useVisitQueries', () => ({ useTriageQueue: useQueue, useTriageActions: () => ({ cancelEntry: { mutate: vi.fn() } }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ facilityCode: 'TEST' }) }));
vi.mock('@/components/layout/layout', () => ({ Layout: ({ children }) => <main>{children}</main> }));
vi.mock('@/components/visits/TriageAssessmentDialog', () => ({ TriageAssessmentDialog: () => null }));
vi.mock('@/components/visits/TriageAssignDialog', () => ({ TriageAssignDialog: () => null }));

const first = { id: 'triage-1', patient: 'patient-1', patient_name: 'First page patient', status: 'waiting', priority: 'routine' };
const second = { id: 'triage-2', patient: 'patient-2', patient_name: 'Next page patient', status: 'waiting', priority: 'routine' };

describe('Triage queue page filtering and server pagination', () => {
  beforeEach(() => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };
    useQueue.mockImplementation((filters) => ({
      data: {
        results: [filters.page === 2 ? second : first],
        count: filters.page === 2 ? 51 : 51,
        count_exact: filters.page === 2,
        page_size: 50,
        page: filters.page,
        next: filters.page === 1 ? 'next-cursor' : null,
      },
      isLoading: false, isFetching: false, refetch: vi.fn(),
    }));
  });
  afterEach(() => { delete window.__HMS_RUNTIME_CONFIG__; });

  it('defaults to waiting patients and exposes cursor paging instead of hiding later entries', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TriagePage /></MemoryRouter>);
    expect(useQueue).toHaveBeenCalledWith({ page: 1, page_size: 50, status: 'waiting' });
    expect(screen.getByText('First page patient')).toBeInTheDocument();
    expect(screen.getByText('More results available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to last page' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(await screen.findByText('Next page patient')).toBeInTheDocument();
    expect(useQueue).toHaveBeenLastCalledWith({ page: 2, page_size: 50, status: 'waiting' });
    await user.click(screen.getByRole('button', { name: 'Go to previous page' }));
    expect(screen.getByText('First page patient')).toBeInTheDocument();
  });

  it('sends status and priority to the server and resets the page whenever filters change', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TriagePage /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    await user.click(screen.getByRole('tab', { name: 'Assigned', exact: true }));
    await waitFor(() => expect(useQueue).toHaveBeenLastCalledWith({ page: 1, page_size: 50, status: 'assigned' }));
    await user.click(screen.getByRole('tab', { name: 'Emergency', exact: true }));
    expect(useQueue).toHaveBeenLastCalledWith({ page: 1, page_size: 50, status: 'assigned', priority: 'emergency' });
    await user.click(screen.getByRole('tab', { name: 'Completed', exact: true }));
    expect(useQueue).toHaveBeenLastCalledWith({ page: 1, page_size: 50, status: 'triaged', priority: 'emergency' });
  });

  it('offers retry on errors while keeping status filters reachable', async () => {
    const refetch = vi.fn();
    useQueue.mockReturnValue({ error: new Error('Offline'), refetch, isLoading: false });
    const user = userEvent.setup();
    render(<MemoryRouter><TriagePage /></MemoryRouter>);
    expect(screen.getByText('Failed to load triage queue')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Assigned' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /Try Again|Retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
