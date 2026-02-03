import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js';
import ShieldOff from 'lucide-react/dist/esm/icons/shield-off.js';
import Smartphone from 'lucide-react/dist/esm/icons/smartphone.js';
import Key from 'lucide-react/dist/esm/icons/key.js';
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';

import { cn } from '@/lib/utils';
import { useMfaStatus } from '@/features/settings/hooks';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * MFAStatus - Shows the user's MFA enrollment status
 */
export default function MFAStatus() {
  const { data: mfaStatus, isLoading, isError, refetch } = useMfaStatus();

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

  const hasTotp = mfaStatus?.totp_enrolled;
  const hasWebAuthn = mfaStatus?.webauthn_enrolled;
  const hasMfa = hasTotp || hasWebAuthn;
  const recoveryCodesRemaining = mfaStatus?.recovery_codes_remaining || 0;

  return (
    <div className="space-y-4">
      {/* Overall Status */}
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
              ? 'Your account is protected with multi-factor authentication.'
              : 'Add an extra layer of security to your account.'}
          </p>
        </div>
      </div>

      {/* MFA Methods */}
      <div className="space-y-3">
        {/* TOTP Status */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center gap-3">
            <div className={cn(
              'p-2 rounded-lg',
              hasTotp ? 'bg-emerald-500/10' : 'bg-muted'
            )}>
              <Smartphone className={cn(
                'h-4 w-4',
                hasTotp ? 'text-emerald-400' : 'text-muted-foreground'
              )} />
            </div>
            <div>
              <p className="font-mono text-xs font-medium text-foreground">
                Authenticator App
              </p>
              <p className="text-[11px] text-muted-foreground">
                {hasTotp ? 'Configured' : 'Not configured'}
              </p>
            </div>
          </div>
          <span className={cn(
            'px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider',
            hasTotp
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-muted text-muted-foreground border border-border'
          )}>
            {hasTotp ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* WebAuthn Status */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center gap-3">
            <div className={cn(
              'p-2 rounded-lg',
              hasWebAuthn ? 'bg-emerald-500/10' : 'bg-muted'
            )}>
              <Key className={cn(
                'h-4 w-4',
                hasWebAuthn ? 'text-emerald-400' : 'text-muted-foreground'
              )} />
            </div>
            <div>
              <p className="font-mono text-xs font-medium text-foreground">
                Security Key / Passkey
              </p>
              <p className="text-[11px] text-muted-foreground">
                {hasWebAuthn ? 'Configured' : 'Not configured'}
              </p>
            </div>
          </div>
          <span className={cn(
            'px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider',
            hasWebAuthn
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-muted text-muted-foreground border border-border'
          )}>
            {hasWebAuthn ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Recovery Codes Status */}
        {hasMfa && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2 rounded-lg',
                recoveryCodesRemaining > 2 ? 'bg-sky-500/10' : 'bg-amber-500/10'
              )}>
                <KeyRound className={cn(
                  'h-4 w-4',
                  recoveryCodesRemaining > 2 ? 'text-sky-400' : 'text-amber-400'
                )} />
              </div>
              <div>
                <p className="font-mono text-xs font-medium text-foreground">
                  Recovery Codes
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {recoveryCodesRemaining} codes remaining
                </p>
              </div>
            </div>
            <span className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider',
              recoveryCodesRemaining > 2
                ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            )}>
              {recoveryCodesRemaining > 2 ? 'Available' : 'Low'}
            </span>
          </div>
        )}
      </div>

      {/* Info Note */}
      <p className="text-[11px] text-muted-foreground/70 font-mono">
        MFA settings can be managed during login. Contact your administrator for enrollment options.
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    </div>
  );
}
