import { useEffect, useReducer, useRef } from 'react';
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Check from 'lucide-react/dist/esm/icons/check.js';

import { useMfaStatus } from '@/features/settings/hooks';
import { authApi } from '@/shared/api/auth';
import { serializeCredential, toAuthenticationOptions, toRegistrationOptions } from '@/lib/webauthn';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

const initialState = {
  busy: null,
  feedback: null,
  password: '',
  codes: [],
  showCodes: true,
  copied: false,
  confirmReplace: false,
  statusStale: false,
};

function settingsReducer(state, action) {
  if (action.type === 'start') {
    return { ...state, busy: action.operation, feedback: null, confirmReplace: false };
  }
  if (action.type === 'finish') return { ...state, busy: null };
  if (action.type === 'patch') return { ...state, ...action.value };
  return state;
}

function passkeyFailure(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
    return { kind: 'info', message: 'Passkey request cancelled or not approved. You can try again.' };
  }
  if (error?.name === 'SecurityError') {
    return { kind: 'error', message: 'Passkeys are unavailable at this site address. Contact your administrator.' };
  }
  return { kind: 'error', message: error?.message || 'The passkey request failed. Please try again.' };
}

export default function PasskeySettings() {
  const { data: status, isLoading, isError, refetch } = useMfaStatus();
  const [state, dispatch] = useReducer(settingsReducer, initialState);
  const operationRef = useRef(null);

  useEffect(() => () => operationRef.current?.abort(), []);

  const patch = (value) => dispatch({ type: 'patch', value });
  const hasPasskey = status?.webauthn_enrolled === true;
  const remaining = status?.recovery_codes_remaining || 0;
  const statusUnavailable = isError || state.statusStale;
  const passkeysAvailable = Boolean(
    typeof window !== 'undefined'
    && window.isSecureContext !== false
    && window.PublicKeyCredential
    && navigator.credentials?.create,
  );

  const refreshStatus = async () => {
    try {
      const result = await refetch();
      patch({ statusStale: Boolean(result?.isError || result?.error) });
    } catch {
      patch({ statusStale: true });
    }
  };

  const runPasskey = async (operation) => {
    if (operationRef.current || statusUnavailable) return;
    const controller = new AbortController();
    operationRef.current = controller;
    const { signal } = controller;
    dispatch({ type: 'start', operation });
    try {
      const registering = operation === 'register';
      const options = registering
        ? await authApi.mfaWebAuthnRegistrationOptions(null, { signal })
        : await authApi.mfaWebAuthnAuthOptions(null, { signal });
      if (signal.aborted) return;
      const { mfa_session: session, challenge_id: challengeId, ...publicOptions } = options;
      const challenge = session || challengeId;
      if (!challenge) throw new Error('Passkey challenge could not be started. Please try again.');
      const credential = registering
        ? await navigator.credentials.create({ publicKey: toRegistrationOptions(publicOptions), signal })
        : await navigator.credentials.get({ publicKey: toAuthenticationOptions(publicOptions), signal });
      if (signal.aborted) return;
      if (!credential) {
        patch({ feedback: { kind: 'info', message: 'Passkey request cancelled. You can try again.' } });
        return;
      }
      const payload = serializeCredential(credential);
      const response = registering
        ? await authApi.mfaWebAuthnRegistrationVerify(payload, challenge, { signal })
        : await authApi.mfaWebAuthnAuthVerify(payload, challenge, { signal });
      if (signal.aborted) return;
      if (response?.verified !== true) throw new Error('Passkey verification was not confirmed. Please try again.');
      patch({ feedback: { kind: 'success', message: registering ? 'Passkey registered.' : 'Passkey verified. Your sign-in session has not changed.' } });
      await refreshStatus();
    } catch (error) {
      if (!signal.aborted) patch({ feedback: passkeyFailure(error) });
    } finally {
      if (operationRef.current === controller) operationRef.current = null;
      if (!signal.aborted) dispatch({ type: 'finish' });
    }
  };

  const generateCodes = async () => {
    if (operationRef.current || !state.password || !hasPasskey || statusUnavailable) return;
    const controller = new AbortController();
    operationRef.current = controller;
    dispatch({ type: 'start', operation: 'recovery' });
    patch({ codes: [], copied: false });
    try {
      const response = await authApi.mfaRecoveryGenerate({ currentPassword: state.password, signal: controller.signal });
      if (controller.signal.aborted) return;
      const codes = response?.codes;
      if (!Array.isArray(codes) || codes.length === 0 || codes.some((code) => typeof code !== 'string' || !code)) {
        throw new Error('Recovery codes were not returned.');
      }
      patch({ codes, showCodes: true, feedback: { kind: 'success', message: 'Recovery codes generated. Save them before leaving this page.' } });
      await refreshStatus();
    } catch (error) {
      if (!controller.signal.aborted) {
        const rejected = error?.status >= 400 && error?.status < 500;
        patch({
          statusStale: !rejected,
          feedback: { kind: 'error', message: rejected
            ? error.message || 'Recovery code generation was rejected.'
            : 'Recovery code replacement could not be confirmed. Existing codes may already be invalid. Refresh security status before deliberately generating another set.' },
        });
      }
    } finally {
      if (operationRef.current === controller) operationRef.current = null;
      if (!controller.signal.aborted) patch({ busy: null, password: '' });
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(state.codes.join('\n'));
      patch({ copied: true });
    } catch {
      patch({ feedback: { kind: 'error', message: 'Could not copy the codes. Select and save them manually.' } });
    }
  };

  if (isLoading) return <Skeleton className="h-40 w-full" aria-label="Loading account security" />;
  if (!status) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load account security</AlertTitle>
        <AlertDescription><Button variant="outline" size="sm" onClick={refreshStatus}>Retry</Button></AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {statusUnavailable && <Alert variant="destructive">
        <AlertTitle>Security status needs refreshing</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <p>The enrollment and unused-code count below were last checked earlier. Save any new codes before leaving this page.</p>
          <Button type="button" variant="outline" size="sm" onClick={refreshStatus} disabled={Boolean(state.busy)}>Refresh security status</Button>
        </AlertDescription>
      </Alert>}
      <Alert role="status">
        <KeyRound aria-hidden="true" />
        <AlertTitle>{hasPasskey ? 'Passkey enrolled' : status.passkey_required ? 'Passkey enrollment required' : 'No passkey enrolled'}</AlertTitle>
        <AlertDescription>
          {status.passkey_required ? 'Your account requires passkey enrollment for privileged actions. ' : ''}
          Enrollment records a key for your account; it does not verify this sign-in session or change password sign-in.
        </AlertDescription>
      </Alert>
      {state.feedback && (
        <Alert variant={state.feedback.kind === 'error' ? 'destructive' : 'default'} role={state.feedback.kind === 'error' ? 'alert' : 'status'}>
          <AlertDescription>{state.feedback.message}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Passkey</CardTitle>
          <CardDescription>Use a security key or your device’s fingerprint, face, or PIN.</CardDescription>
        </CardHeader>
        <CardContent><Badge variant={hasPasskey ? 'default' : 'secondary'}>{hasPasskey ? 'Enrolled' : 'Not enrolled'}</Badge></CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button type="button" disabled={Boolean(state.busy) || !passkeysAvailable || statusUnavailable} onClick={() => runPasskey('register')}>
            {state.busy === 'register' ? 'Waiting for passkey…' : hasPasskey ? 'Add passkey' : 'Set up passkey'}
          </Button>
          {hasPasskey && <Button type="button" variant="outline" disabled={Boolean(state.busy) || !passkeysAvailable || statusUnavailable || !navigator.credentials?.get} onClick={() => runPasskey('authenticate')}>{state.busy === 'authenticate' ? 'Checking passkey…' : 'Test passkey'}</Button>}
          {!passkeysAvailable && <p className="text-sm text-muted-foreground">Use a browser and secure site address that support passkeys.</p>}
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recovery codes</CardTitle>
          <CardDescription>{remaining} unused codes stored. Code-based account recovery is not available in this deployment yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (remaining > 0) patch({ confirmReplace: true }); else void generateCodes(); }}>
            <Label htmlFor="passkey-recovery-password">Current password</Label>
            <Input id="passkey-recovery-password" type="password" autoComplete="current-password" value={state.password} onChange={(event) => patch({ password: event.target.value })} disabled={!hasPasskey || Boolean(state.busy) || statusUnavailable} />
            {!hasPasskey && <p className="text-sm text-muted-foreground">Enroll a passkey before generating recovery codes.</p>}
            <Button type="submit" variant="outline" className="self-start" disabled={!hasPasskey || !state.password || Boolean(state.busy) || statusUnavailable}>{state.busy === 'recovery' ? 'Generating…' : remaining > 0 ? 'Replace recovery codes' : 'Generate recovery codes'}</Button>
          </form>
        </CardContent>
        {state.codes.length > 0 && (
          <CardFooter className="flex-col items-stretch gap-3">
            <p className="text-sm">Save these codes now. They are shown only once.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copyCodes}>{state.copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{state.copied ? 'Copied' : 'Copy codes'}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => patch({ showCodes: !state.showCodes })}>{state.showCodes ? 'Hide codes' : 'Show codes'}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => patch({ codes: [], copied: false })}>Done</Button>
            </div>
            {state.showCodes && <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="New recovery codes">{state.codes.map((code) => <li key={code} className="break-all rounded-md border p-2 font-mono text-sm">{code}</li>)}</ul>}
          </CardFooter>
        )}
      </Card>
      <Dialog open={state.confirmReplace} onOpenChange={(open) => { if (!state.busy) patch({ confirmReplace: open }); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Replace recovery codes?</DialogTitle><DialogDescription>All existing unused codes will become invalid. Save the new codes after replacing them.</DialogDescription></DialogHeader>
          <DialogFooter><Button type="button" variant="outline" onClick={() => patch({ confirmReplace: false })}>Cancel</Button><Button type="button" onClick={generateCodes} disabled={Boolean(state.busy)}>Replace codes</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
