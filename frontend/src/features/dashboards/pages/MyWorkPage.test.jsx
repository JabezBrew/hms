import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import MyWorkPage from './MyWorkPage';

vi.mock('@/features/dashboards/hooks', () => ({
  useDashboardModuleGates: () => ({
    hasFeatureMap: true,
    isResolving: false,
    canUse: (features) => features.every((feature) => feature === 'patient_registration'),
  }),
}));
vi.mock('@/features/care-areas/hooks/useCareAreaQueries', () => ({
  useCareAreaMyWork: () => ({ data: {}, isLoading: false }),
}));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }));

describe('My Work access', () => {
  it('lets registration-only facilities reach Patient Directory without Chronicle', () => {
    render(<MemoryRouter><MyWorkPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Open Patient Directory' })).toHaveAttribute('href', '/patients');
    expect(screen.queryByRole('link', { name: 'Open My context' })).not.toBeInTheDocument();
  });
});
