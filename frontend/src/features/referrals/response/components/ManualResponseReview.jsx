import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ResponseButton as Button } from './ResponseButton';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useManualResponseReview } from '../hooks/useManualResponseReview';
import { ResponseEvidence } from './ResponseEvidence';
function ReviewedState({ result, pending, onAcknowledge }) {
  const [confirmed, setConfirmed] = useState(false);
  return <section className="flex min-w-0 flex-col gap-4"><ResponseEvidence response={result.version} title="Current saved response reviewed" />{!result.version && <p className="text-sm">No response is currently recorded. This does not establish the outcome of the earlier save.</p>}<p className="text-sm text-muted-foreground">This reviews the current saved state. It does not confirm which result came from the earlier save.</p><div className="flex items-start gap-3"><Checkbox id="referral-manual-reviewed" checked={confirmed} disabled={pending} onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="referral-manual-reviewed">I reviewed the saved response</Label></div><Button type="button" disabled={pending || !confirmed} onClick={onAcknowledge}>{pending ? 'Checking current access…' : 'Continue after review'}</Button></section>;
}
export function ManualResponseReview(props) {
  const manual = useManualResponseReview(props);
  if (!manual.candidate && !manual.pending && !manual.error) return null;
  return <section className="flex min-w-0 flex-col gap-4 rounded-xl border p-4" aria-label="Review an earlier unconfirmed save"><Alert><AlertDescription>The earlier save may have finished. Review the current saved response before continuing.</AlertDescription></Alert>{manual.error && <p role="alert" className="text-sm text-destructive">{manual.error}</p>}{manual.result ? <ReviewedState key={`${manual.result.context.context_token}:${manual.result.context.version}`} result={manual.result} pending={manual.pending} onAcknowledge={manual.acknowledge} /> : <Button type="button" variant="outline" disabled={manual.pending || !manual.candidate} onClick={manual.review}>{manual.pending ? 'Loading current saved response…' : 'Review current saved response'}</Button>}</section>;
}
