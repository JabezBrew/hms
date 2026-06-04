import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WardDashboard } from '../WardDashboard';

const mockUseWard = vi.fn();
const mockUseWardBedMap = vi.fn();

vi.mock('@/features/wards/hooks/useWardQueries', () => ({
  useWard: (...args) => mockUseWard(...args),
  useWardBedMap: (...args) => mockUseWardBedMap(...args),
}));

vi.mock('../WardBedLayout', () => ({
  WardBedLayout: ({ beds }) => (
    <div data-testid="ward-bed-layout">
      Rendered {beds.length} loaded beds
    </div>
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
  it('uses the complete ward bed map snapshot for capacity stats and bed layout', () => {
    const loadedBeds = Array.from({ length: 480 }, (_, index) => ({
      id: `bed-${index + 1}`,
      ward: 'ward-1',
      section: 'section-1',
      bed_number: `MED-${String(index + 1).padStart(2, '0')}`,
      status: index < 225 ? 'occupied' : 'available',
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
    mockUseWardBedMap.mockReturnValue({
      data: {
        ward_id: 'ward-1',
        totals: {
          total_beds: 480,
          available_beds_count: 255,
          occupied_beds_count: 225,
          reserved_beds_count: 0,
          cleaning_beds_count: 0,
          maintenance_beds_count: 0,
        },
        beds: loadedBeds,
        sections: [
          {
            id: 'section-1',
            name: 'Demo Medical Ward Section',
            bed_count: 480,
            available_beds_count: 255,
            occupied_beds_count: 225,
            reserved_beds_count: 0,
            cleaning_beds_count: 0,
            maintenance_beds_count: 0,
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderDashboard();

    expect(screen.getByText('Demo Medical Ward')).toBeInTheDocument();
    expect(screen.getByText('480')).toBeInTheDocument();
    expect(screen.getByText('255')).toBeInTheDocument();
    expect(screen.getByText('225')).toBeInTheDocument();
    expect(screen.getByText('255/480')).toBeInTheDocument();
    expect(screen.getByText('47%')).toBeInTheDocument();
    expect(screen.getByText('225 occupied')).toBeInTheDocument();
    expect(screen.getByTestId('ward-bed-layout')).toHaveTextContent('Rendered 480 loaded beds');
    expect(screen.getByText('Showing 480 of 480 beds')).toBeInTheDocument();
    expect(screen.getByText('255').closest('button')).not.toBeNull();
    expect(
      within(screen.getByRole('group', { name: 'Bed status filter' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['All', 'Vacant', 'Occupied', 'Reserved', 'Cleaning', 'Blocked']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
