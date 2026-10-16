import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { AuthContext } from '@/lib/auth/AuthContext';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NetworkPolicyPage from '../NetworkPolicyPage';
import { networkApi } from '../api';
import { networkKeys } from '../hooks';
import { networkDecision, networkPolicy, networkUser } from './fixtures';
import { networkAccessScope } from '../model';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';

const runtime = window.__HMS_RUNTIME_CONFIG__; let client;
beforeEach(() => { vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); vi.spyOn(networkApi, 'policy').mockResolvedValue({ policy: networkPolicy, current_access: networkDecision, can_update: true }); vi.spyOn(networkApi, 'preview'); vi.spyOn(networkApi, 'save'); });
afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime; client.clear(); });
function tree(user = networkUser) { return <AuthContext.Provider value={{ user, login: vi.fn().mockResolvedValue(user) }}><QueryClientProvider client={client}><MemoryRouter><HelmetProvider><BreadcrumbProvider><NetworkPolicyPage /></BreadcrumbProvider></HelmetProvider></MemoryRouter></QueryClientProvider></AuthContext.Provider>; }
it('never requests policy data or offers operator bootstrap without the right authority', async () => {
  const view = render(tree({ ...networkUser, adminAccess: { capabilities: [] } })); expect(screen.getByText('Network administration access required')).toBeInTheDocument(); expect(networkApi.policy).not.toHaveBeenCalled(); view.rerender(tree()); await screen.findByLabelText('Approved onsite networks');
  networkApi.policy.mockResolvedValue({ policy: { ...networkPolicy, configured: false, version: 0, onsite_cidrs: [], updated_at: null }, current_access: { ...networkDecision, policy_version: null, reason: 'policy_unconfigured', read_only: true }, can_update: false }); fireEvent.click(screen.getByRole('button', { name: 'Refresh policy status' })); await screen.findByText('Network policy needs operator setup');
  // An existing copied draft cannot publish against a newly restricted origin.
  expect(screen.getByLabelText('Approved onsite networks')).toBeDisabled(); expect(networkApi.save).not.toHaveBeenCalled();
});
it('shows operator-only setup on the first unconfigured read', async () => { networkApi.policy.mockResolvedValueOnce({ policy: { ...networkPolicy, configured: false, version: 0, onsite_cidrs: [] }, current_access: { ...networkDecision, policy_version: null, reason: 'policy_unconfigured', read_only: true }, can_update: false }); render(tree()); await screen.findByText('Operator setup required'); expect(screen.queryByLabelText('Approved onsite networks')).not.toBeInTheDocument(); expect(networkApi.preview).not.toHaveBeenCalled(); });
it('unmounts a copied draft immediately after same-profile capability loss', async () => { const view = render(tree()); const input = await screen.findByLabelText('Reason for this policy version'); fireEvent.change(input, { target: { value: 'Synthetic copied draft' } }); const button = screen.getByRole('button', { name: 'Check current connection' }); view.rerender(tree({ ...networkUser, adminAccess: { capabilities: [] } })); expect(screen.getByText('Network administration access required')).toBeInTheDocument(); expect(screen.queryByLabelText('Reason for this policy version')).not.toBeInTheDocument(); fireEvent.click(button); expect(networkApi.preview).not.toHaveBeenCalled(); expect(networkApi.save).not.toHaveBeenCalled(); });
it('does not reuse cached policy until a fresh authoritative mount read succeeds', async () => { client.setQueryData(networkKeys.policy(networkAccessScope(networkUser, getV2ClientScopeKey())), { policy: networkPolicy, current_access: networkDecision, can_update: true }); let finish; networkApi.policy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); render(tree()); await waitFor(() => expect(networkApi.policy).toHaveBeenCalledTimes(1)); expect(screen.queryByLabelText('Approved onsite networks')).not.toBeInTheDocument(); finish({ policy: networkPolicy, current_access: networkDecision, can_update: true }); await screen.findByLabelText('Approved onsite networks'); });
