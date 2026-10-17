import { useLayoutEffect } from 'react';
import { ResponseButton as Button } from './ResponseButton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { useResponsePreparation } from '../hooks/useResponsePreparation';
import { LatestSourceReview, ResponseReview } from './ResponseReview';
function PreparedResponse({ review, access, current, controller, patient, error, setReview }) {
  const flag = { save_draft: 'can_save_draft', complete: 'can_complete', amend: 'can_amend' }[review.payload.operation];
  const allowed = access.canWrite && current.context_token === review.source.context_token && current.version === review.source.version && current[flag] === true;
  return <ResponseReview key={review.payload.client_request_id} {...{ command: review, patient, allowed }} pending={controller.busy} error={controller.error || error} onBack={() => { controller.reset(); setReview(null); }} onSubmit={() => { if (allowed) void controller.run(review); }} />;
}
const draftActions = [
  { flag: 'can_save_draft', operation: 'save_draft', label: 'Review draft save', variant: 'outline' },
  { flag: 'can_complete', operation: 'complete', label: 'Review referral completion' },
  { flag: 'can_amend', operation: 'amend', label: 'Review completed response amendment' },
];
function DraftActions({ source, disabled, prepare, preparing }) {
  return <div className="flex flex-wrap gap-2">{draftActions.filter(action => source[action.flag]).map(action => <Button key={action.operation} type="button" variant={action.variant} disabled={disabled} onClick={() => prepare(action.operation)}>{action.label}</Button>)}{preparing && <span role="status" className="text-sm text-muted-foreground">Confirming current referral before review…</span>}</div>;
}
export function ResponseEditor({ open, scope, access, patient, current, refresh, controller, onDenied, draft }) {
  const { source, setSource, notes, setNotes, recommendations, setRecommendations, reason, setReason, review, setReview } = draft;
  const { preparing, error, setError, locked, prepare } = useResponsePreparation({ open, scope, access, source, notes, recommendations, reason, setReview, refresh, controller, onDenied });
  const changed = current.context_token !== source.context_token || current.version !== source.version;
  // An unsent reviewed command loses consent on an external source/authority transition. The issued command's immutable retry remains owned by its separate controller.
  useLayoutEffect(() => { if (review && !controller.busy && (changed || !access.canWrite)) setReview(null); }, [review, controller.busy, changed, access.canWrite, setReview]);
  if (review) return <PreparedResponse {...{ review, access, current, controller, patient, error, setReview }} />;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Referral response draft">
    <h3 className="font-heading text-lg">{source.status === 'completed' ? 'Amend completed response' : 'Draft a referral response'}</h3><p className="text-sm text-muted-foreground">Nothing is saved automatically. Save a draft to keep the referral open, or explicitly review completion. This panel does not start a consultation encounter.</p>
    <div className="flex flex-col gap-2"><Label htmlFor="referral-specialist-notes">Specialist notes</Label><Textarea id="referral-specialist-notes" rows={8} maxLength={20000} value={notes} disabled={locked} onChange={event => setNotes(event.target.value)} /><p className="text-xs text-muted-foreground">At least 10 characters of clinical response; maximum 20,000 characters. Leading and trailing text is preserved.</p></div>
    <div className="flex flex-col gap-2"><Label htmlFor="referral-recommendations">Recommendations</Label><Textarea id="referral-recommendations" rows={4} maxLength={10000} value={recommendations} disabled={locked} onChange={event => setRecommendations(event.target.value)} /><p className="text-xs text-muted-foreground">Optional; maximum 10,000 characters. No recommendations are inferred.</p></div>
    {source.status === 'completed' && <div className="flex flex-col gap-2"><Label htmlFor="referral-amendment-reason">Reason for amending this completed response</Label><Textarea id="referral-amendment-reason" maxLength={500} value={reason} disabled={locked} onChange={event => setReason(event.target.value)} /></div>}
    {changed && <LatestSourceReview key={hashQueryValue(JSON.stringify([current.context_token, notes, recommendations, reason]))} source={current} disabled={locked} onContinue={() => { setSource(current); setError(null); }} />}
    {!access.canWrite && <Alert><AlertDescription>Current access is read-only. Saved evidence remains available; no response can be submitted.</AlertDescription></Alert>}
    {(error || controller.error) && <p role="alert" className="text-sm text-destructive">{error || controller.error}</p>}
    <DraftActions {...{ source, prepare, preparing }} disabled={locked || changed || !access.canWrite} />
  </section>;
}
