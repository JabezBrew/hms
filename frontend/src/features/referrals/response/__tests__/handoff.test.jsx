import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReferralInbox from '@/features/referrals/pages/ReferralInbox';
import ReferralSent from '@/features/referrals/pages/ReferralSent';
import { useChronicleRouteState } from '@/features/patients/chronicle/useChronicleRouteState';
import { useChronicleWorkspaceActions } from '@/features/patients/chronicle/useChronicleWorkspaceActions';
import { buildChronicleWorkspaceProps, chronicleWorkspaceLoaders } from '@/features/patients/chronicle/workspaceRegistry';
import { patientId, referralId } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
const hooks = vi.hoisted(() => ({ complete: vi.fn(), accept: vi.fn() }));
const row = { id: referralId, referral_number: 'SYNTHETIC', patient: patientId, patient_name: 'Synthetic patient', status: 'accepted', priority: 'routine', to_service: 'Synthetic service', reason: 'Synthetic referral', created_at: '2026-10-17T09:00:00Z', specialist_notes: '[Acceptance Notes] Private synthetic old body', recommendations: 'Private synthetic old recommendation' };
vi.mock('@/features/referrals/hooks', () => ({ useReferral: () => ({ data: null }), useReferralInbox: () => ({ data: { referrals: [row] } }), useReferralsSent: () => ({ data: { referrals: [{ ...row, status: 'completed' }] } }), useReferralSlaDashboard: () => ({ data: {} }), useClinicWaitlistSummary: () => ({ data: {} }), useReferralSlaState: () => ({ data: {} }), useAcceptReferral: () => ({ mutateAsync: hooks.accept }), useDeclineReferral: () => ({ mutateAsync: vi.fn() }), useCompleteReferral: () => ({ mutateAsync: hooks.complete }) }));
vi.mock('@/shared/hooks/useListFilters', () => ({ useListFilters: () => ({ search: '', updateSearch: vi.fn(), hasActiveFilters: false }) }));
function Route() { const location = useLocation(); return <output aria-label="Destination">{location.pathname + location.search}</output>; }
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; vi.clearAllMocks(); }); afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('handoffs an exact inbox response to Chronicle and never opens the old editor or rich cached body', () => {
  render(<MemoryRouter><ReferralInbox /><Route /></MemoryRouter>); expect(screen.queryByText(/Private synthetic/)).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Review response in Chronicle' })); expect(screen.getByLabelText('Destination')).toHaveTextContent(`/patients/${patientId}?action=referral_response&referral_id=${referralId}`); expect(screen.queryByLabelText('Specialist Notes *')).not.toBeInTheDocument(); expect(hooks.complete).not.toHaveBeenCalled();
});
it('opens reviewed consultation selection in exact Chronicle context without starting care or substituting add-note', () => {
  render(<MemoryRouter><ReferralInbox /><Route /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: 'Review consultation in Chronicle' })); expect(screen.getByLabelText('Destination')).toHaveTextContent(`/patients/${patientId}/chronicle?action=consultation&referral_id=${referralId}`); expect(screen.getByLabelText('Destination')).not.toHaveTextContent('action=add_note'); expect(hooks.complete).not.toHaveBeenCalled(); expect(hooks.accept).not.toHaveBeenCalled();
});
it('keeps sent routing/status but opens protected responses only in exact Chronicle context', () => {
  render(<MemoryRouter><ReferralSent /><Route /></MemoryRouter>); expect(screen.queryByText(/Private synthetic/)).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'View Details' })); expect(screen.queryByText(/Private synthetic/)).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Review response in Chronicle' })); expect(screen.getByLabelText('Destination')).toHaveTextContent(`/patients/${patientId}?action=referral_response&referral_id=${referralId}`);
});
it('captures exact referral before transient URL clear and passes no inferred encounter into the lazy workspace', async () => {
  const open = vi.fn(), clear = vi.fn(); renderHook(() => useChronicleRouteState({ id: patientId, search: `?action=referral_response&referral_id=${referralId}&visit=all`, openChronicleWorkspace: open, clearQueryParams: clear })); await waitFor(() => expect(open).toHaveBeenCalledWith('referralResponse', { referralId })); expect(clear).toHaveBeenCalled();
  const { result } = renderHook(() => useChronicleWorkspaceActions({ id: patientId, workspaceOptions: { referralId }, slideOvers: {}, selectedEncounterId: null, activeEncounter: { id: 'unrelated' } })); expect(result.current.workspaceContext.requestedReferralId).toBe(referralId);
  const props = buildChronicleWorkspaceProps('referralResponse', { ...result.current.workspaceContext, patient: { id: patientId } }); expect(props.requestedReferralId).toBe(referralId); expect(props).not.toHaveProperty('encounter'); expect(props).not.toHaveProperty('encounterId'); expect(typeof chronicleWorkspaceLoaders.referralResponse).toBe('function');
});
