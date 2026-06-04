import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import ReferralInbox from '../ReferralInbox';

vi.mock('@/features/referrals/hooks', () => ({
  useReferral: (id) => ({
    data: id === 'referral-target'
      ? {
        id: 'referral-target',
        referral_number: 'REF-099',
        patient: 'patient-target',
        patient_name: 'Target Patient',
        patient_mrn: 'MRN-099',
        priority: 'urgent',
        status: 'accepted',
        to_service: 'Surgery',
        referred_to_department: 'surgery',
        reason: 'Procedure review',
        created_at: '2026-05-13T10:00:00Z',
      }
      : null,
    isLoading: false,
  }),
  useReferralInbox: () => ({
    data: {
      referrals: [
        {
          id: 'referral-1',
          referral_number: 'REF-001',
          patient: 'patient-1',
          patient_name: 'First Patient',
          patient_mrn: 'MRN-001',
          priority: 'routine',
          status: 'pending',
          to_service: 'Medicine',
          referred_to_department: 'medicine',
          reason: 'Review',
          created_at: '2026-05-12T10:00:00Z',
        },
      ],
    },
    isLoading: false,
  }),
  useReferralSlaDashboard: () => ({
    data: { risk_summary: { breached: 0 } },
  }),
  useClinicWaitlistSummary: () => ({
    data: { rows: [] },
  }),
  useAcceptReferral: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeclineReferral: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCompleteReferral: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock('@/shared/hooks/useListFilters', () => ({
  useListFilters: () => ({
    search: '',
    updateSearch: vi.fn(),
    hasActiveFilters: false,
  }),
}));

describe('ReferralInbox', () => {
  it('fetches and marks the Omni search target referral when it is not in the inbox page', () => {
    render(
      <MemoryRouter initialEntries={['/referrals/inbox?referral=referral-target']}>
        <ReferralInbox />
      </MemoryRouter>
    );

    const target = document.querySelector('[data-omni-target="true"]');
    expect(target).toBeInTheDocument();
    expect(target).toHaveTextContent('Target Patient');
    expect(screen.getByText(/Referral #REF-001/i).closest('[data-omni-target]')).toBeNull();
  });
});
