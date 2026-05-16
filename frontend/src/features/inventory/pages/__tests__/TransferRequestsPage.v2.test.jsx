import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TransferRequestsPage from '../TransferRequestsPage';

vi.mock('@/features/inventory/hooks', () => ({
  useTransferRequests: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'transfer-1',
          transfer_number: 'TRF-001',
          status: 'pending',
          from_location_name: 'Main Store',
          to_location_name: 'Ward Store',
          requested_by_name: 'Ama Mensah',
          created_at: '2026-05-01T09:00:00Z',
          items_count: 2,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useStorageLocations: () => ({
    data: {
      results: [
        { id: 'location-1', name: 'Main Store' },
        { id: 'location-2', name: 'Ward Store' },
      ],
    },
  }),
}));

vi.mock('@/components/ui/VirtualizedTable', () => ({
  default: ({ rows = [], columns = [] }) => (
    <div>
      {rows.map((row) => (
        <div key={row.id}>
          {columns.map((column) => (
            <div key={column.key}>{column.render ? column.render(row) : row[column.key]}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/inventory', async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    TransferRequestForm: () => null,
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inventory/transfers']}>
      <TransferRequestsPage />
    </MemoryRouter>,
  );
}

describe('TransferRequestsPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('keeps transfer creation visible but hides unsupported action controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.getByText('TRF-001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new transfer/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dispatch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /receive/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/transfer approval, dispatch, and receiving are not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps transfer action controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /new transfer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dispatch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /receive/i })).toBeInTheDocument();
  });
});
