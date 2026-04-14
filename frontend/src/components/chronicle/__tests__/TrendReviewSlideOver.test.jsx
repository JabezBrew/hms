import { render, screen } from '@testing-library/react';

import TrendReviewSlideOver from '@/components/chronicle/TrendReviewSlideOver';

vi.mock('@/features/nursing/hooks', () => ({
  useVitalSignsTrends: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useFluidBalanceTrends: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
}));

vi.mock('@/components/chronicle/ClinicalTrendLineChart', () => ({
  default: () => <div data-testid="clinical-trend-chart" />,
}));

vi.mock('@/components/nursing/FluidBalanceTrendsChart', () => ({
  default: () => <div data-testid="fluid-balance-chart" />,
}));

const patient = {
  id: 'patient-1',
  user_details: {
    first_name: 'Florence',
    last_name: 'Buabeng',
  },
};

describe('TrendReviewSlideOver', () => {
  it('shows only the vitals tab when there is no admission scope', () => {
    render(
      <TrendReviewSlideOver
        open
        onClose={vi.fn()}
        patient={patient}
        encounterId="enc-1"
      />,
    );

    expect(screen.getByRole('tab', { name: /vitals/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /fluid balance/i })).not.toBeInTheDocument();
  });

  it('shows the fluid tab and respects the requested initial tab when admission scope exists', () => {
    render(
      <TrendReviewSlideOver
        open
        onClose={vi.fn()}
        patient={patient}
        admissionId="adm-1"
        initialTab="fluids"
      />,
    );

    const fluidTab = screen.getByRole('tab', { name: /fluid balance/i });
    expect(fluidTab).toBeInTheDocument();
    expect(fluidTab).toHaveAttribute('data-state', 'active');
  });
});
