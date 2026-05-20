import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChartBuilderPage from '../ChartBuilderPage';
import ChartTemplateListPage from '../ChartTemplateListPage';

vi.mock('@/features/charts/hooks', () => ({
  useChartTemplates: () => ({
    data: {
      results: [
        {
          id: 'template-1',
          name: 'Vital Signs Sheet',
          description: 'Routine observation chart',
          category: 'nursing',
          scope_type: 'patient',
          visibility: 'facility',
          is_active: true,
        },
      ],
    },
    isLoading: false,
  }),
  useChartCategories: () => ({
    data: [{ value: 'nursing', label: 'Nursing' }],
  }),
  useDeleteChartTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCloneChartTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateChartTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

vi.mock('@/components/charts', () => ({
  ChartTemplateBuilder: () => <div>Chart Template Builder</div>,
}));

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('Chart pages Rust V2 guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('blocks chart template management in Rust V2 mode because no chart-builder contract exists', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderWithRouter(<ChartTemplateListPage />);

    expect(screen.queryByRole('button', { name: /new template/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Vital Signs Sheet')).not.toBeInTheDocument();
    expect(
      screen.getByText(/chart template management is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps chart template management available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderWithRouter(<ChartTemplateListPage />);

    expect(screen.getByRole('button', { name: /new template/i })).toBeInTheDocument();
    expect(screen.getByText('Vital Signs Sheet')).toBeInTheDocument();
  });

  it('blocks the chart builder form in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    renderWithRouter(<ChartBuilderPage />);

    expect(screen.queryByText('Chart Template Builder')).not.toBeInTheDocument();
    expect(
      screen.getByText(/chart builder is not available in rust v2/i),
    ).toBeInTheDocument();
  });

  it('keeps the chart builder form available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    renderWithRouter(<ChartBuilderPage />);

    expect(screen.getByText('Chart Template Builder')).toBeInTheDocument();
  });
});
