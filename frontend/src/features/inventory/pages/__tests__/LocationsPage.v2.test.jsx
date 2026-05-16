import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LocationsPage from '../LocationsPage';

vi.mock('@/features/inventory/hooks', () => ({
  useStorageLocations: () => ({
    data: {
      count: 1,
      results: [
        {
          id: 'location-1',
          name: 'Main Pharmacy',
          code: 'PHARM-MAIN',
          location_type: 'pharmacy',
          temperature_zone: 'ambient',
          item_count: 42,
          stock_value: 12500,
          is_active: true,
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
  DropdownMenuItem: ({ children, onClick, className }) => (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock('@/components/inventory', async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    LocationForm: () => null,
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inventory/locations']}>
      <LocationsPage />
    </MemoryRouter>,
  );
}

describe('LocationsPage Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('renders storage locations as read-only in Rust V2 mode while keeping transfer workflows visible', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderPage();

    expect(screen.getByText('Main Pharmacy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add location/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view stock/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /transfer to/i })).toBeInTheDocument();
    expect(
      screen.getByText(/storage location creation and editing is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps storage location mutation controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderPage();

    expect(screen.getByRole('button', { name: /add location/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });
});
