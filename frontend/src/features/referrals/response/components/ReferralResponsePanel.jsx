import { useCallback, useLayoutEffect, useState } from 'react';
import { ResponseButton as Button } from './ResponseButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useResponseAccess } from '../hooks/useResponseAccess';
import { useResponseContext } from '../hooks/queries';
import { useResponseCommand } from '../hooks/useResponseCommand';
import { useResponseDraft } from '../hooks/useResponseDraft';
import { validId } from '../model';
import { ResponseEvidence } from './ResponseEvidence';
import { ResponseEditor } from './ResponseEditor';
import { ResponseHistory } from './ResponseHistory';
import { ManualResponseReview } from './ManualResponseReview';
function Unavailable({ open, onClose, onRetry, selection = false }) {
  if (!open) return null;
  return <Dialog open onOpenChange={next => { if (!next) onClose?.(); }}><DialogContent><DialogHeader><DialogTitle>{selection ? 'Select an exact referral' : 'Referral response unavailable'}</DialogTitle><DialogDescription>{selection ? 'Open a specific referral response from the referral inbox or sent referrals. No active referral or encounter is chosen automatically.' : 'Current Full clinical access, referral permission and the patient/referral relationship could not be confirmed. Protected response content and local copies are hidden.'}</DialogDescription></DialogHeader><DialogFooter>{onRetry && <Button type="button" variant="outline" onClick={onRetry}>Reload current referral access</Button>}<Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogFooter></DialogContent></Dialog>;
}
function OriginalResult({ controller, canWrite, onCurrent }) {
  const original = controller.saved?.response || controller.frozen?.payload;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Original referral response result">
    {controller.saved ? <><Alert><AlertDescription>The response was recorded. This is the original immutable result; later responses may differ. Review the current referral before another action.</AlertDescription></Alert><ResponseEvidence response={controller.saved.response} title="Original saved response" />{controller.refreshFailed && <Alert variant="destructive"><AlertDescription>The saved response is confirmed, but current data could not refresh.</AlertDescription></Alert>}<Button type="button" variant="outline" onClick={onCurrent}>Review current referral</Button></> : <><Alert variant="destructive"><AlertDescription>{controller.error}</AlertDescription></Alert><div><h3 className="font-medium">Unchanged reviewed specialist notes</h3><p className="whitespace-pre-wrap break-words text-sm">{original?.specialist_notes}</p></div><div><h3 className="font-medium">Unchanged reviewed recommendations</h3><p className="whitespace-pre-wrap break-words text-sm">{original?.recommendations || 'No recommendations entered'}</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={controller.busy} onClick={() => controller.run(null, true)}>Check original saved response</Button><Button type="button" disabled={controller.busy || !canWrite} onClick={() => controller.run()}>Retry exact reviewed response</Button></div></>}
  </section>;
}
function CurrentResponse({ current, actionable, access, onEdit }) {
  return <><ResponseEvidence response={current.response} /><p className="text-xs text-muted-foreground">Current referral: {current.status} · response version {current.version}. Recorded response status and priority remain original evidence.</p>
    {actionable && <Button type="button" onClick={onEdit}>{current.can_amend ? 'Amend completed response' : 'Draft or complete response'}</Button>}
    {!access.canWrite && <p className="text-sm text-muted-foreground">Current access is read-only. No response can be submitted.</p>}</>;
}
function WorkspaceContents(props) {
  const { controller, current, history, editing, setHistory, scope, access, onDenied, open, ready } = props;
  if (controller.saved || controller.unknown) return <OriginalResult {...{ controller }} canWrite={access.canWrite} onCurrent={props.onCurrent} />;
  let content = <CurrentResponse {...{ current, access }} actionable={props.actionable} onEdit={props.onEdit} />;
  if (history) content = <ResponseHistory {...{ scope, onDenied }} proof={access.scope} enabled={open && ready} />;
  else if (editing) content = <ResponseEditor key={props.generation} {...props} refresh={props.refresh} />;
  return <><div className="flex flex-wrap gap-2"><Button type="button" variant={history ? 'outline' : 'secondary'} disabled={controller.busy || editing} onClick={() => setHistory(false)}>Current response</Button><Button type="button" variant={history ? 'secondary' : 'outline'} disabled={controller.busy || editing} onClick={() => setHistory(true)}>Response history</Button></div>
    {!editing && <ManualResponseReview {...{ scope, access, onDenied, current }} enabled={open && ready} onRefresh={props.refresh} />}{content}</>;
}
function WorkspaceBody(props) {
  if (props.query.isError) return <Alert variant="destructive"><AlertDescription>The current referral response could not be confirmed. Earlier cached content is hidden. Reload before continuing.</AlertDescription></Alert>;
  if (!props.ready) return <p role="status">Confirming current referral access…</p>;
  return <WorkspaceContents {...props} current={props.query.data} />;
}
function Workspace({ open, onClose, access, patient, referralId, onDenied }) {
  const scope = { patientId: patient.id, referralId };
  const query = useResponseContext(scope, access.scope, open);
  const controller = useResponseCommand(scope, access.scope, onDenied);
  const draft = useResponseDraft();
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [generation, setGeneration] = useState(0);
  const denied = query.error?.status === 403;
  useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  const ready = query.isFetchedAfterMount && !query.isError && Boolean(query.data);
  const close = () => { if (!controller.busy) onClose(); };
  const current = async () => {
    const fresh = await query.refetch();
    if (!fresh.error && fresh.data) { controller.reset(); draft.reset(); setEditing(false); setHistory(false); setGeneration(old => old + 1); }
  };
  const actionable = ready && !query.isFetching && access.canWrite && ['can_save_draft', 'can_complete', 'can_amend'].some(key => query.data[key]);
  if (denied) return <Unavailable {...{ open, onClose }} />;
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-4xl" onEscapeKeyDown={event => { if (controller.busy) event.preventDefault(); }} onInteractOutside={event => { if (controller.busy) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>Referral response</DialogTitle><DialogDescription className="break-words">{patient.name} · {patient.code}{ready ? ` · ${query.data.to_service} · ${query.data.status}` : ' · Exact selected referral'}</DialogDescription></DialogHeader>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto pr-1"><WorkspaceBody {...{ open, scope, access, patient, controller, onDenied, draft, query, ready, history, editing, setHistory, generation, actionable }} refresh={() => query.refetch()} onCurrent={current} onEdit={() => { draft.begin(query.data); setEditing(true); }} /></div>
    <DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4"><p className="mr-auto text-xs text-muted-foreground">Response drafting, completion and amendment are distinct reviewed actions.</p><Button type="button" variant="outline" disabled={controller.busy} onClick={() => query.refetch()}>Refresh current referral</Button><Button type="button" variant="outline" disabled={controller.busy} onClick={close}>Close response</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function AuthorizedPanel(props) {
  const [denied, setDenied] = useState(false); const [generation, setGeneration] = useState(0); const onDenied = useCallback(() => setDenied(true), []);
  return denied ? <Unavailable open={props.open} onClose={props.onClose} onRetry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <Workspace key={generation} {...props} onDenied={onDenied} />;
}
function SelectedPanel(props) {
  const [referralId, setReferralId] = useState(() => validId(props.requestedReferralId) ? props.requestedReferralId : null);
  // react-doctor-disable-next-line react-doctor/no-derived-state-effect -- A route handoff is an external selection command; retain it when transient URL options clear on ordinary close. The rendered key switches immediately for a new explicit referral.
  useLayoutEffect(() => { if (props.open && validId(props.requestedReferralId)) setReferralId(props.requestedReferralId); }, [props.open, props.requestedReferralId]);
  const selected = props.open && validId(props.requestedReferralId) ? props.requestedReferralId : referralId;
  if (!selected) return <Unavailable open={props.open} onClose={props.onClose} selection />;
  return <AuthorizedPanel key={selected} {...props} referralId={selected} />;
}
export default function ReferralResponsePanel(props) {
  const access = useResponseAccess(); const id = props.patient?.local_data?.id || props.patient?.id; const referralId = props.requestedReferralId;
  const patient = { id, name: props.patient?.name || [props.patient?.first_name, props.patient?.last_name].filter(Boolean).join(' ') || 'Patient', code: props.patient?.mrn || props.patient?.patient_code || '' };
  if (!access.canRead || !validId(id)) return <Unavailable open={props.open} onClose={props.onClose} />;
  if (referralId != null && !validId(referralId)) return <Unavailable open={props.open} onClose={props.onClose} selection />;
  return <SelectedPanel key={JSON.stringify([access.scope, id])} {...props} {...{ patient, access }} />;
}
