import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MFAStatus from '../MFAStatus';
import { useMfaStatus } from '@/features/settings/hooks';
import { authApi } from '@/shared/api/auth';

vi.mock('@/features/settings/hooks', () => ({
  useMfaStatus: vi.fn(),
  useMfaTotpStart: vi.fn(),
  useMfaTotpConfirm: vi.fn(),
}));
vi.mock('@/lib/api/v2/runtime', () => ({ isRustV2ApiMode: () => true }));
vi.mock('@/shared/api/auth', () => ({
  authApi: {
    mfaWebAuthnRegistrationOptions: vi.fn(),
    mfaWebAuthnRegistrationVerify: vi.fn(),
    mfaWebAuthnAuthOptions: vi.fn(),
    mfaWebAuthnAuthVerify: vi.fn(),
    mfaRecoveryGenerate: vi.fn(),
  },
}));

const registrationOptions = {
  challenge: 'AQID',
  mfa_session: 'registration-challenge',
  rp: { id: 'localhost', name: 'HMS' },
  user: { id: 'BAUG', name: 'synthetic@example.com', displayName: 'Synthetic user' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
};

function credential() {
  return {
    id: 'credential-id',
    type: 'public-key',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: {
      clientDataJSON: new Uint8Array([4, 5, 6]).buffer,
      attestationObject: new Uint8Array([7, 8, 9]).buffer,
      getTransports: () => ['internal'],
    },
    getClientExtensionResults: () => ({}),
  };
}

const originalCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let createCredential;
let getCredential;
let copy;
let refetch;

function renderSettings(status = {}, query = {}) {
  useMfaStatus.mockReturnValue({
    data: { totp_enrolled: false, webauthn_enrolled: false, recovery_codes_remaining: 0, passkey_required: true, ...status },
    isLoading: false,
    isError: false,
    refetch,
    ...query,
  });
  return render(<MFAStatus />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
  vi.stubGlobal('isSecureContext', true);
  createCredential = vi.fn().mockResolvedValue(credential());
  getCredential = vi.fn().mockResolvedValue(credential());
  copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: createCredential, get: getCredential } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  refetch = vi.fn().mockResolvedValue({ data: {} });
  authApi.mfaWebAuthnRegistrationOptions.mockResolvedValue(registrationOptions);
  authApi.mfaWebAuthnRegistrationVerify.mockResolvedValue({ verified: true });
  authApi.mfaWebAuthnAuthOptions.mockResolvedValue({ challenge: 'AQID', challenge_id: 'authentication-challenge', allowCredentials: [{ id: 'BAUG', type: 'public-key' }] });
  authApi.mfaWebAuthnAuthVerify.mockResolvedValue({ verified: true });
  authApi.mfaRecoveryGenerate.mockResolvedValue({ codes: ['SYNTHETIC-CODE-ONE', 'SYNTHETIC-CODE-TWO'] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalCredentials) Object.defineProperty(navigator, 'credentials', originalCredentials);
  else delete navigator.credentials;
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete navigator.clipboard;
});

describe('Rust account security settings', () => {
  it('shows actual enrollment policy without claiming a second-factor sign-in session', () => {
    renderSettings();
    expect(screen.getByText('Passkey enrollment required')).toBeInTheDocument();
    expect(screen.getByText(/does not verify this sign-in session/)).toBeInTheDocument();
    expect(screen.queryByText('MFA Enabled')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set Up App/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Code-based account recovery is not available/)).toBeInTheDocument();
  });

  it('registers a browser credential with the server challenge and refreshes status', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Set up passkey' }));
    await screen.findByText('Passkey registered.');
    expect(createCredential).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({ challenge: expect.any(ArrayBuffer), user: expect.objectContaining({ id: expect.any(ArrayBuffer) }) }),
      signal: expect.any(AbortSignal),
    });
    expect(authApi.mfaWebAuthnRegistrationVerify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'credential-id', type: 'public-key', rawId: 'AQID', response: expect.objectContaining({ clientDataJSON: 'BAUG', attestationObject: 'BwgJ', transports: ['internal'] }) }),
      'registration-challenge',
      { signal: expect.any(AbortSignal) },
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('tests an enrolled passkey without claiming to refresh authentication', async () => {
    renderSettings({ webauthn_enrolled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Test passkey' }));
    await screen.findByText('Passkey verified. Your sign-in session has not changed.');
    expect(getCredential).toHaveBeenCalledWith({ publicKey: expect.objectContaining({ challenge: expect.any(ArrayBuffer), allowCredentials: [expect.objectContaining({ id: expect.any(ArrayBuffer) })] }), signal: expect.any(AbortSignal) });
    expect(authApi.mfaWebAuthnAuthVerify).toHaveBeenCalledWith(expect.objectContaining({ id: 'credential-id' }), 'authentication-challenge', { signal: expect.any(AbortSignal) });
  });

  it.each(['null', 'not-allowed'])('handles %s browser cancellation without verifying or reporting success', async (mode) => {
    if (mode === 'null') createCredential.mockResolvedValueOnce(null);
    else createCredential.mockRejectedValueOnce(new DOMException('Cancelled', 'NotAllowedError'));
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Set up passkey' }));
    await screen.findByText(/Passkey request cancelled/);
    expect(authApi.mfaWebAuthnRegistrationVerify).not.toHaveBeenCalled();
    expect(screen.queryByText('Passkey registered.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up passkey' })).toBeEnabled();
  });

  it('reports denied verification and does not fabricate enrollment', async () => {
    authApi.mfaWebAuthnRegistrationVerify.mockRejectedValueOnce(new Error('Passkey registration is not permitted.'));
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Set up passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passkey registration is not permitted.');
    expect(screen.getByText('Not enrolled')).toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('requires confirmed server verification before reporting success', async () => {
    authApi.mfaWebAuthnRegistrationVerify.mockResolvedValueOnce({ verified: false });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Set up passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passkey verification was not confirmed.');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('prevents duplicate ceremonies and cancels pending work when leaving settings', async () => {
    authApi.mfaWebAuthnRegistrationOptions.mockImplementationOnce(() => new Promise(() => {}));
    const view = renderSettings();
    const button = screen.getByRole('button', { name: 'Set up passkey' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(authApi.mfaWebAuthnRegistrationOptions).toHaveBeenCalledTimes(1);
    const signal = authApi.mfaWebAuthnRegistrationOptions.mock.calls[0][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('keeps registration disabled on an unsupported device', () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    renderSettings();
    expect(screen.getByRole('button', { name: 'Set up passkey' })).toBeDisabled();
    expect(screen.getByText(/Use a browser and secure site address/)).toBeInTheDocument();
  });

  it('generates codes using the current password, clears it, and supports copy/hide/clear', async () => {
    renderSettings({ webauthn_enrolled: true });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Synthetic password ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery codes' }));
    await screen.findByRole('list', { name: 'New recovery codes' });
    expect(authApi.mfaRecoveryGenerate).toHaveBeenCalledWith({ currentPassword: 'Synthetic password ', signal: expect.any(AbortSignal) });
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''));
    fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(copy).toHaveBeenCalledWith('SYNTHETIC-CODE-ONE\nSYNTHETIC-CODE-TWO');
    fireEvent.click(screen.getByRole('button', { name: 'Hide codes' }));
    expect(screen.queryByRole('list', { name: 'New recovery codes' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show codes' }));
    expect(screen.getByRole('list', { name: 'New recovery codes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('SYNTHETIC-CODE-ONE')).not.toBeInTheDocument();
  });

  it('requires confirmation before replacing unused codes and honors cancel', async () => {
    renderSettings({ webauthn_enrolled: true, recovery_codes_remaining: 2 });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Synthetic password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace recovery codes' }));
    expect(await screen.findByRole('dialog', { name: 'Replace recovery codes?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(authApi.mfaRecoveryGenerate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace recovery codes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Replace codes' }));
    await screen.findByRole('list', { name: 'New recovery codes' });
    expect(authApi.mfaRecoveryGenerate).toHaveBeenCalledTimes(1);
  });

  it('clears a denied recovery password and never reports generated codes', async () => {
    authApi.mfaRecoveryGenerate.mockRejectedValueOnce(Object.assign(new Error('Current password is required to regenerate recovery codes.'), { status: 403 }));
    renderSettings({ webauthn_enrolled: true });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'incorrect' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery codes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is required');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'New recovery codes' })).not.toBeInTheDocument();
  });

  it('keeps returned one-time codes accessible when status refresh fails and gates further mutations', async () => {
    refetch.mockResolvedValueOnce({ isError: true, error: new Error('Unavailable') });
    const view = renderSettings({ webauthn_enrolled: true });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Synthetic password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery codes' }));
    await screen.findByText('Security status needs refreshing');
    useMfaStatus.mockReturnValue({ data: { webauthn_enrolled: true, recovery_codes_remaining: 0 }, isLoading: false, isError: true, refetch });
    view.rerender(<MFAStatus />);
    expect(screen.getByRole('list', { name: 'New recovery codes' })).toHaveTextContent('SYNTHETIC-CODE-ONE');
    expect(screen.getByLabelText('Current password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add passkey' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(authApi.mfaRecoveryGenerate).toHaveBeenCalledTimes(1);
  });

  it.each(['lost response', 'missing codes'])('requires a status refresh after an unconfirmed recovery replacement: %s', async (mode) => {
    if (mode === 'lost response') authApi.mfaRecoveryGenerate.mockRejectedValueOnce(new Error('Network unavailable'));
    else authApi.mfaRecoveryGenerate.mockResolvedValueOnce({ codes: [] });
    renderSettings({ webauthn_enrolled: true });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Synthetic password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery codes' }));
    await screen.findByText(/Existing codes may already be invalid/);
    expect(screen.getByRole('button', { name: 'Generate recovery codes' })).toBeDisabled();
    expect(screen.queryByRole('list', { name: 'New recovery codes' })).not.toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
    expect(authApi.mfaRecoveryGenerate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh security status' }));
    await waitFor(() => expect(screen.getByLabelText('Current password')).toBeEnabled());
    expect(authApi.mfaRecoveryGenerate).toHaveBeenCalledTimes(1);
  });

  it('offers a retry after a status error without claiming no key exists', async () => {
    renderSettings({}, { isError: true, data: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('No passkey enrolled')).not.toBeInTheDocument();
  });
});
