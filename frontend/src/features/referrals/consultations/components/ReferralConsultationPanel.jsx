import { lazy, Suspense, useCallback, useLayoutEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConsultationButton as Button } from './ConsultationButton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useConsultationAccess } from '../hooks/useConsultationAccess';
import { useConsultationContext } from '../hooks/queries';
import { useConsultationCommand } from '../hooks/useConsultationCommand';
import { useLinkedConsultationNote } from '../hooks/useLinkedConsultationNote';
import { consultationKeys } from '../keys';
import { validId, unavailableCopy } from '../model';
import { LinkEvidence } from './ConsultationEvidence';
import { ConsultationResult } from './ConsultationResult';
import { ManualConsultationReview } from './ManualConsultationReview';
import { StartComposer } from './StartComposer';

const ClinicalNoteWorkspace = lazy(() => import('@/features/clinical-notes/components/ClinicalNoteWorkspace'));
function Unavailable({ open, onClose, onRetry, selection = false }) {
  if (!open) return null;
  return <Dialog open onOpenChange={next => { if (!next) onClose?.(); }}><DialogContent><DialogHeader><DialogTitle>{selection ? 'Select an exact referral' : 'Consultation unavailable'}</DialogTitle><DialogDescription>{selection ? 'Open a specific referral from the referral inbox. No active or latest referral is selected automatically.' : 'Current patient clinical access and the exact referral relationship could not be confirmed. Protected consultation content and local copies are hidden.'}</DialogDescription></DialogHeader><DialogFooter>{onRetry && <Button type="button" variant="outline" onClick={onRetry}>Reload current consultation access</Button>}<Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogFooter></DialogContent></Dialog>;
}
function CurrentConsultation({ current, scope, access, open, controller, onDenied, onRefresh, onOpenNote, onResponse, selectedEncounter, allHistory, preparationOnly }) {
  return <>
    <ManualConsultationReview {...{ scope, access, current, onDenied, onRefresh }} enabled={open && !controller.locked} />
    {current.link ? <><LinkEvidence link={current.link} /><p className="text-sm">Current encounter: {current.current_linked_encounter.status.replaceAll('_', ' ')}. Current referral: {current.referral.status}.</p>
      <Button type="button" variant="outline" disabled={preparationOnly || !current.can_resume} onClick={onOpenNote}>Open clinical note for linked encounter</Button>
      {preparationOnly ? <p className="text-sm text-muted-foreground">Clinical notes require freshly confirmed Chronicle access and independent documentation authority.</p> : !current.can_resume && <p className="text-sm text-muted-foreground">The linked encounter is unavailable for new clinical notes. The saved start remains historical evidence.</p>}
    </> : <StartComposer {...{ scope, access, controller, selectedEncounter, allHistory, onDenied, open }} baseContextToken={current.context_token} />}
    {onResponse && <Button type="button" variant="outline" disabled={controller.busy || controller.unknown} onClick={onResponse}>Review this referral response</Button>}
    {!access.canWrite && <p className="text-sm text-muted-foreground">Current access is read-only. A new consultation start cannot be submitted.</p>}
    {!current.link && !current.can_issue_start_command && <p className="text-sm text-muted-foreground">{unavailableCopy[current.unavailable_reason]}</p>}
  </>;
}
function Workspace({ open, onClose, patient, referralId, access, selectedEncounter, allHistory, onDenied, onResponse, onNoteCreated, preparationOnly, onRecorded }) {
  const client = useQueryClient();
  const scope = { patientId: patient.id, referralId };
  const query = useConsultationContext(scope, access.scope, null, open);
  const controller = useConsultationCommand(scope, access.scope, onDenied, onRecorded);
  const denied = query.error?.status === 403;
  useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  const ready = query.isFetchedAfterMount && !query.isError && Boolean(query.data);
  const current = ready ? query.data : null;
  const note = useLinkedConsultationNote({ query, current, accessScope: access.scope, locked: controller.locked, onDenied, enabled: !preparationOnly });
  const close = () => { if (!controller.busy) onClose?.(); };
  const refresh = () => client.invalidateQueries({ queryKey: consultationKeys.referral(access.scope, scope) });
  const reviewCurrent = async () => { const fresh = await query.refetch(); if (!fresh.error && fresh.data) { if (controller.saved) await onRecorded?.(); controller.reset(); } };
  if (denied) return <Unavailable {...{ open, onClose }} />;
  return <>
    <Dialog open={open && !(note.open && note.linked)} onOpenChange={next => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-3xl" onEscapeKeyDown={event => { if (controller.busy) event.preventDefault(); }} onInteractOutside={event => { if (controller.busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Referral consultation</DialogTitle><DialogDescription>{current ? <><span className="block break-words font-medium text-foreground">{current.patient.display_name}</span><span className="block break-words">Patient code {current.patient.patient_code} · {current.referral.to_service} · {current.referral.status}</span></> : 'Confirming the exact patient and selected referral'}</DialogDescription></DialogHeader>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
        <WorkspaceBody {...{ query, ready, current, scope, access, open, controller, onDenied, selectedEncounter, allHistory, refresh, reviewCurrent, preparationOnly }} onOpenNote={note.begin} onResponse={onResponse ? () => onResponse(referralId) : null} />
        {note.error && <p role="alert" className="text-sm text-destructive">{note.error}</p>}
        {note.opening && <p role="status">Confirming the exact linked encounter…</p>}
      </div>
      <DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4"><p className="mr-auto text-xs text-muted-foreground">Starting, clinical documentation and referral response are separate actions.</p><Button type="button" variant="outline" disabled={controller.busy} onClick={refresh}>Refresh current consultation</Button><Button type="button" variant="outline" disabled={controller.busy} onClick={close}>Close consultation</Button></DialogFooter>
    </DialogContent></Dialog>
    {!preparationOnly && note.linked && <Suspense fallback={null}><ClinicalNoteWorkspace patient={{ ...patient, name: current.patient.display_name }} encounter={current.current_linked_encounter} admissionId={current.link.admission_case_id} open={open && note.open} onClose={note.close} onNoteCreated={onNoteCreated} /></Suspense>}
  </>;
}
function WorkspaceBody(props) {
  if (props.query.isError) return <Alert variant="destructive"><AlertDescription>Current consultation evidence could not be confirmed. Cached content is hidden. Refresh before continuing.</AlertDescription></Alert>;
  if (!props.ready) return <p role="status">Confirming current consultation access…</p>;
  if (props.controller.saved || props.controller.unknown) return <ConsultationResult controller={props.controller} canRetry={props.access.canWrite && props.current.can_issue_start_command} onCurrent={props.reviewCurrent} />;
  return <CurrentConsultation {...props} onRefresh={props.refresh} />;
}
function AuthorizedPanel(props) {
  const [denied, setDenied] = useState(false), [generation, setGeneration] = useState(0); const onDenied = useCallback(() => setDenied(true), []);
  return denied ? <Unavailable open={props.open} onClose={props.onClose} onRetry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <Workspace key={generation} {...props} onDenied={onDenied} />;
}
function SelectedPanel(props) {
  const [retainedReferral, setRetainedReferral] = useState(() => validId(props.requestedReferralId) ? props.requestedReferralId : null);
  // A transient URL handoff is an external selection command. Ordinary closing
  // retains its controller; a different explicit referral switches immediately.
  useLayoutEffect(() => { if (props.open && validId(props.requestedReferralId)) setRetainedReferral(props.requestedReferralId); }, [props.open, props.requestedReferralId]);
  const referralId = props.open && validId(props.requestedReferralId) ? props.requestedReferralId : retainedReferral;
  return referralId ? <AuthorizedPanel key={referralId} {...props} referralId={referralId} /> : <Unavailable open={props.open} onClose={props.onClose} selection />;
}
export default function ReferralConsultationPanel(props) {
  const access = useConsultationAccess(props.preparationOnly === true); const id = props.patient?.local_data?.id || props.patient?.id;
  const patient = { id, name: props.patient?.name || [props.patient?.first_name, props.patient?.last_name].filter(Boolean).join(' ') || 'Patient' };
  if (!access.canRead || !validId(id)) return <Unavailable open={props.open} onClose={props.onClose} />;
  if (props.requestedReferralId != null && !validId(props.requestedReferralId)) return <Unavailable open={props.open} onClose={props.onClose} selection />;
  return <SelectedPanel key={JSON.stringify([access.scope, id])} {...props} {...{ access, patient }} />;
}
