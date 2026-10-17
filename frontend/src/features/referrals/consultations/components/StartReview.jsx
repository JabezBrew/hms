import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ConsultationButton as Button } from './ConsultationButton';
import { SourceEvidence } from './ConsultationEvidence';
export function StartReview({ command, allowed, controller, onBack }) {
  const [confirmed, setConfirmed] = useState(false);
  const override = command.payload.restricted_record_override;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Review consultation start"><SourceEvidence current={command.source} />
    {override && <div className="flex flex-col gap-2 rounded-lg border p-4"><p className="font-medium">Restricted-record override</p><p className="text-sm">Reason code: {override.reason_code}</p>{override.reason_note && <p className="whitespace-pre-wrap break-words text-sm">{override.reason_note}</p>}<p className="text-xs text-muted-foreground">The reason code and whether a note was supplied are audited. This start record will not retain the note text.</p></div>}
    <div className="flex items-start gap-3"><Checkbox id="consultation-start-reviewed" checked={confirmed} disabled={!allowed || controller.busy} onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="consultation-start-reviewed">I reviewed this patient, referral and exact consultation source.</Label></div>
    {controller.error && <p role="alert" className="text-sm text-destructive">{controller.error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={controller.busy} onClick={onBack}>Back to source choices</Button><Button type="button" disabled={!allowed || !confirmed || controller.busy} onClick={() => controller.run(command)}>{controller.busy ? 'Recording consultation start…' : 'Confirm consultation start'}</Button></div>
  </section>;
}
