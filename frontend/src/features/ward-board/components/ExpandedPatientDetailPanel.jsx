import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useWardBoardPatient } from '@/features/ward-board/hooks';
import { AuditEventTimeline } from './AuditEventTimeline';
import { TaskActionControls } from './TaskActionControls';
import {
  TASK_STATUS_STYLES,
  URGENCY_STYLES,
  formatTime,
  formatTimestamp,
  getPatientDischargeItems,
  getPatientEvents,
  getPatientId,
  getPatientResults,
  getPatientTasks,
  getTaskCategory,
  getTaskOwner,
  getTaskStatus,
  getTaskTitle,
  getTaskUrgency,
  isAcknowledged,
  isTerminalTask,
  patientChronicleHref,
} from './wardBoardUtils';

const ACK_STYLES = {
  acked: 'font-mono text-[10px] text-sky-600',
  unacked: 'font-mono text-[10px] text-rose-600',
  seen: 'font-mono text-[10px] text-muted-foreground',
};

function TaskTable({ tasks, patientId, onTaskAction, pendingAction }) {
  if (tasks.length === 0) {
    return (
      <p className="px-1 py-3 font-mono text-xs text-muted-foreground">No active operational tasks</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {['Category', 'Task / Action', 'Priority', 'Owner', 'Due', 'Status', 'Ack', 'Actions'].map((h) => (
              <th key={h} className="px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.slice(0, 8).map((task, index) => {
            const status = getTaskStatus(task);
            const urgency = getTaskUrgency(task);
            const acked = isAcknowledged(task);
            const terminal = isTerminalTask(task);
            const isOverdue = status === 'overdue' || Boolean(task?.is_overdue);
            return (
              <tr
                key={task?.id ?? task?.task_id ?? index}
                className={cn(
                  'border-b border-border/50 transition-colors last:border-0',
                  isOverdue ? 'bg-rose-50/40 dark:bg-rose-950/10' : 'hover:bg-muted/30'
                )}
              >
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  {getTaskCategory(task) ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <span className="text-sm font-medium text-foreground">{getTaskTitle(task)}</span>
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant="outline"
                    className={cn('font-mono text-[10px] capitalize', URGENCY_STYLES[urgency] ?? URGENCY_STYLES.pending)}
                  >
                    {urgency}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  {getTaskOwner(task) ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <span className={cn('font-mono text-[11px]', isOverdue ? 'text-rose-600' : 'text-muted-foreground')}>
                    {formatTime(task?.due_at ?? task?.due_time ?? task?.target_time) ?? '—'}
                    {isOverdue ? <span className="ml-1 block text-[10px] font-medium">Overdue</span> : null}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant="outline"
                    className={cn('font-mono text-[10px] capitalize', TASK_STATUS_STYLES[status] ?? TASK_STATUS_STYLES.pending)}
                  >
                    {status}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  {terminal ? null : (
                    <span className={cn(acked ? ACK_STYLES.acked : ACK_STYLES.unacked)}>
                      {acked ? '● Acked' : '● Unacked'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <TaskActionControls
                    task={task}
                    patientId={patientId}
                    onAction={onTaskAction}
                    pendingAction={pendingAction}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultRows({ results }) {
  if (results.length === 0) {
    return <p className="px-1 py-2 font-mono text-xs text-muted-foreground">No pending result summaries</p>;
  }
  return (
    <div className="space-y-1">
      {results.slice(0, 4).map((result, index) => {
        const status = String(result?.status ?? result?.state ?? 'pending').toLowerCase();
        const isCritical = result?.is_critical || status === 'critical';
        return (
          <div key={result?.id ?? index} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-1.5">
            <span className={cn('size-2 rounded-full shrink-0', isCritical ? 'bg-rose-500' : 'bg-sky-400')} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {result?.name ?? result?.test_name ?? result?.panel ?? 'Result'}
            </span>
            <Badge variant="outline" className={cn('shrink-0 font-mono text-[10px]', isCritical ? URGENCY_STYLES.critical : URGENCY_STYLES.info)}>
              {status}
            </Badge>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {formatTimestamp(result?.reported_at ?? result?.created_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DischargeRows({ items }) {
  if (items.length === 0) {
    return <p className="px-1 py-2 font-mono text-xs text-muted-foreground">No discharge blockers listed</p>;
  }
  return (
    <div className="space-y-1">
      {items.slice(0, 4).map((item, index) => (
        <div key={item?.id ?? item?.key ?? index} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {item?.title ?? item?.label ?? item?.summary ?? 'Discharge item'}
          </span>
          <Badge variant="outline" className={cn('shrink-0 font-mono text-[10px]', URGENCY_STYLES[String(item?.status ?? 'pending').toLowerCase()] ?? URGENCY_STYLES.moderate)}>
            {item?.status ?? 'pending'}
          </Badge>
          {item?.owner ? (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.owner}</span>
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
    <div className="border-t border-border bg-muted/10">
      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full rounded" />
          <Skeleton className="h-8 w-full rounded" />
          <Skeleton className="h-8 w-3/4 rounded" />
        </div>
      ) : null}

      {isError ? (
        <div className="px-4 py-3 font-mono text-xs text-rose-600">
          {error?.message || 'Unable to load patient board details.'}
        </div>
      ) : null}

      {!isLoading ? (
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-4 p-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-heading text-sm font-semibold text-foreground">
                  Active Tasks for this patient
                </h3>
                <Link
                  to={patientChronicleHref(detail)}
                  className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-amber-700"
                >
                  Patient Chronicle
                  <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              </div>
              <TaskTable
                tasks={tasks}
                patientId={patientId}
                onTaskAction={onTaskAction}
                pendingAction={pendingAction}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 font-heading text-sm font-semibold text-foreground">Pending Results</h3>
                <ResultRows results={results} />
              </div>
              <div>
                <h3 className="mb-2 font-heading text-sm font-semibold text-foreground">Discharge Blockers</h3>
                <DischargeRows items={dischargeItems} />
              </div>
            </div>
          </div>

          <div className="border-t border-border/60 p-4 lg:border-l lg:border-t-0">
            <h3 className="mb-3 font-heading text-sm font-semibold text-foreground">Audit Trail</h3>
            <AuditEventTimeline events={events} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
