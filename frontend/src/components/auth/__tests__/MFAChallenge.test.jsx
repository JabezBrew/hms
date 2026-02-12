import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MFAChallenge } from '../MFAChallenge'

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    mfaStatus: vi.fn(),
    mfaTotpStart: vi.fn(),
    mfaTotpConfirm: vi.fn(),
    mfaTotpVerify: vi.fn(),
    mfaRecoveryVerify: vi.fn(),
    mfaWebAuthnRegistrationOptions: vi.fn(),
    mfaWebAuthnRegistrationVerify: vi.fn(),
    mfaWebAuthnAuthOptions: vi.fn(),
    mfaWebAuthnAuthVerify: vi.fn(),
  },
}))

vi.mock('@/lib/notifications', () => ({
  notifications: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { useAuth } from '@/lib/auth'
import { authApi } from '@/shared/api/auth'

const mockUseAuth = vi.mocked(useAuth)
const mockMfaStatus = vi.mocked(authApi.mfaStatus)

function renderMfaChallenge(overrides = {}, statusOverride = {}) {
  mockUseAuth.mockReturnValue({
    mfaSession: 'mfa-session-token',
    mfaEnrollmentRequired: false,
    mfaAvailableMethods: { totp: false, webauthn: false },
    completeMfa: vi.fn(),
    ...overrides,
  })

  mockMfaStatus.mockResolvedValue({
    totp_enrolled: false,
    webauthn_enrolled: false,
    recovery_codes_remaining: 0,
    ...statusOverride,
  })

  return render(<MFAChallenge />)
}

describe('MFAChallenge method visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows only configured authenticator app in verification mode', async () => {
    renderMfaChallenge(
      { mfaEnrollmentRequired: false, mfaAvailableMethods: { totp: true, webauthn: false } },
      { totp_enrolled: true, webauthn_enrolled: false, recovery_codes_remaining: 0 }
    )

    await waitFor(() => {
      expect(mockMfaStatus).toHaveBeenCalled()
    })

    expect(screen.getByText('Authenticator App')).toBeInTheDocument()
    expect(screen.queryByText('Security Key / Passkey')).not.toBeInTheDocument()
    expect(screen.queryByText('Recovery Code')).not.toBeInTheDocument()
  })

  it('shows only configured passkey and recovery code option in verification mode', async () => {
    renderMfaChallenge(
      { mfaEnrollmentRequired: false, mfaAvailableMethods: { totp: false, webauthn: true } },
      { totp_enrolled: false, webauthn_enrolled: true, recovery_codes_remaining: 3 }
    )

    await waitFor(() => {
      expect(mockMfaStatus).toHaveBeenCalled()
    })

    expect(screen.queryByText('Authenticator App')).not.toBeInTheDocument()
    expect(screen.getByText('Security Key / Passkey')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recovery Code' })).toBeInTheDocument()
  })

  it('shows enrollment options on first-time MFA setup flow', async () => {
    renderMfaChallenge(
      { mfaEnrollmentRequired: true, mfaAvailableMethods: { totp: false, webauthn: false } },
      { totp_enrolled: false, webauthn_enrolled: false, recovery_codes_remaining: 0 }
    )

    await waitFor(() => {
      expect(mockMfaStatus).toHaveBeenCalled()
    })

    expect(screen.getByText('Authenticator App')).toBeInTheDocument()
    expect(screen.getByText('Security Key / Passkey')).toBeInTheDocument()
    expect(screen.queryByText('Recovery Code')).not.toBeInTheDocument()
  })
})
