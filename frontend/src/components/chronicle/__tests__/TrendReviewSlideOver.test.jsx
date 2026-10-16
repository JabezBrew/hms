import { ChronicleClinicalPermissionsContext } from '@/features/patients/chronicle/clinicalPermissions';
import { render, screen } from '@testing-library/react';

import TrendReviewSlideOver from '@/components/chronicle/TrendReviewSlideOver';
import { useFluidBalanceTrends, useVitalSignsTrends } from '@/features/nursing/hooks';

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

  it('shows an incomplete trend read as unavailable instead of an empty history', () => {
    useFluidBalanceTrends.mockReturnValueOnce({ data: [], isLoading: false, error: new Error('Synthetic page failed') });
    render(<TrendReviewSlideOver open onClose={vi.fn()} patient={patient} allHistory initialTab="fluids" />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be fully loaded');
    expect(screen.queryByText('No fluid-balance data in this scope')).not.toBeInTheDocument();
  });

  it('hides cached vital charts after a failed refresh instead of showing partial history', () => {
    useVitalSignsTrends.mockReturnValueOnce({ data: [{ recorded_at: '2026-10-16T04:00:00Z', temperature: 37 }], isLoading: false, error: new Error('Synthetic page failed') });
    render(<TrendReviewSlideOver open onClose={vi.fn()} patient={patient} allHistory initialTab="vitals" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Vital-sign trends could not be fully loaded');
    expect(screen.queryByTestId('clinical-trend-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('No vital-sign data in this scope')).not.toBeInTheDocument();
  });
});

it('keeps scalar vital trends available without fetching or offering full fluid history for summary access', () => {
  render(<ChronicleClinicalPermissionsContext.Provider value={{ can_view_full_clinical: false }}><TrendReviewSlideOver open onClose={vi.fn()} patient={patient} admissionId="synthetic-admission" allHistory initialTab="vitals" /></ChronicleClinicalPermissionsContext.Provider>); expect(screen.getByRole('tab', { name: /vitals/i })).toHaveAttribute('data-state', 'active'); expect(screen.queryByRole('tab', { name: /fluid balance/i })).not.toBeInTheDocument(); expect(useFluidBalanceTrends.mock.calls.at(-1)[2].enabled).toBe(false);
});
it('removes the fluid panel and stops its query when an existing full-clinical trend view loses permission', () => {
  const tree = (full) => <ChronicleClinicalPermissionsContext.Provider value={{ can_view_full_clinical: full }}><TrendReviewSlideOver open onClose={vi.fn()} patient={patient} admissionId="synthetic-admission" initialTab="fluids" /></ChronicleClinicalPermissionsContext.Provider>; const view = render(tree(true)); expect(screen.getByRole('tab', { name: /fluid balance/i })).toHaveAttribute('data-state', 'active'); expect(useFluidBalanceTrends.mock.calls.at(-1)[2].enabled).toBe(true); view.rerender(tree(false)); expect(screen.queryByRole('tab', { name: /fluid balance/i })).not.toBeInTheDocument(); expect(screen.getByRole('tab', { name: /vitals/i })).toHaveAttribute('data-state', 'active'); expect(useFluidBalanceTrends.mock.calls.at(-1)[2].enabled).toBe(false);
});

it('honors explicit summary-only server proof when the trend component is mounted directly outside the Chronicle provider', () => {
  render(<TrendReviewSlideOver open onClose={vi.fn()} patient={patient} admissionId="synthetic-admission" initialTab="vitals" clinicalPermissions={{ can_view_full_clinical: false }} />); expect(screen.getByRole('tab', { name: /vitals/i })).toBeInTheDocument(); expect(screen.queryByRole('tab', { name: /fluid balance/i })).not.toBeInTheDocument(); expect(useFluidBalanceTrends.mock.calls.at(-1)[2].enabled).toBe(false);
});
