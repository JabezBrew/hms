import { useCallback, useLayoutEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTreatmentAccess } from './useTreatmentAccess';
import { useTreatmentCommand } from './useTreatmentCommand';
import { useTreatmentContext, useTreatmentCourses, useTreatmentDetail } from './hooks';
import { useCourseDraft } from './useCourseDraft';
import { label, patientIdentity, uuid } from './model';
import { CourseWorkspaceBrowser, CourseWorkspaceDetails } from './CourseWorkspacePanes';
import { useCourseActionReview } from './useCourseActionReview';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';

function Unavailable({ open, onClose, onRetry, selection = false }) {
  if (!open) return null;
  return <Dialog open onOpenChange={(next) => { if (!next) onClose?.(); }}><DialogContent><DialogHeader><DialogTitle>{selection ? 'Choose an admission' : 'Medication courses unavailable'}</DialogTitle><DialogDescription>{selection ? 'Select an admission in Patient Chronicle to review its generated medication courses. All history and outpatient selections do not choose a current stay automatically.' : 'Current full clinical access, nursing workflow, patient relationship and selected-ward access could not be confirmed. Earlier clinical content is hidden.'}</DialogDescription></DialogHeader><DialogFooter>{onRetry && <Button type="button" variant="outline" onClick={onRetry}>Recheck current access</Button>}<Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogFooter></DialogContent></Dialog>;
}
function Workspace({ open, onClose, patient, caseId, access, onDenied, onReviewPrescriptions, onReviewMar }) {
  const scope = { patientId: patient.id, caseId }; const [courseId, setCourseId] = useState(null); const [filters, setFilters] = useState({}); const [cursors, setCursors] = useState([null]); const [selection, setSelection] = useState(null);
  const [membershipRequest, setMembershipRequest] = useState(null); const [historyTab, setHistoryTab] = useState('doses'); const draft = useCourseDraft();
  const context = useTreatmentContext(scope, access.scope, open);
  const contextReady = context.isFetchedAfterMount && !context.isError && Boolean(context.data);
  const cursor = cursors.at(-1); const list = useTreatmentCourses(scope, access.scope, { limit: 25, ...filters, ...(cursor ? { cursor } : {}) }, open && contextReady);
  const detailScope = { ...scope, courseId }; const detail = useTreatmentDetail(detailScope, access.scope, open && contextReady);
  const controller = useTreatmentCommand(scope, access.scope, onDenied);
  const denied = [context.error, list.error, detail.error].some((error) => error?.status === 403);
  useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  const detailReady = detail.isFetchedAfterMount && !detail.isFetching && !detail.isError && Boolean(detail.data);
  const freshManage = access.canWrite && contextReady && context.data.can_manage_courses && !context.isFetching && detailReady && !detail.isFetching && context.data.context_token === detail.data.context_token;
  const close = () => { if (!controller.busy) onClose(); };
  const clearAction = () => { if (controller.busy || controller.unknown) return; controller.reset(); draft.reset(); setSelection(null); setMembershipRequest(null); void context.refetch(); if (courseId) void detail.refetch(); };
  const review = useCourseActionReview({ open, proof: hashQueryValue(JSON.stringify([access.scope, patient.id, caseId])), context, detail, canStart: freshManage && !controller.locked, onDenied, onBegin: (selection) => { draft.reset(); setMembershipRequest(null); setSelection(selection); } });
  const { reviewing, error: reviewError, start } = review;
  const select = (id) => { if (reviewing || selection || controller.locked) return; setCourseId(id); setMembershipRequest(null); setHistoryTab('doses'); };
  const reviewPrescriptions = () => { if (!controller.busy && !controller.unknown) onReviewPrescriptions?.(); };
  const reviewMar = () => { if (!controller.busy && !controller.unknown) onReviewMar?.(); };
  const refresh = () => { void context.refetch(); if (courseId) void detail.refetch(); };
  if (denied) return <Unavailable {...{ open, onClose }} />;
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-6xl" onEscapeKeyDown={(event) => { if (controller.busy) event.preventDefault(); }} onInteractOutside={(event) => { if (controller.busy) event.preventDefault(); }}><DialogHeader><DialogTitle>Admission medication courses</DialogTitle><DialogDescription>{patient.name} · {patient.code}{contextReady ? ` · ${context.data.current_ward_name} · ${label(context.data.admission_status)}` : ' · Selected admission'}</DialogDescription></DialogHeader>
    <div className="grid min-h-0 min-w-0 flex-1 gap-5 overflow-y-auto pr-1 lg:grid-cols-[minmax(14rem,0.7fr)_minmax(0,1.6fr)]">
      <CourseWorkspaceBrowser {...{ context, contextReady, access }} listProps={{ query: list, filters, selectedId: courseId, cursors, locked: reviewing || Boolean(selection) || controller.locked, onFilter: (key, value) => { setFilters((old) => { const next = { ...old }; if (value === 'all') delete next[key]; else next[key] = value; return next; }); setCursors([null]); setCourseId(null); }, onSelect: select, onPrevious: () => setCursors((old) => old.slice(0, -1)), onNext: () => setCursors((old) => [...old, list.data.next]), onReviewPrescriptions: reviewPrescriptions }} />
      <div className="grid min-w-0 content-start gap-5">
        {reviewError && <p role="alert" className="text-sm text-destructive">{reviewError}</p>}
        {reviewing && <p role="status">Refreshing the admission and source course before review…</p>}
        <CourseWorkspaceDetails {...{ context, contextReady, detail, detailReady, selection, controller, patient, scope, detailScope, access, draft, membershipRequest, historyTab, onDenied, reviewing }} enabled={open && contextReady} canManage={freshManage} onHistoryTab={setHistoryTab} onStart={start} onDiscard={clearAction} onReviewMembership={() => { setMembershipRequest(controller.saved.client_request_id); setHistoryTab('doses'); }} onReviewPrescriptions={reviewPrescriptions} onReviewMar={onReviewMar ? reviewMar : null} />
      </div>
    </div><DialogFooter className="shrink-0 flex-wrap border-t pt-4"><p className="mr-auto text-xs text-muted-foreground">Admission course and source prescription are separate. Dates and schedule cutoffs use UTC.</p><Button type="button" variant="outline" disabled={controller.busy || reviewing} onClick={refresh}>Refresh current access and course</Button><Button type="button" variant="outline" disabled={controller.busy} onClick={close}>Close medication courses</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function AuthorizedPanel(props) {
  const [denied, setDenied] = useState(false); const [generation, setGeneration] = useState(0); const onDenied = useCallback(() => setDenied(true), []);
  return denied ? <Unavailable open={props.open} onClose={props.onClose} onRetry={() => { setGeneration((value) => value + 1); setDenied(false); }} /> : <Workspace key={generation} {...props} onDenied={onDenied} />;
}
export default function TreatmentCoursesPanel(props) {
  const patient = patientIdentity(props.patient); const access = useTreatmentAccess(props.clinicalPermissions);
  if (!access.canRead || !uuid(patient.id)) return <Unavailable open={props.open} onClose={props.onClose} />;
  if (props.allHistory || !uuid(props.selectedAdmissionId)) return <Unavailable open={props.open} onClose={props.onClose} selection />;
  return <AuthorizedPanel key={JSON.stringify([access.scope, patient.id, props.selectedAdmissionId])} {...props} {...{ patient, access }} caseId={props.selectedAdmissionId} />;
}
