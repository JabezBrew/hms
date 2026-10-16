import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsHubPage from './SettingsHubPage';

const state = vi.hoisted(() => ({ user: { role: 'doctor' }, features: { clinical_notes: true }, navigate: vi.fn() }));
const runtime = window.__HMS_RUNTIME_CONFIG__;
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/useSystemQueries', () => ({ useSystemCapabilities: () => ({ data: { features: state.features } }) }));
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }));

describe('Settings workflow links', () => {
  afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime; });
  beforeEach(() => {
    state.user = { role: 'doctor' };
    state.features = { clinical_notes: true };
    state.navigate.mockClear();
  });

  it('opens the supported clinical template manager instead of a placeholder', () => {
    render(<SettingsHubPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Clinical Templates:/ }));
    expect(state.navigate).toHaveBeenCalledWith('/clinical-notes/templates');
    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
  });

  it('hides clinical templates when the facility feature is unavailable', () => {
    state.features = {};
    render(<SettingsHubPage />);
    expect(screen.queryByRole('button', { name: /^Clinical Templates:/ })).not.toBeInTheDocument();
  });

  it('matches the destination route role restrictions', () => {
    state.user = { role: 'pharmacist' };
    render(<SettingsHubPage />);
    expect(screen.queryByRole('button', { name: /^Clinical Templates:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Preferences:/ })).toBeVisible();
  });
  it('opens network access only for the real Rust capability', () => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; state.user = { role: 'admin', adminAccess: { capabilities: ['admin.authority.manage'] } }; render(<SettingsHubPage />); fireEvent.click(screen.getByRole('button', { name: /^Network Access:/ })); expect(state.navigate).toHaveBeenCalledWith('/settings/network-access'); });
  it('does not advertise network configuration from an admin role alone', () => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; state.user = { role: 'admin' }; render(<SettingsHubPage />); expect(screen.queryByRole('button', { name: /^Network Access:/ })).not.toBeInTheDocument(); });
});
