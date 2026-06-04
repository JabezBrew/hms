import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WardBedLayout } from '../WardBedLayout';

const mockUseWardSections = vi.fn();

vi.mock('@/features/wards/hooks/useWardQueries', () => ({
  useWardSections: (...args) => mockUseWardSections(...args),
}));

describe('WardBedLayout', () => {
  it('renders operational bay cells without patient names or clinical details', () => {
    mockUseWardSections.mockReturnValue({
      data: [
        {
          id: 'section-a',
          name: 'Bay A',
          accommodation_tier: 'open',
          display_order: 1,
        },
      ],
    });

    render(
      <WardBedLayout
        wardId="ward-1"
        viewMode="grid"
        onBedClick={vi.fn()}
        beds={[
          {
            id: 'bed-1',
            ward: 'ward-1',
            section: 'section-a',
            bed_number: 'A-01',
            bed_type: 'standard',
            status: 'occupied',
            occupied_since: new Date().toISOString(),
          },
          {
            id: 'bed-2',
            ward: 'ward-1',
            section: 'section-a',
            bed_number: 'A-02',
            bed_type: 'standard',
            status: 'maintenance',
          },
        ]}
        admissions={[
          {
            id: 'legacy-admission-1',
            bed: 'bed-1',
            status: 'admitted',
            admission_date: new Date().toISOString(),
            patient_name: 'Akua Owusu',
            diagnosis: 'Pneumonia',
            reason_for_admission: 'Respiratory distress',
          },
        ]}
      />,
    );

    expect(screen.getByText('Bay A')).toBeInTheDocument();
    expect(screen.getByText('A-01')).toBeInTheDocument();
    expect(screen.getByText('A-02')).toBeInTheDocument();
    expect(screen.getByText('LOS 0d')).toBeInTheDocument();
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.queryByText('Akua Owusu')).not.toBeInTheDocument();
    expect(screen.queryByText('Pneumonia')).not.toBeInTheDocument();
    expect(screen.queryByText('Respiratory distress')).not.toBeInTheDocument();
  });
});
