import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { UNAVAILABLE, commandPayload, label, utcTime } from './model';
import { CourseReceipt } from './CourseReceipt';
import { CourseActionFields } from './CourseActionFields';
import { CourseActionControls } from './CourseActionControls';

function Review({ command, patient }) {
  return <section className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm" aria-label="Reviewed course change"><h3 className="font-medium">{command.kind === 'stop' ? 'Stop only this admission course' : 'Add the next contiguous scheduled window'}</h3><p>{patient.name} · {patient.code}</p><p>{command.source.summary.medication_name} · {command.source.summary.dose} · {command.source.summary.route} · {command.source.summary.frequency}</p><p>Selected admission · {command.context.current_ward_name} · {label(command.context.admission_status)}</p>{command.kind === 'stop' ? <><p className="whitespace-pre-wrap break-words">Reason: {command.payload.reason}</p><p>The source prescription and other admission courses remain unchanged. Earlier clinical and stock evidence remains.</p></> : <><p>From {utcTime(command.payload.expected_scheduled_through)}, included, until {utcTime(command.payload.scheduled_before)}, excluded.</p>{command.payload.note && <p className="whitespace-pre-wrap break-words">Note: {command.payload.note}</p>}<p>The exact new dose count is confirmed after saving. The captured interval, prescribed end and current scheduling limit still apply. This creates dose records and supply demand; it does not issue stock.</p></>}</section>;
}
export function CourseActions({ selection, controller, patient, actorId, scope, currentContext, currentSource, canWrite, onDiscard, onReviewMembership, draft }) {
  const { form, setForm, review, setReview, confirmed, setConfirmed, validation, setValidation } = draft;
  const locked = controller.locked; const command = controller.frozen || review;
  const stale = currentContext?.context_token !== selection.context.context_token || currentSource?.source_token !== selection.source.source_token || currentSource?.course_token !== selection.source.course_token;
  const currentPermission = currentContext?.can_manage_courses === true && (selection.kind === 'stop' ? currentSource?.can_stop_course === true : currentSource?.can_request_schedule_window === true);
  const permitted = canWrite && (controller.unknown || currentPermission);
  const fieldLocked = locked || Boolean(review) || stale || !permitted;
  const unavailableReason = selection.kind === 'stop' ? currentSource?.stop_unavailable_reason : currentSource?.window_unavailable_reason;
  const change = (key, value) => { if (fieldLocked) return; setForm((old) => ({ ...old, [key]: value })); setValidation(null); };
  const prepare = () => { try { const payload = commandPayload(selection.kind, selection.source, selection.context, form, crypto.randomUUID()); setReview({ ...scope, ...selection, payload, actorId }); setConfirmed(false); setValidation(null); } catch (error) { setValidation(error.message); } };
  if (controller.saved) return <div className="grid gap-4"><CourseReceipt receipt={controller.saved} refreshFailed={controller.refreshFailed} onReviewMembership={onReviewMembership} /><Button type="button" variant="outline" onClick={onDiscard}>Return to current course review</Button></div>;
  return <section className="grid gap-4 rounded-xl border p-4" aria-label="Course change"><h3 className="font-medium">{selection.kind === 'stop' ? 'Stop this admission course' : 'Additional scheduled doses'}</h3>
    {!controller.unknown && !review && <CourseActionFields kind={selection.kind} source={selection.source} form={form} disabled={fieldLocked} onChange={change} />}
    {command && <Review command={command} patient={patient} />}
    {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}{controller.error && <Alert variant="destructive"><AlertDescription>{controller.error}</AlertDescription></Alert>}
    {stale && !controller.unknown && <Alert><AlertDescription>The admission changed after this review. Discard this draft and reload the admission and course before making a new decision.</AlertDescription></Alert>}
    {!controller.unknown && currentContext && currentSource && !currentPermission && <Alert><AlertDescription>{UNAVAILABLE[unavailableReason] || UNAVAILABLE[currentContext.management_unavailable_reason] || 'Current admission or course state allows review only. Discard the draft and reload before starting another decision.'}</AlertDescription></Alert>}
    {review && !controller.unknown && <div className="flex items-start gap-3"><Checkbox id="course-change-reviewed" checked={confirmed} disabled={controller.busy || !permitted || stale} onCheckedChange={(value) => setConfirmed(value === true)} /><Label htmlFor="course-change-reviewed" className="leading-relaxed">I confirmed this patient, selected admission, source regimen and the exact change shown above.</Label></div>}
    <CourseActionControls {...{ controller, review, confirmed, permitted, stale, onDiscard }} kind={selection.kind} onPrepare={prepare} onEdit={() => { setReview(null); setConfirmed(false); }} />
  </section>;
}
