import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConsultationButton as Button } from './ConsultationButton';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useManualConsultationReview } from '../hooks/useManualConsultationReview';
import { LinkEvidence } from './ConsultationEvidence';

function ReviewedLink({ result, pending, acknowledge }) {
  const [confirmed, setConfirmed] = useState(false);
  return <div className="flex flex-col gap-4"><LinkEvidence link={result.context.link} title="Current saved consultation reviewed" />
    <p className="text-sm text-muted-foreground">This current link does not identify the outcome of the earlier start. No earlier request or private reason note can be recovered from this review.</p>
    <div className="flex items-start gap-3"><Checkbox id="consultation-manual-reviewed" checked={confirmed} disabled={pending} onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="consultation-manual-reviewed">I reviewed the current saved consultation link and understand the earlier outcome remains unconfirmed.</Label></div>
    <Button type="button" disabled={!confirmed || pending} onClick={acknowledge}>{pending ? 'Rechecking current access…' : 'Continue after review'}</Button>
  </div>;
}
export function ManualConsultationReview(props) {
  const manual = useManualConsultationReview(props);
  if (!manual.candidate && !manual.pending && !manual.error) return null;
  return <section aria-label="Review an earlier unconfirmed consultation" className="flex min-w-0 flex-col gap-4 rounded-xl border p-4">
    <Alert><AlertDescription>An earlier consultation start may have finished. Review the current saved link before continuing.</AlertDescription></Alert>
    {manual.error && <p role="alert" className="text-sm text-destructive">{manual.error}</p>}
    {manual.result ? <ReviewedLink key={`${manual.result.context.context_token}:${manual.result.context.link_version}`} result={manual.result} pending={manual.pending} acknowledge={manual.acknowledge} /> : <Button type="button" variant="outline" disabled={!manual.candidate || manual.pending} onClick={manual.review}>{manual.pending ? 'Loading the saved consultation…' : 'Review current saved consultation'}</Button>}
  </section>;
}
