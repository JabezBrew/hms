import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js';
import ShieldOff from 'lucide-react/dist/esm/icons/shield-off.js';
import Smartphone from 'lucide-react/dist/esm/icons/smartphone.js';
import Key from 'lucide-react/dist/esm/icons/key.js';
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import { useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  useMfaStatus,
  useMfaTotpStart,
  useMfaTotpConfirm,
  useMfaRecoveryGenerate,
} from '@/features/settings/hooks';
import { authApi } from '@/shared/api/auth';
import { useAuth } from '@/lib/auth';
import { notifications } from '@/lib/notifications';
import { toRegistrationOptions, serializeCredential } from '@/lib/webauthn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * MFAStatus - Shows MFA status and enrollment controls within Settings > Security.
 */
export default function MFAStatus() {
  const { completeMfa } = useAuth();
  const { data: mfaStatus, isLoading, isError, refetch } = useMfaStatus();
  const totpStart = useMfaTotpStart();
  const totpConfirm = useMfaTotpConfirm();
  const recoveryGenerate = useMfaRecoveryGenerate();

  const [totpSecret, setTotpSecret] = useState(null);
  const [totpOtpAuthUrl, setTotpOtpAuthUrl] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);

  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(true);
  const [copiedRecoveryCodes, setCopiedRecoveryCodes] = useState(false);

  const [isWebAuthnBusy, setIsWebAuthnBusy] = useState(false);

  const webauthnAvailable = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.PublicKeyCredential && navigator.credentials);
  }, []);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError) {
    return (
      <div className="text-center py-6 bg-muted/30 border border-border rounded-xl">
        <p className="text-muted-foreground mb-3 text-sm">Failed to load MFA status</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="font-mono text-xs">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (mfaStatus?.rust_v2_unsupported) {
    return (
      <div className="flex items-start gap-4 p-4 rounded-xl border border-border bg-muted/30">
        <div className="p-2.5 rounded-lg shrink-0 bg-muted border border-border">
          <ShieldOff className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-display text-sm font-medium text-foreground">
            MFA Management Unavailable
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            This Rust V2 build has not exposed account MFA management yet.
          </p>
        </div>
      </div>
    );
  }

  const hasTotp = Boolean(mfaStatus?.totp_enrolled);
  const hasWebAuthn = Boolean(mfaStatus?.webauthn_enrolled);
  const hasMfa = hasTotp || hasWebAuthn;
  const recoveryCodesRemaining = mfaStatus?.recovery_codes_remaining || 0;
  const isBusy = totpStart.isPending || totpConfirm.isPending || recoveryGenerate.isPending || isWebAuthnBusy;

  const handleCopySecret = async () => {
    if (!totpSecret) return;
    try {
      await navigator.clipboard.writeText(totpSecret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
      notifications.success('Secret copied');
    } catch {
      notifications.error('Failed to copy secret');
    }
  };

  const handleTotpStart = async () => {
    if (hasTotp) {
      const confirmed = window.confirm(
        'Starting a new authenticator setup will require confirming a new code before use. Continue?'
      );
      if (!confirmed) return;
    }

    try {
      const response = await totpStart.mutateAsync();
      setTotpSecret(response?.secret || null);
      setTotpOtpAuthUrl(response?.otpauth_url || null);
      setTotpCode('');
      notifications.success('Authenticator setup started');
    } catch (error) {
      notifications.error(error.message || 'Failed to start authenticator setup');
    }
  };

  const handleTotpConfirm = async () => {
    if (!totpCode || totpCode.length < 6) return;

    try {
      const response = await totpConfirm.mutateAsync(totpCode);
      if (response?.access) {
        completeMfa(response);
      }
      setTotpSecret(null);
      setTotpOtpAuthUrl(null);
      setTotpCode('');
      notifications.success('Authenticator app configured');
    } catch (error) {
      notifications.error(error.message || 'Failed to confirm authenticator setup');
    }
  };

  const handleWebAuthnRegister = async () => {
    if (!webauthnAvailable) {
      notifications.error('Passkeys are not supported on this device');
      return;
    }

    setIsWebAuthnBusy(true);
    try {
      const options = await authApi.mfaWebAuthnRegistrationOptions();
      const sessionToken = options?.mfa_session || null;
      const publicKey = toRegistrationOptions(options);
      const credential = await navigator.credentials.create({ publicKey });

      if (!credential) {
        throw new Error('Passkey registration was cancelled.');
      }

      const payload = serializeCredential(credential);
      const response = await authApi.mfaWebAuthnRegistrationVerify(payload, sessionToken);
      if (response?.access) {
        completeMfa(response);
      }

      await refetch();
      notifications.success(hasWebAuthn ? 'New passkey added' : 'Passkey configured');
    } catch (error) {
      notifications.error(error.message || 'Failed to register passkey');
    } finally {
      setIsWebAuthnBusy(false);
    }
  };

  const handleRecoveryGenerate = async () => {
    if (!hasMfa) {
      notifications.error('Configure an MFA method first');
      return;
    }

    if (recoveryCodesRemaining > 0) {
      const confirmed = window.confirm(
        'Generating new recovery codes will replace your existing ones. Continue?'
      );
      if (!confirmed) return;
    }

    try {
      const response = await recoveryGenerate.mutateAsync();
      const codes = Array.isArray(response?.codes) ? response.codes : [];
      setRecoveryCodes(codes);
      setShowRecoveryCodes(true);
      notifications.success('Recovery codes generated');
    } catch (error) {
      notifications.error(error.message || 'Failed to generate recovery codes');
    }
  };

  const handleCopyRecoveryCodes = async () => {
    if (!recoveryCodes.length) return;

    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopiedRecoveryCodes(true);
      setTimeout(() => setCopiedRecoveryCodes(false), 2000);
      notifications.success('Recovery codes copied');
    } catch {
      notifications.error('Failed to copy recovery codes');
    }
  };

  return (
    <div className="space-y-5">
      <div className={cn(
        'flex items-start gap-4 p-4 rounded-xl border',
        hasMfa
          ? 'bg-emerald-500/5 border-emerald-500/20'
          : 'bg-amber-500/5 border-amber-500/20'
      )}>
        <div className={cn(
          'p-2.5 rounded-lg shrink-0',
          hasMfa
            ? 'bg-emerald-500/10 border border-emerald-500/20'
            : 'bg-amber-500/10 border border-amber-500/20'
        )}>
          {hasMfa ? (
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
          ) : (
            <ShieldOff className="h-5 w-5 text-amber-400" />
          )}
        </div>
        <div>
          <p className={cn(
            'font-display text-sm font-medium',
            hasMfa ? 'text-emerald-400' : 'text-amber-400'
          )}>
            {hasMfa ? 'MFA Enabled' : 'MFA Not Configured'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasMfa
              ? 'Manage and rotate your authenticator and passkey methods here.'
              : 'Configure at least one MFA method to secure your account.'}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <MethodRow
          icon={Smartphone}
          title="Authenticator App (TOTP)"
          active={hasTotp}
          description={hasTotp ? 'Configured and active' : 'Not configured'}
          action={(
            <Button
              type="button"
              variant={hasTotp ? 'outline' : 'default'}
              size="sm"
              className="font-mono text-xs"
              onClick={handleTotpStart}
              disabled={isBusy}
            >
              {totpSecret ? 'Restart Setup' : hasTotp ? 'Set Up New App' : 'Set Up App'}
            </Button>
          )}
        />

        {totpSecret && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Secret Key
                </p>
                <p className="text-sm font-mono break-all mt-1 text-foreground">{totpSecret}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-mono text-xs"
                onClick={handleCopySecret}
              >
                {copiedSecret ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                {copiedSecret ? 'Copied' : 'Copy'}
              </Button>
            </div>

            {totpOtpAuthUrl && (
              <p className="text-xs text-muted-foreground">
                Add this key to your authenticator app, then enter a 6-digit code below.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-2">
                <Label htmlFor="settings-totp-code" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Verification Code
                </Label>
                <Input
                  id="settings-totp-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))}
                  disabled={isBusy}
                  className="font-mono text-center tracking-[0.35em]"
                />
              </div>
              <Button
                type="button"
                onClick={handleTotpConfirm}
                disabled={isBusy || totpCode.length < 6}
                className="font-mono text-xs"
              >
                Confirm App
              </Button>
            </div>
          </div>
        )}

        <MethodRow
          icon={Key}
          title="Security Key / Passkey"
          active={hasWebAuthn}
          description={hasWebAuthn ? 'Configured and active' : 'Not configured'}
          action={(
            webauthnAvailable ? (
              <Button
                type="button"
                variant={hasWebAuthn ? 'outline' : 'default'}
                size="sm"
                className="font-mono text-xs"
                onClick={handleWebAuthnRegister}
                disabled={isBusy}
              >
                {hasWebAuthn ? 'Add Passkey' : 'Set Up Passkey'}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-mono uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">
                <AlertCircle className="h-3 w-3" />
                Unsupported Device
              </span>
            )
          )}
        />

        <MethodRow
          icon={KeyRound}
          title="Recovery Codes"
          active={recoveryCodesRemaining > 0}
          description={hasMfa ? `${recoveryCodesRemaining} codes currently available` : 'Configure MFA first'}
          action={(
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={handleRecoveryGenerate}
              disabled={isBusy || !hasMfa}
            >
              {recoveryCodesRemaining > 0 ? 'Regenerate Codes' : 'Generate Codes'}
            </Button>
          )}
        />

        {recoveryCodes.length > 0 && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-rose-700 dark:text-rose-300">
                  Store These Recovery Codes Safely
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  These codes are shown only once. Save them before leaving this page.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="font-mono text-xs"
                  onClick={handleCopyRecoveryCodes}
                >
                  {copiedRecoveryCodes ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                  {copiedRecoveryCodes ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="font-mono text-xs"
                  onClick={() => setShowRecoveryCodes((prev) => !prev)}
                >
                  {showRecoveryCodes ? 'Hide' : 'Show'}
                </Button>
              </div>
            </div>

            {showRecoveryCodes && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {recoveryCodes.map((code, index) => (
                  <div
                    key={code}
                    className="rounded border border-border bg-card/70 px-3 py-2 font-mono text-xs text-foreground"
                  >
                    {index + 1}. {code}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/70 font-mono">
        Recommended: keep at least one authenticator method and one passkey configured.
      </p>
    </div>
  );
}

function MethodRow({ icon: Icon, title, description, active, action }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn('p-2 rounded-lg', active ? 'bg-emerald-500/10' : 'bg-muted')}>
          <Icon className={cn('h-4 w-4', active ? 'text-emerald-400' : 'text-muted-foreground')} />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium text-foreground truncate">{title}</p>
          <p className="text-[11px] text-muted-foreground truncate">{description}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className={cn(
          'px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider',
          active
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-muted text-muted-foreground border border-border'
        )}>
          {active ? 'Active' : 'Inactive'}
        </span>
        {action}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </div>
  );
}
