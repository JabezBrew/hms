import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useManualMoveReview } from '../hooks/useManualMoveReview';
import { MoveButton as Button } from './MoveButton';
import { PlacementEvidence } from './PlacementEvidence';
function ReviewedPlacement({ result, pending, acknowledge }) {
  const [confirmed, setConfirmed] = useState(false);
  return <><PlacementEvidence current={result.context} /><p className="text-sm text-muted-foreground">This reviews the current saved placement. It cannot identify the outcome of the earlier move or confirm that move’s task-routing and cleaning result.</p><div className="flex items-start gap-3"><Checkbox id="move-manual-review" checked={confirmed} disabled={pending} onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="move-manual-review">I reviewed the current saved placement</Label></div><Button type="button" disabled={!confirmed || pending} onClick={acknowledge}>{pending ? 'Checking current access…' : 'Continue after placement review'}</Button></>;
}
export function ManualMoveReview(props) {
  const manual = useManualMoveReview(props);
  if (!manual.candidate && !manual.pending && !manual.error) return null;
  return <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-4" aria-label="Review an earlier unconfirmed move"><p className="text-sm">The earlier move may have finished. Review the current saved placement before continuing.</p>{manual.error && <p role="alert" className="text-sm text-destructive">{manual.error}</p>}{manual.result ? <ReviewedPlacement key={manual.result.context.placement_token} {...manual} /> : <Button type="button" variant="outline" disabled={manual.pending || !manual.candidate} onClick={manual.review}>{manual.pending ? 'Reading current saved placement…' : 'Review current saved placement'}</Button>}</section>;
}
