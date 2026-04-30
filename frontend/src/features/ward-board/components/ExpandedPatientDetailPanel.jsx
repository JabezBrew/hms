import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useWardBoardPatient } from '@/features/ward-board/hooks';
import { AuditEventTimeline } from './AuditEventTimeline';
import { TaskActionControls } from './TaskActionControls';
import {
  TASK_STATUS_STYLES,
  URGENCY_STYLES,
  formatTimestamp,
  getPatientDischargeItems,
  getPatientEvents,
  getPatientId,
  getPatientResults,
  getPatientTasks,
  getTaskStatus,
  getTaskTitle,
  getTaskUrgency,
  patientChronicleHref,
} from './wardBoardUtils';

function DetailSection({ title, count, children }) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-heading text-sm font-semibold text-foreground">{title}</h3>
        <span className="font-mono text-[11px] text-muted-foreground">{count}</span>
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ children }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/70 px-3 py-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function TaskList({ tasks, patientId, onTaskAction, pendingAction }) {
  if (tasks.length === 0) {
    return <EmptyLine>No active operational tasks</EmptyLine>;
  }

  return (
    <div className="space-y-2">
      {tasks.slice(0, 5).map((task, index) => {
        const status = getTaskStatus(task);
        const urgency = getTaskUrgency(task);
        return (
          <div key={task?.id ?? task?.task_id ?? index} className="rounded-lg border border-border bg-background/70 p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{getTaskTitle(task)}</p>
                  <Badge variant="outline" className={cn('font-mono text-[10px]', TASK_STATUS_STYLES[status] ?? URGENCY_STYLES[urgency] ?? TASK_STATUS_STYLES.pending)}>
                    {status}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground">
                  <span>{formatTimestamp(task?.due_at ?? task?.due_time ?? task?.target_time)}</span>
                  {task?.assignee_name || task?.assigned_to ? <span>{task.assignee_name ?? task.assigned_to}</span> : null}
                </div>
              </div>
              <TaskActionControls
                task={task}
                patientId={patientId}
                onAction={onTaskAction}
                pendingAction={pendingAction}
                className="xl:justify-end"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResultList({ results }) {
  if (results.length === 0) {
    return <EmptyLine>No pending result summaries</EmptyLine>;
  }

  return (
    <div className="space-y-2">
      {results.slice(0, 4).map((result, index) => {
        const status = String(result?.status ?? result?.state ?? 'pending').toLowerCase();
        const tone = result?.is_critical || status === 'critical' ? URGENCY_STYLES.critical : URGENCY_STYLES.info;
        return (
          <div key={result?.id ?? index} className="rounded-lg border border-border bg-background/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">
                {result?.name ?? result?.test_name ?? result?.panel ?? 'Result summary'}
              </p>
              <Badge variant="outline" className={cn('font-mono text-[10px]', tone)}>
                {status}
              </Badge>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {formatTimestamp(result?.reported_at ?? result?.created_at ?? result?.ordered_at)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function DischargeList({ items }) {
  if (items.length === 0) {
    return <EmptyLine>No discharge blockers listed</EmptyLine>;
  }

  return (
    <div className="space-y-2">
      {items.slice(0, 4).map((item, index) => (
        <div key={item?.id ?? item?.key ?? index} className="rounded-lg border border-border bg-background/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              {item?.title ?? item?.label ?? item?.summary ?? 'Discharge item'}
            </p>
            <Badge variant="outline" className={cn('font-mono text-[10px]', URGENCY_STYLES[String(item?.status ?? 'pending').toLowerCase()] ?? URGENCY_STYLES.moderate)}>
              {item?.status ?? 'pending'}
            </Badge>
          </div>
          {item?.owner || item?.due_at ? (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {[item.owner, item.due_at ? formatTimestamp(item.due_at) : null].filter(Boolean).join(' - ')}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ExpandedPatientDetailPanel({ patient, onTaskAction, pendingAction }) {
  const patientId = getPatientId(patient);
  const { data, isLoading, isError, error } = useWardBoardPatient(patientId);
  const detail = data && typeof data === 'object' ? { ...patient, ...data } : patient;
  const tasks = getPatientTasks(detail);
  const results = getPatientResults(detail);
  const dischargeItems = getPatientDischargeItems(detail);
  const events = getPatientEvents(detail);

  return (
    <div className="border-t border-border bg-muted/20 px-4 py-4 sm:px-5">
      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      ) : null}

      {isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
          {error?.message || 'Unable to load patient board details.'}
        </div>
      ) : null}

      {!isLoading ? (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase text-muted-foreground">Operational view</p>
              <p className="text-sm text-muted-foreground">Task, result, and discharge summaries only.</p>
            </div>
            <Button asChild variant="outline" size="sm" className="w-fit font-mono text-xs">
              <Link to={patientChronicleHref(detail)}>
                Patient Chronicle
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <DetailSection title="Tasks" count={tasks.length}>
              <TaskList
                tasks={tasks}
                patientId={patientId}
                onTaskAction={onTaskAction}
                pendingAction={pendingAction}
              />
            </DetailSection>
            <DetailSection title="Results" count={results.length}>
              <ResultList results={results} />
            </DetailSection>
            <DetailSection title="Discharge" count={dischargeItems.length}>
              <DischargeList items={dischargeItems} />
            </DetailSection>
          </div>

          <DetailSection title="Audit Timeline" count={events.length}>
            <AuditEventTimeline events={events} />
          </DetailSection>
        </div>
      ) : null}
    </div>
  );
}
