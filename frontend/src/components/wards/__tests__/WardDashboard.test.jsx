import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WardDashboard } from '../WardDashboard';

const mockUseWard = vi.fn();
const mockUseWardBeds = vi.fn();
const mockUseAdmissions = vi.fn();
const mockUseWardSections = vi.fn();

vi.mock('@/features/wards/hooks/useWardQueries', () => ({
  useWard: (...args) => mockUseWard(...args),
  useWardBeds: (...args) => mockUseWardBeds(...args),
  useAdmissions: (...args) => mockUseAdmissions(...args),
  useWardSections: (...args) => mockUseWardSections(...args),
}));

vi.mock('../WardBedLayout', () => ({
  WardBedLayout: ({ beds }) => (
    <div data-testid="ward-bed-layout">Rendered {beds.length} loaded beds</div>
  ),
}));

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/wards/ward-1']}>
      <Routes>
        <Route path="/wards/:wardId" element={<WardDashboard />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WardDashboard', () => {
  it('uses aggregate ward and section counters instead of the first bed page for capacity stats', () => {
    const loadedBeds = Array.from({ length: 100 }, (_, index) => ({
      id: `bed-${index + 1}`,
      ward: 'ward-1',
      section: 'section-1',
      bed_number: `MED-${String(index + 1).padStart(2, '0')}`,
      status: 'occupied',
    }));

    mockUseWard.mockReturnValue({
      data: {
        id: 'ward-1',
        name: 'Demo Medical Ward',
        ward_type: 'demo-medical',
        is_active: true,
        total_beds: 480,
        available_beds_count: 255,
        occupied_beds_count: 225,
        reserved_beds_count: 0,
        cleaning_beds_count: 0,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseWardBeds.mockReturnValue({
      data: loadedBeds,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseAdmissions.mockReturnValue({
      data: [],
      isLoading: false,
    });
    mockUseWardSections.mockReturnValue({
      data: [
        {
          id: 'section-1',
          name: 'Demo Medical Ward Section',
          bed_count: 480,
          available_beds_count: 255,
          occupied_beds_count: 225,
          reserved_beds_count: 0,
          cleaning_beds_count: 0,
        },
      ],
      isLoading: false,
    });

    renderDashboard();

    expect(screen.getByText('Demo Medical Ward')).toBeInTheDocument();
    expect(screen.getByText('480')).toBeInTheDocument();
    expect(screen.getByText('255')).toBeInTheDocument();
    expect(screen.getByText('225')).toBeInTheDocument();
    expect(screen.getByText('255/480')).toBeInTheDocument();
    expect(screen.getByText('47%')).toBeInTheDocument();
    expect(screen.getByText('225 occupied')).toBeInTheDocument();
    expect(screen.getByText('Showing 100 of 480 beds')).toBeInTheDocument();
    expect(screen.getByText('255').closest('button')).toBeNull();
  });
});
