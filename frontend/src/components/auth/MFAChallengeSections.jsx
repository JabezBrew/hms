import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Smartphone from 'lucide-react/dist/esm/icons/smartphone.js';
import Key from 'lucide-react/dist/esm/icons/key.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Check from 'lucide-react/dist/esm/icons/check.js';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function MFAChallengeHeader({ enrollmentRequired }) {
  return (
    <div className="text-center space-y-3">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
        <Shield className="size-7" aria-hidden="true" />
      </div>
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {enrollmentRequired ? 'Secure Your Account' : 'Verify Identity'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {enrollmentRequired
            ? 'Set up multi-factor authentication to protect your account'
            : 'Complete verification to continue'}
        </p>
      </div>
    </div>
  );
}

export function TotpChallengeSection({
  enrollmentRequired,
  state,
  onCopySecret,
  onStart,
  onConfirm,
  onVerify,
  onCodeChange,
}) {
  const { totpSecret, totpCode, totpConfirmed, isBusy, copiedSecret } = state;

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
          totpConfirmed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-sky-500/10 text-sky-600'
        }`}>
          {totpConfirmed ? <CheckCircle2 className="size-5" /> : <Smartphone className="size-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-heading font-medium text-foreground">Authenticator App</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {enrollmentRequired
              ? 'Use Google Authenticator, Authy, or similar app'
              : 'Enter the 6-digit code from your authenticator'}
          </p>
        </div>
        {totpConfirmed && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="size-3" />
            Done
          </span>
        )}
      </div>

      {enrollmentRequired && !totpSecret && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onStart}
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
              onClick={onCopySecret}
              aria-label={copiedSecret ? 'Copied to clipboard' : 'Copy secret key'}
              className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors py-2 px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {copiedSecret ? (
                <>
                  <Check className="size-3" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" aria-hidden="true" />
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
          onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, ''))}
          disabled={isBusy || totpConfirmed}
          className="font-mono text-center text-lg tracking-[0.5em]"
        />
      </div>

      {!totpConfirmed && (
        <Button
          type="button"
          className="w-full bg-amber-600 hover:bg-amber-700 text-white"
          onClick={enrollmentRequired ? onConfirm : onVerify}
          disabled={isBusy || !totpCode || totpCode.length < 6}
        >
          {enrollmentRequired ? 'Confirm & Enable' : 'Verify Code'}
        </Button>
      )}
    </div>
  );
}

export function WebAuthnChallengeSection({
  enrollmentRequired,
  state,
  webauthnAvailable,
  onRegister,
  onVerify,
}) {
  const { webauthnConfirmed, isBusy } = state;

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
          webauthnConfirmed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-violet-500/10 text-violet-600'
        }`}>
          {webauthnConfirmed ? <CheckCircle2 className="size-5" /> : <Key className="size-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-heading font-medium text-foreground">Security Key / Passkey</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Use Face ID, Touch ID, Windows Hello, or a hardware key
          </p>
        </div>
        {webauthnConfirmed && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="size-3" />
            Done
          </span>
        )}
      </div>

      {!webauthnAvailable ? (
        <div className="flex items-center gap-2 rounded-md bg-rose-500/5 border border-rose-500/20 px-3 py-2 text-xs text-rose-600">
          <AlertCircle className="size-4 shrink-0" />
          <span>WebAuthn is not supported on this device or browser</span>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={enrollmentRequired ? onRegister : onVerify}
          disabled={isBusy || webauthnConfirmed}
        >
          {enrollmentRequired ? 'Register Security Key' : 'Verify with Security Key'}
        </Button>
      )}
    </div>
  );
}

export function RecoveryCodeSection({ state, codesRemaining, onCodeChange, onVerify }) {
  const { recoveryCode, isBusy } = state;

  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Key className="size-5" />
        </div>
        <div>
          <h3 className="font-heading font-medium text-foreground">Recovery Code</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Use a backup code if you lost access to other methods ({codesRemaining} remaining)
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="recovery-code" className="sr-only">Recovery Code</Label>
        <Input
          id="recovery-code"
          placeholder="Enter recovery code"
          value={recoveryCode}
          onChange={(event) => onCodeChange(event.target.value)}
          disabled={isBusy}
          className="font-mono"
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={onVerify}
        disabled={isBusy || !recoveryCode}
      >
        Use Recovery Code
      </Button>
    </div>
  );
}

export function NoConfiguredMethodsNotice() {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-700">
      No configured MFA verification methods were found for this account.
      Please contact support or complete enrollment first.
    </div>
  );
}
