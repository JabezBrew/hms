import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PasskeyList({ state, locked, current, previous, onPrevious, onNext, onDisable }) {
  return <Card><CardHeader><CardTitle>Trusted passkeys</CardTitle><CardDescription>Up to ten active keys. The server refuses removal of the last usable key.</CardDescription></CardHeader><CardContent className="grid gap-3">
    {!current ? <Alert variant="destructive"><AlertDescription>The key list is unavailable. <Button type="button" variant="link" onClick={() => state.keys.refetch()}>Reload keys</Button></AlertDescription></Alert> : <>{state.keys.data.rows.length ? state.keys.data.rows.map((key) => <KeyRow key={`${key.id}:${key.label}:${key.disabled_at}`} saved={key} locked={locked} onRename={state.rename} onDisable={onDisable} />) : <p>No keys in this page.</p>}
      <div className="flex gap-2"><Button type="button" variant="outline" disabled={!previous.length || Boolean(state.busy)} onClick={onPrevious}>Previous keys</Button><Button type="button" variant="outline" disabled={!state.keys.data.has_next || Boolean(state.busy)} onClick={onNext}>Next keys</Button></div></>}
    <Button type="button" className="justify-self-start" disabled={locked} onClick={state.register}>Add passkey</Button>
  </CardContent></Card>;
}
function KeyRow({ saved, locked, onRename, onDisable }) {
  const [label, setLabel] = useState(saved.label || '');
  return <div className="grid gap-2 rounded-xl border p-4"><p className="text-sm">{saved.disabled_at ? 'Disabled passkey' : 'Active passkey'} · Added {new Date(saved.created_at).toLocaleDateString()}</p><Label htmlFor={`key-${saved.id}`}>Passkey name</Label><Input id={`key-${saved.id}`} maxLength={100} value={label} disabled={locked || Boolean(saved.disabled_at)} onChange={(event) => setLabel(event.target.value)} /><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={locked || Boolean(saved.disabled_at) || !label.trim() || label.trim() === saved.label} onClick={() => onRename(saved, label)}>Save name</Button><Button type="button" variant="outline" disabled={locked || Boolean(saved.disabled_at)} onClick={() => onDisable(saved)}>Disable passkey</Button></div></div>;
}
export function RecoveryCodes({ state }) {
  if (!state.codes.length) return null;
  return <><p>Save these codes now. They are shown only once.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(state.codes.join('\n')); state.set({ feedback: 'Recovery codes copied.' }); } catch { state.set({ feedback: 'Copy failed. Select and save the codes manually.' }); } }}>Copy codes</Button><Button type="button" variant="ghost" onClick={() => state.set({ showCodes: !state.showCodes })}>{state.showCodes ? 'Hide codes' : 'Show codes'}</Button><Button type="button" variant="ghost" onClick={() => state.set({ codes: [], showCodes: true })}>Done</Button></div>{state.showCodes && <ul aria-label="New recovery codes" className="grid gap-2 sm:grid-cols-2">{state.codes.map((code) => <li key={code} className="break-all rounded-md border p-2 font-mono text-sm">{code}</li>)}</ul>}</>;
}
