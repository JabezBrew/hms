import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useAuthScope } from '../useAuthScope';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { hasFreshPasskey, authFailure } from '../model';
import { useSecuritySettings } from './useSecuritySettings';
import { PasskeyList, RecoveryCodes } from './SecurityEvidence';

export default function SecuritySettings() {
  const { user } = useAuth(); const scope = useAuthScope(user);
  return user ? <SecurityWorkspace key={scope} scope={scope} user={user} /> : <Alert><AlertDescription>Sign in to review account security.</AlertDescription></Alert>;
}
function SecurityWorkspace({ scope, user }) {
  const { reauthenticate } = useAuth(); const [cursor, setCursor] = useState(null); const [previous, setPrevious] = useState([]);
  const state = useSecuritySettings(scope, cursor); const [password, setPassword] = useState(''); const [confirming, setConfirming] = useState(false); const [confirmationError, setConfirmationError] = useState(null); const [replace, setReplace] = useState(false); const [retiring, setRetiring] = useState(null);
  const [now, setNow] = useState(Date.now()); const proof = state.assurance.data?.assurance;
  const confirmation = useRef(null);
  useLayoutEffect(() => () => confirmation.current?.abort(), []);
  useEffect(() => { const remaining = Date.parse(proof?.expires_at) - Date.now(); const timer = window.setTimeout(() => setNow(Date.now()), remaining > 0 ? remaining : 15000); return () => window.clearTimeout(timer); }, [proof, now]);
  const current = state.assurance.isFetchedAfterMount && !state.assurance.isError;
  const fresh = current && hasFreshPasskey(proof, now); const rowsCurrent = state.keys.isFetchedAfterMount && !state.keys.isError;
  const locked = Boolean(state.busy) || confirming || state.unknown || !fresh || !rowsCurrent;
  const confirm = async (event) => { event.preventDefault(); if (confirmation.current || !reauthenticate) return; const controller = new AbortController(); confirmation.current = controller; setConfirming(true); setConfirmationError(null); try { await reauthenticate(user.email, password || undefined, user.facilityCode, { signal: controller.signal }); } catch (error) { if (!controller.signal.aborted) setConfirmationError(authFailure(error)); } finally { if (confirmation.current === controller) confirmation.current = null; if (!controller.signal.aborted) { setPassword(''); setConfirming(false); } } };
  return <div className="grid min-w-0 gap-4">
    <Card><CardHeader><CardTitle>Current sign-in proof</CardTitle><CardDescription>Enrolled keys and current verified factor evidence are separate.</CardDescription></CardHeader><CardContent className="grid gap-4">
      <p role="status">{!current ? 'Current factor proof could not be confirmed.' : fresh ? 'A passkey verified this sign-in recently.' : proof?.method === 'recovery' ? 'Signed in using recovery. Passkey-required changes remain unavailable.' : 'A fresh passkey assertion is required for protected changes.'}</p>
      <form className="grid gap-3" onSubmit={confirm}><Label htmlFor="security-proof-password">Current password (when confirmation is required)</Label><Input id="security-proof-password" type="password" autoComplete="current-password" value={password} disabled={confirming || Boolean(state.busy)} onChange={(event) => setPassword(event.target.value)} /><Button type="submit" className="justify-self-start" disabled={confirming || Boolean(state.busy)}>{confirming ? 'Waiting for passkey…' : 'Verify an existing passkey'}</Button></form>
      <p className="text-xs text-muted-foreground">A passkey assertion alone does not renew password freshness. First-key setup uses an identity-checked operator token at sign-in.</p>{confirmationError && <p role="alert">{confirmationError}</p>}
    </CardContent></Card>
    {state.feedback && <Alert role="status"><AlertDescription>{state.feedback}</AlertDescription></Alert>}
    {state.unknown && <Button type="button" variant="outline" onClick={state.review}>Load security status for manual review</Button>}
    <PasskeyList state={state} locked={locked} current={rowsCurrent} previous={previous} onPrevious={() => { setCursor(previous.at(-1)); setPrevious(previous.slice(0, -1)); }} onNext={() => { const next = state.keys.data.next_cursor; if (next === cursor || previous.includes(next)) { state.set({ feedback: 'The next key page could not be confirmed. Reload the key list before continuing.' }); return; } setPrevious([...previous, cursor]); setCursor(next); }} onDisable={setRetiring} />
    <Card><CardHeader><CardTitle>Recovery codes</CardTitle><CardDescription>Unused codes can complete a recovery sign-in. They do not authorize trusted-key management or passkey-required privileges.</CardDescription></CardHeader><CardContent className="grid gap-3">
      <Button type="button" variant="outline" className="justify-self-start" disabled={locked || !password} onClick={() => setReplace(true)}>Replace recovery codes</Button><p className="text-xs text-muted-foreground">Enter the current password above and verify a fresh existing passkey before replacement. Every previous unused code becomes invalid.</p>
      <RecoveryCodes state={state} />
    </CardContent></Card>
    <Dialog open={replace || Boolean(retiring)} onOpenChange={(open) => { if (!open && !state.busy) { setReplace(false); setRetiring(null); } }}><DialogContent><DialogHeader><DialogTitle>{replace ? 'Replace recovery codes?' : 'Disable this passkey?'}</DialogTitle><DialogDescription>{replace ? 'Every existing unused recovery code becomes invalid. Save the new set immediately.' : `This retires ${retiring?.label || 'the selected passkey'} and invalidates proof derived from it. Keep another usable key.`}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => { setReplace(false); setRetiring(null); }}>Cancel</Button><Button type="button" disabled={locked || (replace && !password)} onClick={() => { if (replace) { setReplace(false); const value = password; setPassword(''); void state.recover(value); } else { const key = retiring; setRetiring(null); void state.disable(key); } }}>{replace ? 'Replace codes' : 'Disable passkey'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
