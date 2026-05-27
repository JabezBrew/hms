import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { authApi } from '@/shared/api/auth'
import { notifications } from '@/lib/notifications'
import { toRegistrationOptions, toAuthenticationOptions, serializeCredential } from '@/lib/webauthn'
import { useAuth } from '@/lib/auth'
import {
  MFAChallengeHeader,
  NoConfiguredMethodsNotice,
  RecoveryCodeSection,
  TotpChallengeSection,
  WebAuthnChallengeSection,
} from './MFAChallengeSections'

const initialMfaChallengeState = {
  sessionOverride: null,
  totpSecret: null,
  totpCode: '',
  recoveryCode: '',
  totpConfirmed: false,
  webauthnConfirmed: false,
  isBusy: false,
  copiedSecret: false,
  challengeStatus: null,
}

function mfaChallengeReducer(state, action) {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch }
    default:
      return state
  }
}

export function MFAChallenge() {
  const {
    mfaSession,
    mfaEnrollmentRequired,
    mfaAvailableMethods,
    completeMfa,
  } = useAuth()
  const [state, dispatch] = useReducer(mfaChallengeReducer, initialMfaChallengeState)
  const {
    sessionOverride,
    totpSecret,
    totpCode,
    recoveryCode,
    totpConfirmed,
    webauthnConfirmed,
    isBusy,
    copiedSecret,
    challengeStatus,
  } = state

  const updateState = useCallback((patch) => dispatch({ type: 'patch', patch }), [])

  const activeSession = sessionOverride?.source === mfaSession
    ? sessionOverride.value
    : mfaSession

  useEffect(() => {
    let isCancelled = false

    const loadStatus = async () => {
      if (!activeSession) {
        updateState({ challengeStatus: null })
        return
      }

      try {
        const status = await authApi.mfaStatus(activeSession)
        if (!isCancelled) {
          updateState({ challengeStatus: status })
        }
      } catch {
        if (!isCancelled) {
          updateState({ challengeStatus: null })
        }
      }
    }

    loadStatus()

    return () => {
      isCancelled = true
    }
  }, [activeSession, updateState])

  const webauthnAvailable = useMemo(() => {
    return Boolean(window.PublicKeyCredential && navigator.credentials)
  }, [])

  const hasConfiguredTotp = Boolean(challengeStatus?.totp_enrolled ?? mfaAvailableMethods?.totp)
  const hasConfiguredWebauthn = Boolean(challengeStatus?.webauthn_enrolled ?? mfaAvailableMethods?.webauthn)
  const recoveryCodesRemaining = Number(challengeStatus?.recovery_codes_remaining ?? 0)

  const shouldShowTotp = mfaEnrollmentRequired ? true : hasConfiguredTotp
  const shouldShowWebauthn = mfaEnrollmentRequired ? true : hasConfiguredWebauthn
  const shouldShowRecovery = !mfaEnrollmentRequired && recoveryCodesRemaining > 0
  const noConfiguredMethods = !mfaEnrollmentRequired && !shouldShowTotp && !shouldShowWebauthn

  const handleCopySecret = async () => {
    if (totpSecret) {
      await navigator.clipboard.writeText(totpSecret)
      updateState({ copiedSecret: true })
      setTimeout(() => updateState({ copiedSecret: false }), 2000)
    }
  }

  const handleAuthComplete = (response, fallbackMessage) => {
    if (response?.access) {
      completeMfa(response)
      notifications.success('MFA verified')
      return true
    }
    if (fallbackMessage) {
      notifications.success(fallbackMessage)
    }
    return false
  }

  const handleTotpStart = async () => {
    updateState({ isBusy: true })
    try {
      const response = await authApi.mfaTotpStart(activeSession)
      updateState({ totpSecret: response.secret })
    } catch (error) {
      notifications.error(error.message || 'Failed to start TOTP')
    } finally {
      updateState({ isBusy: false })
    }
  }

  const handleTotpConfirm = async () => {
    updateState({ isBusy: true })
    try {
      const response = await authApi.mfaTotpConfirm(totpCode, activeSession)
      if (!handleAuthComplete(response)) {
        updateState({ totpConfirmed: true })
        notifications.success('TOTP confirmed')
      }
    } catch (error) {
      notifications.error(error.message || 'Failed to confirm TOTP')
    } finally {
      updateState({ isBusy: false })
    }
  }

  const handleTotpVerify = async () => {
    updateState({ isBusy: true })
    try {
      const response = await authApi.mfaTotpVerify(totpCode, activeSession)
      if (!handleAuthComplete(response)) {
        updateState({ totpConfirmed: true })
        notifications.success('TOTP verified')
      }
    } catch (error) {
      notifications.error(error.message || 'Failed to verify TOTP')
    } finally {
      updateState({ isBusy: false })
    }
  }

  const handleRecoveryVerify = async () => {
    updateState({ isBusy: true })
    try {
      const response = await authApi.mfaRecoveryVerify(recoveryCode, activeSession)
      handleAuthComplete(response)
    } catch (error) {
      notifications.error(error.message || 'Failed to verify recovery code')
    } finally {
      updateState({ isBusy: false })
    }
  }

  const handleWebAuthnRegister = async () => {
    if (!webauthnAvailable) {
      notifications.error('WebAuthn is not supported on this device')
      return
    }
    updateState({ isBusy: true })
    try {
      const options = await authApi.mfaWebAuthnRegistrationOptions(activeSession)
      if (options.mfa_session) {
        updateState({ sessionOverride: { source: mfaSession, value: options.mfa_session } })
      }
      const publicKey = toRegistrationOptions(options)
      const credential = await navigator.credentials.create({ publicKey })
      const payload = serializeCredential(credential)
      const response = await authApi.mfaWebAuthnRegistrationVerify(payload, options.mfa_session || activeSession)
      if (!handleAuthComplete(response)) {
        updateState({ webauthnConfirmed: true })
        notifications.success('WebAuthn registered')
      }
    } catch (error) {
      notifications.error(error.message || 'Failed to register WebAuthn')
    } finally {
      updateState({ isBusy: false })
    }
  }

  const handleWebAuthnVerify = async () => {
    if (!webauthnAvailable) {
      notifications.error('WebAuthn is not supported on this device')
      return
    }
    updateState({ isBusy: true })
    try {
      const options = await authApi.mfaWebAuthnAuthOptions(activeSession)
      const publicKey = toAuthenticationOptions(options)
      const credential = await navigator.credentials.get({ publicKey })
      const payload = serializeCredential(credential)
      const response = await authApi.mfaWebAuthnAuthVerify(payload, activeSession)
      if (!handleAuthComplete(response)) {
        updateState({ webauthnConfirmed: true })
        notifications.success('WebAuthn verified')
      }
    } catch (error) {
      notifications.error(error.message || 'Failed to verify WebAuthn')
    } finally {
      updateState({ isBusy: false })
    }
  }

  return (
    <div className="mx-auto flex w-full flex-col gap-8 sm:w-[420px]">
      <MFAChallengeHeader enrollmentRequired={mfaEnrollmentRequired} />

      {shouldShowTotp && (
        <TotpChallengeSection
          enrollmentRequired={mfaEnrollmentRequired}
          state={{ totpSecret, totpCode, totpConfirmed, isBusy, copiedSecret }}
          onCopySecret={handleCopySecret}
          onStart={handleTotpStart}
          onConfirm={handleTotpConfirm}
          onVerify={handleTotpVerify}
          onCodeChange={(code) => updateState({ totpCode: code })}
        />
      )}

      {shouldShowWebauthn && (
        <WebAuthnChallengeSection
          enrollmentRequired={mfaEnrollmentRequired}
          state={{ webauthnConfirmed, isBusy }}
          webauthnAvailable={webauthnAvailable}
          onRegister={handleWebAuthnRegister}
          onVerify={handleWebAuthnVerify}
        />
      )}

      {shouldShowRecovery && (
        <RecoveryCodeSection
          state={{ recoveryCode, isBusy }}
          codesRemaining={recoveryCodesRemaining}
          onCodeChange={(code) => updateState({ recoveryCode: code })}
          onVerify={handleRecoveryVerify}
        />
      )}

      {noConfiguredMethods && <NoConfiguredMethodsNotice />}
    </div>
  )
}
