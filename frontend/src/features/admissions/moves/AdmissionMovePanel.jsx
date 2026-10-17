import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MoveButton as Button } from './components/MoveButton';
import { MoveEvidence, PlacementLabels } from './components/PlacementEvidence';
import { CurrentMoveView } from './components/CurrentMoveView';
import { useMoveAccess } from './hooks/useMoveAccess';
import { usePlacement } from './hooks/queries';
import { useMoveCommand } from './hooks/useMoveCommand';
import { validId } from './model';
import { getWriteUncertaintySnapshot, subscribeWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
function Unavailable({ open, onClose, onRetry, selection = false }) {
  if (!open) return null;
  return <Dialog open onOpenChange={next => { if (!next) onClose?.(); }}><DialogContent><DialogHeader><DialogTitle>{selection ? 'Select an exact admission' : 'Admission placement unavailable'}</DialogTitle><DialogDescription>{selection ? 'Choose an inpatient admission in Chronicle, or open Move bed from its admission case. All history does not select the current admission automatically.' : 'Current Full clinical access, admission authority and the patient/ward relationship could not be confirmed. Protected placement content and local copies are hidden.'}</DialogDescription></DialogHeader><DialogFooter>{onRetry && <Button type="button" variant="outline" onClick={onRetry}>Reload current placement access</Button>}<Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogFooter></DialogContent></Dialog>;
}
function OriginalResult({ controller, access, onCurrent }) {
  const original = controller.frozen;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Original admission move result">{controller.saved ? <><p role="status">The admission move was recorded. This is its original result; it does not establish the current placement.</p><MoveEvidence movement={controller.saved.movement} original />{controller.refreshFailed && <p role="alert">The original result is confirmed, but current placement could not refresh.</p>}<Button type="button" variant="outline" onClick={onCurrent}>Review current placement</Button></> : <><p role="alert">{controller.error}</p><p><PlacementLabels labels={original.source.current_placement.labels} /> → <PlacementLabels labels={original.destination} /></p><p className="whitespace-pre-wrap break-words text-sm">{original.payload.reason}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={controller.busy} onClick={() => controller.run(null, true)}>Check original saved move</Button><Button type="button" disabled={controller.busy || !access.canWrite} onClick={() => controller.run()}>Retry exact reviewed move</Button></div><p className="text-xs text-muted-foreground">A missing saved result does not authorize a new move. Retrying uses the unchanged reviewed destination, reason and task-routing evidence.</p></>}</section>;
}
function Workspace({ open, onClose, access, patient, caseId, onDenied, onMoved, placementRevision }) {
  const scope = { patientId: patient.id, caseId }, query = usePlacement(scope, access.scope, open), controller = useMoveCommand(scope, access.scope, onDenied, onMoved);
  const [selected, setSelected] = useState(null), [reason, setReason] = useState(''), [review, setReview] = useState(null), [history, setHistory] = useState(false);
  const recovery = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot);
  const denied = query.error?.status === 403;
  useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  // Physical revision invalidates source review and refreshes proof; it is not by
  // itself a reason to erase an unrelated clinician's pure draft or issued intent.
  const refetch = query.refetch;
  useLayoutEffect(() => { setReview(null); if (open) void refetch(); }, [placementRevision, open, refetch]);
  const ready = query.isFetchedAfterMount && !query.isError && Boolean(query.data) && (!Number.isSafeInteger(placementRevision) || query.data.placement_revision >= placementRevision), current = query.data;
  useLayoutEffect(() => {
    if (review && !controller.busy && !controller.unknown && (!ready || !access.canWrite || !current?.can_move || current.placement_token !== review.source.placement_token || current.task_membership_token !== review.source.task_membership_token || controller.error)) setReview(null);
  }, [review, controller.busy, controller.unknown, controller.error, ready, access.canWrite, current]);
  const reset = async () => { const fresh = await query.refetch(); if (!fresh.error && fresh.data) { controller.reset(); setSelected(null); setReason(''); setReview(null); setHistory(false); } };
  const close = () => { if (!controller.busy) onClose(); };
  let body = <CurrentMoveView {...{ query, ready, current, history, setHistory, scope, onDenied, access, open, recovery, controller, selected, setSelected, reason, setReason, review, setReview }} />;
  if (ready && (controller.saved || controller.unknown)) body = <OriginalResult {...{ controller, access }} onCurrent={reset} />;
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-3xl" onEscapeKeyDown={event => { if (controller.busy) event.preventDefault(); }} onInteractOutside={event => { if (controller.busy) event.preventDefault(); }}><DialogHeader><DialogTitle>Move admission bed</DialogTitle><DialogDescription className="break-words">{patient.name} · Immediate reviewed move within the same admission</DialogDescription></DialogHeader><div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">{body}</div><DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={controller.busy} onClick={() => query.refetch()}>Refresh current placement</Button><Button type="button" variant="outline" disabled={controller.busy} onClick={close}>Close move</Button></DialogFooter></DialogContent></Dialog>;
}
function Authorized(props) {
  const [denied, setDenied] = useState(false), [generation, setGeneration] = useState(0), onDenied = useCallback(() => setDenied(true), []);
  return denied ? <Unavailable open={props.open} onClose={props.onClose} onRetry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <Workspace key={generation} {...props} onDenied={onDenied} />;
}
function SelectedMove(props) {
  const { access, patient } = props, requested = props.requestedAdmissionId;
  const [retained, setRetained] = useState(null);
  useLayoutEffect(() => { if (props.open && validId(requested)) setRetained(requested); }, [props.open, requested]);
  const caseId = requested || retained || (!props.allHistory ? props.selectedAdmissionId : null);
  if (!validId(caseId)) return <Unavailable open={props.open} onClose={props.onClose} selection />;
  return <Authorized key={caseId} {...props} {...{ access, patient, caseId }} />;
}
export default function AdmissionMovePanel(props) {
  const access = useMoveAccess(), id = props.patient?.local_data?.id || props.patient?.id;
  if (!access.canRead || !validId(id)) return <Unavailable open={props.open} onClose={props.onClose} />;
  const patient = { id, name: props.patient?.name || [props.patient?.first_name, props.patient?.last_name].filter(Boolean).join(' ') || 'Patient' };
  return <SelectedMove key={JSON.stringify([access.scope, id, props.selectedAdmissionId, props.allHistory])} {...props} {...{ access, patient }} />;
}
