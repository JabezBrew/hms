import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Smartphone from 'lucide-react/dist/esm/icons/smartphone.js';
import Key from 'lucide-react/dist/esm/icons/key.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import { useEffect, useMemo, useState } from 'react'
import { authApi } from '@/shared/api/auth'
import { notifications } from '@/lib/notifications'
import { toRegistrationOptions, toAuthenticationOptions, serializeCredential } from '@/lib/webauthn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'

export function MFAChallenge() {
  const {
    mfaSession,
    mfaEnrollmentRequired,
    mfaAvailableMethods,
    completeMfa,
  } = useAuth()
  const [activeSession, setActiveSession] = useState(mfaSession)
  const [totpSecret, setTotpSecret] = useState(null)
  const [totpCode, setTotpCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [totpConfirmed, setTotpConfirmed] = useState(false)
  const [webauthnConfirmed, setWebauthnConfirmed] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [copiedSecret, setCopiedSecret] = useState(false)

  useEffect(() => {
    setActiveSession(mfaSession)
  }, [mfaSession])

  const webauthnAvailable = useMemo(() => {
    return Boolean(window.PublicKeyCredential && navigator.credentials)
  }, [])

  const hasConfiguredTotp = Boolean(mfaAvailableMethods?.totp)
  const hasConfiguredWebauthn = Boolean(mfaAvailableMethods?.webauthn)
  const shouldShowTotp = mfaEnrollmentRequired || hasConfiguredTotp
  const shouldShowWebauthn = mfaEnrollmentRequired || hasConfiguredWebauthn
  const shouldShowRecovery = !mfaEnrollmentRequired && (hasConfiguredTotp || hasConfiguredWebauthn)

  const handleCopySecret = async () => {
    if (totpSecret) {
      await navigator.clipboard.writeText(totpSecret)
      setCopiedSecret(true)
      setTimeout(() => setCopiedSecret(false), 2000)
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
    setIsBusy(true)
    try {
      const response = await authApi.mfaTotpStart(activeSession)
      setTotpSecret(response.secret)
    } catch (error) {
      notifications.error(error.message || 'Failed to start TOTP')
    } finally {
      setIsBusy(false)
    }
  }

  const handleTotpConfirm = async () => {
    setIsBusy(true)
    try {
      const response = await authApi.mfaTotpConfirm(totpCode, activeSession)
      if (!handleAuthComplete(response)) {
        setTotpConfirmed(true)
        notifications.success('TOTP confirmed')
      }
    } catch (error) {
      notifications.error(error.message || 'Failed to confirm TOTP')
    } finally {
      setIsBusy(false)
    }
  }

  const handleTotpVerify = async () => {
    setIsBusy(true)
    try {
      const response = await authApi.mfaTotpVerify(totpCode, activeSession)
      if (!handleAuthComplete(response)) {
        setTotpConfirmed(true)
        notifications.success('TOTP verified')
      }
    } catch (error) {
      notifications.error(error.message || 'Failed to verify TOTP')
    } finally {
      setIsBusy(false)
    }
  }

  const handleRecoveryVerify = async () => {
    setIsBusy(true)
    try {
      const response = await authApi.mfaRecoveryVerify(recoveryCode, activeSession)
      handleAuthComplete(response)
    } catch (error) {
      notifications.error(error.message || 'Failed to verify recovery code')
    } finally {
      setIsBusy(false)
    }
  }

  const handleWebAuthnRegister = async () => {
    if (!webauthnAvailable) {
      notifications.error('WebAuthn is not supported on this device')
      return
    }
    setIsBusy(true)
    try {
      const options = await authApi.mfaWebAuthnRegistrationOptions(activeSession)
      if (options.mfa_session) {
        setActiveSession(options.mfa_session)
      }
      const publicKey = toRegistrationOptions(options)
      const credential = await navigator.credentials.create({ publicKey })
      const payload = serializeCredential(credential)
      const response = await authApi.mfaWebAuthnRegistrationVerify(payload, options.mfa_session || activeSession)
      if (!handleAuthComplete(response)) {
        setWebauthnConfirmed(true)
        notifications.success('WebAuthn registered')
      }
    } catch (error) {
      notifications.error(error.message || 'Failed to register WebAuthn')
    } finally {
      setIsBusy(false)
    }
  }

  const handleWebAuthnVerify = async () => {
    if (!webauthnAvailable) {
      notifications.error('WebAuthn is not supported on this device')
      return
    }
    setIsBusy(true)
    try {
      const options = await authApi.mfaWebAuthnAuthOptions(activeSession)
      const publicKey = toAuthenticationOptions(options)
      const credential = await navigator.credentials.get({ publicKey })
      const payload = serializeCredential(credential)
      const response = await authApi.mfaWebAuthnAuthVerify(payload, activeSession)
      if (!handleAuthComplete(response)) {
        setWebauthnConfirmed(true)
        notifications.success('WebAuthn verified')
      }
    } catch (error) {
      notifications.error(error.message || 'Failed to verify WebAuthn')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full flex-col gap-8 sm:w-[420px]">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <Shield className="h-7 w-7" aria-hidden="true" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {mfaEnrollmentRequired ? 'Secure Your Account' : 'Verify Identity'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mfaEnrollmentRequired
              ? 'Set up multi-factor authentication to protect your account'
              : 'Complete verification to continue'}
          </p>
        </div>
      </div>

      {/* TOTP Section */}
      {shouldShowTotp && (
        <div className="rounded-lg border border-border/60 bg-card/50 p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              totpConfirmed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-sky-500/10 text-sky-600'
            }`}>
              {totpConfirmed ? <CheckCircle2 className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-heading font-medium text-foreground">Authenticator App</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {mfaEnrollmentRequired
                  ? 'Use Google Authenticator, Authy, or similar app'
                  : 'Enter the 6-digit code from your authenticator'}
              </p>
            </div>
            {totpConfirmed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                Done
              </span>
            )}
          </div>

          {mfaEnrollmentRequired && !totpSecret && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleTotpStart}
              disabled={isBusy}
            >
              Generate Secret Key
            </Button>
          )}

          {totpSecret && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-amber-700">
                  Secret Key
                </span>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  aria-label={copiedSecret ? "Copied to clipboard" : "Copy secret key"}
                  className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors py-2 px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {copiedSecret ? (
                    <>
                      <Check className="h-3 w-3" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <div className="font-mono text-sm break-all text-foreground select-all">
                {totpSecret}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="totp-code" className="text-sm font-medium">
              Verification Code
            </Label>
            <Input
              id="totp-code"
              inputMode="numeric"
              placeholder="000000"
              maxLength={6}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))}
              disabled={isBusy || totpConfirmed}
              className="font-mono text-center text-lg tracking-[0.5em]"
            />
          </div>

          {!totpConfirmed && (
            <Button
              type="button"
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              onClick={mfaEnrollmentRequired ? handleTotpConfirm : handleTotpVerify}
              disabled={isBusy || !totpCode || totpCode.length < 6}
            >
              {mfaEnrollmentRequired ? 'Confirm & Enable' : 'Verify Code'}
            </Button>
          )}
        </div>
      )}

      {/* WebAuthn Section */}
      {shouldShowWebauthn && (
        <div className="rounded-lg border border-border/60 bg-card/50 p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              webauthnConfirmed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-violet-500/10 text-violet-600'
            }`}>
              {webauthnConfirmed ? <CheckCircle2 className="h-5 w-5" /> : <Key className="h-5 w-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-heading font-medium text-foreground">Security Key / Passkey</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use Face ID, Touch ID, Windows Hello, or a hardware key
              </p>
            </div>
            {webauthnConfirmed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                Done
              </span>
            )}
          </div>

          {!webauthnAvailable ? (
            <div className="flex items-center gap-2 rounded-md bg-rose-500/5 border border-rose-500/20 px-3 py-2 text-xs text-rose-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>WebAuthn is not supported on this device or browser</span>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={mfaEnrollmentRequired ? handleWebAuthnRegister : handleWebAuthnVerify}
              disabled={isBusy || webauthnConfirmed}
            >
              {mfaEnrollmentRequired ? 'Register Security Key' : 'Verify with Security Key'}
            </Button>
          )}
        </div>
      )}

      {/* Recovery Code Section (verify mode only) */}
      {shouldShowRecovery && (
        <div className="rounded-lg border border-border/40 bg-muted/30 p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-heading font-medium text-foreground">Recovery Code</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use a backup code if you lost access to other methods
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="recovery-code" className="sr-only">Recovery Code</Label>
            <Input
              id="recovery-code"
              placeholder="Enter recovery code"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              disabled={isBusy}
              className="font-mono"
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={handleRecoveryVerify}
            disabled={isBusy || !recoveryCode}
          >
            Use Recovery Code
          </Button>
        </div>
      )}
    </div>
  )
}
