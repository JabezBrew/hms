import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NhisServiceMappingsPage from '../NhisServiceMappingsPage';

vi.mock('@/features/billing/hooks', () => ({
  useInsuranceProviders: () => ({
    data: {
      count: 1,
      results: [{ id: 'payer-1', name: 'NHIS', code: 'NHIS', payer_type: 'nhis' }],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useServices: () => ({
    data: {
      count: 1,
      results: [{ id: 'service-1', code: 'CONS-GEN', name: 'General Consultation' }],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePayerServiceCodes: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'mapping-1',
          service: 'service-1',
          service_name: 'General Consultation',
          service_code: 'CONS-GEN',
          external_code: 'NHIS-CONS',
          effective_from: '2026-01-01',
          effective_until: null,
          is_active: true,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreatePayerServiceCode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePayerServiceCode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateNhisMappingImportJob: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApplyNhisMappingImportJob: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useNhisMappingImportJob: () => ({
    data: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/components/ui/VirtualizedTable', () => ({
  VirtualizedTable: ({ rows = [], columns = [] }) => (
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

function renderPage() {
  return render(<NhisServiceMappingsPage />);
}

describe('NhisServiceMappingsPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('renders mappings as read-only in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.queryByRole('button', { name: /new mapping/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview import/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply import/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/nhis mapping editing and import are not available in rust v2/i),
    ).toBeInTheDocument();
    expect(screen.getByText('General Consultation')).toBeInTheDocument();
  });

  it('keeps mapping mutation controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /new mapping/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview import/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply import/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });
});
