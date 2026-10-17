import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConsultationButton as Button } from './ConsultationButton';
import { SourceEvidence, LinkEvidence } from './ConsultationEvidence';

export function ConsultationResult({ controller, canRetry, onCurrent }) {
  if (controller.saved) return <section aria-label="Original consultation start result" className="flex flex-col gap-4">
    <Alert><AlertDescription>The consultation start is confirmed. Review the current saved link before opening its encounter. Clinical notes and the referral response are separate actions.</AlertDescription></Alert>
    <LinkEvidence link={controller.saved.link} title="Original saved consultation start" />
    {controller.refreshFailed && <Alert variant="destructive"><AlertDescription>The start is saved, but current data could not refresh.</AlertDescription></Alert>}
    <Button type="button" variant="outline" onClick={onCurrent}>Review current consultation</Button>
  </section>;
  return <section aria-label="Unconfirmed consultation start" className="flex flex-col gap-4">
    <Alert variant="destructive"><AlertDescription>{controller.error || 'The consultation start may already be recorded. Check its original result before any different action.'}</AlertDescription></Alert>
    <SourceEvidence current={controller.frozen.source} />
    {controller.frozen.payload.restricted_record_override && <div className="flex flex-col gap-2"><h3 className="font-medium">Unchanged reviewed restricted-record override</h3><p className="text-sm">Reason code: {controller.frozen.payload.restricted_record_override.reason_code}</p>{controller.frozen.payload.restricted_record_override.reason_note && <p className="whitespace-pre-wrap break-words text-sm">{controller.frozen.payload.restricted_record_override.reason_note}</p>}<p className="text-xs text-muted-foreground">This exact request remains in RAM. The start record retains the reason code and whether a note was supplied.</p></div>}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={controller.busy} onClick={() => controller.run(null, true)}>Check original saved start</Button><Button type="button" disabled={controller.busy || !canRetry} onClick={() => controller.run()}>Retry exact reviewed start</Button></div>
  </section>;
}
