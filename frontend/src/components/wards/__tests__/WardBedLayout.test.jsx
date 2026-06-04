import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WardBedLayout } from '../WardBedLayout';

const mockUseWardSections = vi.fn();
const TEST_NOW = '2026-06-04T12:00:00.000Z';

vi.mock('@/features/wards/hooks/useWardQueries', () => ({
  useWardSections: (...args) => mockUseWardSections(...args),
}));

describe('WardBedLayout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TEST_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
        beds={[
          {
            id: 'bed-1',
            ward: 'ward-1',
            section: 'section-a',
            bed_number: 'A-01',
            bed_type: 'standard',
            status: 'occupied',
            occupied_since: TEST_NOW,
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
            admission_date: TEST_NOW,
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
    expect(screen.queryByRole('button', { name: /A-01/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Akua Owusu')).not.toBeInTheDocument();
    expect(screen.queryByText('Pneumonia')).not.toBeInTheDocument();
    expect(screen.queryByText('Respiratory distress')).not.toBeInTheDocument();
  });

  it('orders available beds before other statuses inside each bay', () => {
    mockUseWardSections.mockReturnValue({
      data: [
        {
          id: 'section-a',
          name: 'Bay A',
          display_order: 1,
        },
      ],
    });

    render(
      <WardBedLayout
        wardId="ward-1"
        viewMode="grid"
        beds={[
          {
            id: 'bed-1',
            ward: 'ward-1',
            section: 'section-a',
            bed_number: 'A-01',
            status: 'occupied',
            occupied_since: TEST_NOW,
          },
          {
            id: 'bed-2',
            ward: 'ward-1',
            section: 'section-a',
            bed_number: 'A-02',
            status: 'available',
          },
          {
            id: 'bed-3',
            ward: 'ward-1',
            section: 'section-a',
            bed_number: 'A-03',
            status: 'maintenance',
          },
        ]}
      />,
    );

    const availableBed = screen.getByText('A-02');
    const occupiedBed = screen.getByText('A-01');
    const blockedBed = screen.getByText('A-03');

    expect(
      availableBed.compareDocumentPosition(occupiedBed) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      occupiedBed.compareDocumentPosition(blockedBed) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
