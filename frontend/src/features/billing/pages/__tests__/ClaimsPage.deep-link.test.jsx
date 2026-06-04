import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import ClaimsPage from '../ClaimsPage';

vi.mock('@/features/billing/hooks', () => ({
  useClaims: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'claim-1',
          claim_number: 'CLM-001',
          patient_name: 'Patient One',
          invoice_number: 'INV-001',
          insurance_provider: 'NHIS',
          status: 'submitted',
          claimed_amount: 125,
          approved_amount: 0,
          created_at: '2026-01-01T10:00:00Z',
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useClaim: (id) => ({
    data: id
      ? {
          id,
          claim_number: 'CLM-001',
          patient_name: 'Patient One',
          status: 'submitted',
          claimed_amount: 125,
        }
      : null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/components/ui/VirtualizedTable', () => ({
  default: ({ rows = [], columns = [], getRowClassName, onRowClick }) => (
    <div>
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className={getRowClassName?.(row)}
          onClick={() => onRowClick?.(row)}
        >
          {columns.map((column) => (
            <span key={column.key}>{column.render ? column.render(row) : row[column.key]}</span>
          ))}
        </button>
      ))}
    </div>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(route = '/billing/claims') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/billing/claims"
          element={(
            <>
              <LocationProbe />
              <ClaimsPage />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ClaimsPage Omni Search deep links', () => {
  it('renders a target claim panel from the claim route param', () => {
    renderPage('/billing/claims?claim=claim-1');

    const target = document.querySelector('[data-omni-target="true"]');
    expect(target).toHaveTextContent('CLM-001');
    expect(target).toHaveTextContent('Patient One');
  });

  it('keeps claim row navigation on the registered claims route', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /CLM-001/i }));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/billing/claims?claim=claim-1');
  });
});
