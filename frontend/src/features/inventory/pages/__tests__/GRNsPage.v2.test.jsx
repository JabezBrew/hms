import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GRNsPage from '../GRNsPage';

vi.mock('@/features/inventory/hooks', () => ({
  useGRNs: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'grn-1',
          grn_number: 'GRN-001',
          status: 'pending_inspection',
          po_number: 'PO-001',
          supplier_name: 'Acme Medical',
          received_date: '2026-05-01',
          items_count: 2,
          accepted_count: 0,
          rejected_count: 0,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
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

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <>{children}</>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inventory/grns']}>
      <GRNsPage />
    </MemoryRouter>,
  );
}

describe('GRNsPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('keeps supported GRN actions visible in Rust V2 mode but hides unsupported rejection', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.getByText('GRN-001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new grn/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start inspection/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/grn rejection is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps GRN rejection visible outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
  });
});
