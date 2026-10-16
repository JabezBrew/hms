import { useId, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NetworkPolicyFields } from './NetworkPolicyFields';
import { NetworkPolicyReview } from './NetworkPolicyReview';
import { networkCandidate, networkReason } from './model';
import { useNetworkPolicyChange } from './useNetworkPolicyChange';

export function NetworkPolicyEditor({ policy, user, reauthenticate, readStale, onRefresh, onReload }) {
  const id = useId(); const [draft, setDraft] = useState({ networks: policy.onsite_cidrs.join('\n'), mode: policy.offsite_mode, reason: '' });
  const [password, setPassword] = useState(''); const [validation, setValidation] = useState(null);
  const action = useNetworkPolicyChange({ policy, user, reauthenticate });
  const review = async (event) => {
    event.preventDefault(); if (action.busy || action.unknown || action.saved) return;
    try { setValidation(null); await action.preview({ candidate: networkCandidate(draft.networks, draft.mode), reason: networkReason(draft.reason), password }); }
    catch (error) { setValidation(error.message); }
    finally { setPassword(''); }
  };
  const publish = async () => { try { await action.publish(password); } finally { setPassword(''); } };
  if (action.saved) return <Card><CardHeader><CardTitle>Network policy saved</CardTitle><CardDescription>The server confirmed policy version {action.saved.policy.version}. This receipt records the saved version, including an exact-request replay.</CardDescription></CardHeader><CardContent className="grid gap-4"><Alert role="status"><AlertTitle>Policy publication confirmed</AlertTitle><AlertDescription><p>Recorded {new Date(action.saved.policy.updated_at).toLocaleString()}. Other policy changes may have occurred since this saved version.</p>{action.refreshFailed && <p>The current policy could not be refreshed. This saved version remains confirmed.</p>}</AlertDescription></Alert><ul aria-label="Saved approved networks" className="grid gap-1 font-mono text-xs">{action.saved.policy.onsite_cidrs.map((cidr) => <li key={cidr} className="break-all">{cidr}</li>)}</ul><Button type="button" variant="outline" onClick={onReload}>Review current policy</Button></CardContent></Card>;
  return <Card><CardHeader><CardTitle>Review facility network access</CardTitle><CardDescription>Editing policy version {policy.version}. Changes affect this facility. Unknown or unconfigured network origins remain read-only even after credential confirmation.</CardDescription></CardHeader><CardContent className="grid gap-5"><form onSubmit={action.checked || action.unknown ? (event) => { event.preventDefault(); void publish(); } : review} className="grid gap-5">
    <NetworkPolicyFields draft={draft} onChange={(next) => { setDraft(next); action.edit(); }} disabled={action.busy || action.unknown || Boolean(action.checked) || readStale} />
    {action.checked && <NetworkPolicyReview checked={action.checked} />}
    {(!action.checked || action.unknown) && <div className="grid gap-2"><Label htmlFor={`${id}-password`}>Confirm your current password</Label><Input id={`${id}-password`} type="password" autoComplete="current-password" value={password} disabled={action.busy || readStale} onChange={(event) => setPassword(event.target.value)} /><p className="text-xs text-muted-foreground">Confirms a fresh credential sign-in in the same account and facility. This does not perform or claim fresh multi-factor verification.</p></div>}
    {(validation || action.error) && <Alert variant="destructive"><AlertTitle>{action.unknown ? 'Policy publication status unknown' : 'Policy not confirmed'}</AlertTitle><AlertDescription>{validation || action.error}</AlertDescription></Alert>}
    {readStale && <Alert variant="destructive"><AlertTitle>Policy review is currently unavailable</AlertTitle><AlertDescription>The current connection must have server-confirmed administration access before reviewing or publishing a change.</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-3">{action.unknown ? <><Button key="retry" type="submit" disabled={action.busy || !password || readStale}>{action.busy ? 'Confirming…' : 'Retry exact policy change'}</Button><Button type="button" variant="outline" disabled={action.busy} onClick={onRefresh}>Refresh current policy</Button></> : action.checked ? <><Button key="publish" type="submit" disabled={action.busy || readStale}>{action.busy ? 'Publishing…' : 'Publish reviewed policy'}</Button><Button key="edit" type="button" variant="outline" disabled={action.busy} onClick={action.edit}>Change policy details</Button></> : <Button key="review" type="submit" disabled={action.busy || !password || readStale}>{action.busy ? 'Checking…' : 'Check current connection'}</Button>}{!action.unknown && <Button type="button" variant="outline" disabled={action.busy} onClick={onReload}>Reload current policy</Button>}</div>
  </form></CardContent></Card>;
}
