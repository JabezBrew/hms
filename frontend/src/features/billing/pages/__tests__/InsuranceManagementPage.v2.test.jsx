import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InsuranceManagementPage from '../InsuranceManagementPage';

vi.mock('@/features/billing/hooks', () => ({
  usePatientInsurances: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'insurance-1',
          patient_name: 'Ama Mensah',
          provider_name: 'NHIS',
          plan_name: 'National Health Insurance',
          policy_number: 'NHIS-001',
          member_id: 'MEM-001',
          valid_from: '2026-01-01',
          valid_until: null,
          is_active: true,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDeletePatientInsurance: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/billing/PatientInsuranceFormSlideOver', () => ({
  default: () => null,
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/billing/insurance']}>
      <InsuranceManagementPage />
    </MemoryRouter>,
  );
}

describe('InsuranceManagementPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('renders patient insurance as read-only in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.queryByRole('button', { name: /add insurance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/patient insurance editing is not available in rust v2/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Ama Mensah')).toBeInTheDocument();
  });

  it('keeps patient insurance mutation controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /add insurance/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });
});
