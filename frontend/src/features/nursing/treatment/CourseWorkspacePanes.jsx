import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CourseActions } from './CourseActions';
import { CourseDetail } from './CourseDetail';
import { CourseHistory } from './CourseHistory';
import { CourseList } from './CourseList';
import { UNAVAILABLE } from './model';

export function CourseWorkspaceBrowser({ context, contextReady, listProps, access }) {
  let content;
  if (context.isError) content = <div className="grid gap-3"><p role="alert">The selected admission could not be confirmed. Clinical course content is unavailable.</p><Button type="button" variant="outline" onClick={() => context.refetch()}>Reload selected admission</Button></div>;
  else if (!contextReady) content = <p role="status">Confirming selected admission access…</p>;
  else content = <><CourseList {...listProps} generatedCount={context.data.generated_course_count} />{!context.data.can_manage_courses && <p className="text-sm text-muted-foreground">{UNAVAILABLE[context.data.management_unavailable_reason] || 'Current access permits course review only.'}</p>}</>;
  return <div className="grid min-w-0 content-start gap-4">{content}{!access.canWrite && <Alert><AlertDescription>{access.readonlyMessage || 'Changes require current prescribing permission and confirmed network write access.'}</AlertDescription></Alert>}</div>;
}
function CurrentAccessPending({ context, controller }) {
  return <div className="grid gap-3 rounded-xl border p-4 text-sm">{controller.saved && <p role="status">The original course change is confirmed. Its saved result remains retained while current admission access is checked.</p>}{controller.unknown && <p>A prior course change may already be recorded. Its unchanged request is retained.</p>}<p>{context.isError ? 'Current admission access could not be confirmed. Earlier clinical details are hidden.' : 'Confirming the selected admission and current clinical access…'}</p>{context.isError && <Button type="button" variant="outline" onClick={() => context.refetch()}>Recheck admission access</Button>}</div>;
}
export function CourseWorkspaceDetails({ context, contextReady, detail, detailReady, selection, controller, patient, scope, detailScope, access, draft, membershipRequest, historyTab, onHistoryTab, onReviewMembership, onDiscard, onDenied, enabled, canManage, onStart, onReviewMar, onReviewPrescriptions, reviewing }) {
  if (!contextReady) return <CurrentAccessPending {...{ context, controller }} />;
  if (selection) return <><CourseActions key={`${selection.kind}:${selection.source.summary.id}`} {...{ selection, controller, patient, scope, draft, onDiscard, onReviewMembership }} actorId={access.user.id} currentContext={context.data} currentSource={detailReady ? detail.data : null} canWrite={access.canWrite && !context.isFetching && (controller.unknown || !detail.isFetching)} />{membershipRequest && <CourseHistory key={membershipRequest} kind="doses" scope={{ ...scope, courseId: selection.source.summary.id }} proof={access.scope} {...{ enabled, onDenied }} requestId={membershipRequest} />}</>;
  if (!detailScope.courseId) return <p className="rounded-xl border p-5 text-sm text-muted-foreground">Choose a generated course to review its regimen, whole-course dose records and pharmacy demand.</p>;
  if (detail.isError) return <div className="grid gap-3"><p role="alert">Current course details could not be confirmed. Earlier copied details are unavailable.</p><Button type="button" variant="outline" onClick={() => detail.refetch()}>Reload current course</Button></div>;
  if (!detailReady) return <p role="status">Loading current course details…</p>;
  return <CourseDetail source={detail.data} scope={detailScope} proof={access.scope} {...{ enabled, onDenied, historyTab, membershipRequest, onHistoryTab, onStart, onReviewMar }} canWrite={canManage} onReviewPrescription={onReviewPrescriptions} locked={controller.locked || reviewing} />;
}
