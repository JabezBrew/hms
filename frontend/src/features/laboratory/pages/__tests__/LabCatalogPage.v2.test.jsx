import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LabCatalogPage from '../LabCatalogPage';

vi.mock('@/features/laboratory/hooks', () => ({
  useLabTests: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'test-1',
          name: 'Full Blood Count',
          description: 'CBC equivalent',
          loinc_code: 'FBC',
          category: 'hematology',
          price: '45.00',
          tat_hours: 4,
          specimen_type: 'blood',
          is_system_default: false,
          is_facility_modified: false,
          is_active: true,
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useLabPanels: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'panel-1',
          name: 'Renal Function Panel',
          description: 'Kidney profile',
          code: 'RFT',
          test_count: 3,
          price: '80.00',
          is_system_default: false,
          is_facility_modified: false,
          is_active: true,
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useDeleteLabTest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteLabPanel: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

vi.mock('@/components/laboratory/LabTestCustomizeSlideOver', () => ({
  LabTestCustomizeSlideOver: () => null,
}));

vi.mock('@/components/laboratory/AddLabTestSlideOver', () => ({
  AddLabTestSlideOver: () => null,
}));

vi.mock('@/hooks/useSlideOver', () => ({
  useSlideOver: () => [false, vi.fn(), vi.fn()],
}));

function renderLabCatalogPage() {
  return render(
    <MemoryRouter>
      <LabCatalogPage />
    </MemoryRouter>,
  );
}

describe('LabCatalogPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('renders the Rust V2 lab catalog as read-only because catalog mutations have no generated contract', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderLabCatalogPage();

    expect(screen.getByText('Full Blood Count')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add test/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/lab catalog editing is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps lab catalog mutation controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderLabCatalogPage();

    expect(screen.getByRole('button', { name: /add test/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });
});
