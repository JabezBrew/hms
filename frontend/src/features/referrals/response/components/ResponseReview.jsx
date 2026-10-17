import { useState } from 'react';
import { ResponseButton as Button } from './ResponseButton';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
const labels = { save_draft: 'Save response draft', complete: 'Complete referral', amend: 'Save completed response amendment' };
export function ResponseReview({ command, patient, pending, allowed, error, onBack, onSubmit }) {
  const [confirmed, setConfirmed] = useState(false); const operation = command.payload.operation;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Review referral response">
    <h3 className="font-heading text-lg">Review: {labels[operation]}</h3><p className="text-sm">{patient.name} · {patient.code} · {command.source.to_service} · current referral {command.source.status}</p>
    <Alert><AlertDescription>{operation === 'save_draft' ? 'This records a response draft and keeps the referral open in its current status.' : operation === 'complete' ? 'This records the reviewed response and marks the referral completed. It does not create a consultation encounter or any other clinical order.' : 'This appends a reasoned correction to a completed response. Original versions and the original completion time remain unchanged.'}</AlertDescription></Alert>
    <div><h4 className="mb-1 text-sm font-medium">Complete specialist notes</h4><p className="whitespace-pre-wrap break-words text-sm">{command.payload.specialist_notes}</p></div><div><h4 className="mb-1 text-sm font-medium">Complete recommendations</h4><p className="whitespace-pre-wrap break-words text-sm">{command.payload.recommendations || 'No recommendations entered'}</p></div>{operation === 'amend' && <div><h4 className="mb-1 text-sm font-medium">Amendment reason</h4><p className="whitespace-pre-wrap break-words text-sm">{command.payload.amendment_reason}</p></div>}
    {!allowed && <Alert variant="destructive"><AlertDescription>Current referral context or write authority changed after review. Go back and review the latest referral before starting another change.</AlertDescription></Alert>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex items-start gap-3"><Checkbox id="referral-response-reviewed" checked={confirmed} disabled={pending || !allowed} onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="referral-response-reviewed">I confirmed this patient and referral, reviewed the complete response, and explicitly choose the action described above.</Label></div>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending} onClick={onBack}>Back to response draft</Button><Button type="button" disabled={pending || !allowed || !confirmed} onClick={onSubmit}>{pending ? 'Recording response…' : labels[operation]}</Button></div>
  </section>;
}
export function LatestSourceReview({ source, disabled, onContinue }) {
  const [confirmed, setConfirmed] = useState(false);
  return <section className="flex flex-col gap-3 rounded-lg border p-4"><p className="text-sm">The referral changed while this draft was open. Your entered text is preserved. Review its latest status and saved response before choosing whether to use this complete draft against that version.</p><p className="text-sm">{source.to_service} · {source.status} · response version {source.version}</p><div><p className="text-xs text-muted-foreground">Latest saved specialist notes</p><p className="whitespace-pre-wrap break-words text-sm">{source.response?.specialist_notes ?? 'Not recorded'}</p></div><div><p className="text-xs text-muted-foreground">Latest saved recommendations</p><p className="whitespace-pre-wrap break-words text-sm">{source.response?.recommendations ?? 'Not recorded'}</p></div><div className="flex items-start gap-3"><Checkbox id="referral-latest-reviewed" checked={confirmed} disabled={disabled} onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="referral-latest-reviewed">I reviewed the latest referral and want to keep my complete entered response for another explicit review.</Label></div><Button type="button" variant="outline" disabled={disabled || !confirmed} onClick={onContinue}>Use this draft after reviewing the latest referral</Button></section>;
}
