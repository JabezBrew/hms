import { taskRoutingKnown } from '@/features/nursing/records/taskRouting';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AuthContext } from '@/lib/auth/AuthContext';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { userHasCapability } from '@/shared/lib/access';
import { useChronicleClinicalPermissions } from '@/features/patients/chronicle/clinicalPermissions';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useWardBoardPatient } from '@/features/ward-board/hooks';
import { TaskActionControls } from './TaskActionControls';
import {
  TASK_STATUS_STYLES,
  URGENCY_STYLES,
  formatTime,
  formatTimestamp,
  getPatientDischargeCount,
  getPatientDueMedicationCount,
  getPatientId,
  getPatientOverdueTaskCount,
  getPatientPendingLabOrderCount,
  getPatientResultCount,
  getPatientTasks,
  getTaskCategory,
  getTaskOwner,
  getTaskPriority,
  getTaskStatus,
  getTaskTitle,
  isAcknowledged,
  isTerminalTask,
  patientChronicleHref,
} from './wardBoardUtils';

const ACK_STYLES = {
  acked: 'font-mono text-[10px] text-sky-600',
  unacked: 'font-mono text-[10px] text-rose-600',
  seen: 'font-mono text-[10px] text-muted-foreground',
};

const PATIENT_CHRONICLE_QUICK_ACTIONS = [
  { label: 'Vitals', action: 'vitals' },
  { label: 'Fluids', action: 'fluids' },
  { label: 'Treatment Sheet', action: 'treatment_sheet' },
  { label: 'Medication History', action: 'medication_history' },
];

function patientChronicleActionHref(patient, action) {
  const href = patientChronicleHref(patient);
  if (!href || href === '/patients') {
    return href;
  }

  const [pathname, search = ''] = href.split('?');
  const params = new URLSearchParams(search);
  params.set('action', action);
  const admissionId = patient?.admission_id || patient?.admission_case_id || patient?.current_admission_id;
  if (admissionId) {
    params.set('admission', String(admissionId));
  }
  return `${pathname}?${params.toString()}`;
}

function TaskTable({ tasks, patientId, currentWardId, onTaskAction, pendingAction }) {
  const [requestedPage, setPage] = useState(1);
  const rust = isRustV2ApiMode();
  const pages = Math.max(1, Math.ceil(tasks.length / 8));
  const page = Math.min(requestedPage, pages);
  if (tasks.length === 0) {
    return (
      <p className="px-1 py-3 font-mono text-xs text-muted-foreground">{rust ? 'No nursing tasks in your authorized admission scope' : 'No active operational tasks'}</p>
    );
  }
  return (
    <div className="space-y-3"><div className="overflow-x-auto">
      <table className="w-full min-w-[600px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {(rust ? ['Category', 'Task / Action', 'Owner', 'Due', 'Status', 'Actions'] : ['Category', 'Task / Action', 'Priority', 'Owner', 'Due', 'Status', 'Ack', 'Actions']).map((h) => (
              <th key={h} className="px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.slice((page - 1) * 8, page * 8).map((task, index) => {
            const status = getTaskStatus(task);
            const priority = getTaskPriority(task);
            const acked = isAcknowledged(task);
            const terminal = isTerminalTask(task);
            const isOverdue = status === 'overdue' || Boolean(task?.is_overdue);
            const routingKnown = !rust || taskRoutingKnown(task);
            const earlierWard = rust && currentWardId && routingKnown && task.service_ward_id !== currentWardId;
            const movedFromOrigin = rust && routingKnown && task.ward_id !== task.service_ward_id;
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
                  {!routingKnown && <p className="mt-1 text-xs text-muted-foreground">Task routing could not be confirmed. Refresh before a decision.</p>}
                  {movedFromOrigin && <p className="mt-1 text-xs text-muted-foreground">{earlierWard ? 'Origin and responsibility wards differ.' : 'Created in another ward. Responsibility is now in this ward.'}</p>}
                  {earlierWard && <p className="mt-1 text-xs text-muted-foreground">Responsibility is in another ward</p>}
                </td>
                {!rust && <td className="px-3 py-2">
                  <Badge
                    variant="outline"
                    className={cn('font-mono text-[10px] capitalize', URGENCY_STYLES[priority] ?? URGENCY_STYLES.pending)}
                  >
                    {priority}
                  </Badge>
                </td>}
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
                {!rust && <td className="px-3 py-2">
                  {terminal ? null : (
                    <span className={cn(acked ? ACK_STYLES.acked : ACK_STYLES.unacked)}>
                      {acked ? '● Acked' : '● Unacked'}
                    </span>
                  )}
                </td>}
                <td className="px-3 py-2">
                  <TaskActionControls
                    task={task}
                    patientId={patientId}
                    onAction={onTaskAction}
                    pendingAction={pendingAction}
                    canComplete={routingKnown && !earlierWard}
                    canCancel={routingKnown}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>{pages > 1 && <nav aria-label="Nursing task pages" className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{(page - 1) * 8 + 1}–{Math.min(page * 8, tasks.length)} of {tasks.length} visible tasks</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous tasks</Button><Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>Next tasks</Button></div></nav>}</div>
  );
}

function SignalCard({ label, value, meta, tone = 'info' }) {
  const toneClassName = URGENCY_STYLES[tone] ?? URGENCY_STYLES.info;
  return (
    <div className="rounded-md border border-border/70 bg-card px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {meta ? (
        <Badge variant="outline" className={cn('mt-1 font-mono text-[10px]', toneClassName)}>
          {meta}
        </Badge>
      ) : null}
    </div>
  );
}

function BoardSignals({ patient }) {
  const criticalAlerts = Number(patient?.critical_alert_count ?? 0);
  const activeAlerts = Number(patient?.active_alert_count ?? 0);
  const overdueTasks = getPatientOverdueTaskCount(patient);
  const dueMeds = getPatientDueMedicationCount(patient);
  const results = getPatientResultCount(patient);
  const criticalResults = Number(patient?.critical_unverified_result_count ?? 0);
  const labOrders = getPatientPendingLabOrderCount(patient);
  const dischargeBlockers = getPatientDischargeCount(patient);
  const lastObs = patient?.last_vitals_recorded_at ?? patient?.last_obs_at;

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <SignalCard
        label="Nursing alerts"
        value={activeAlerts}
        meta={criticalAlerts > 0 ? `${criticalAlerts} critical` : null}
        tone={criticalAlerts > 0 ? 'critical' : 'moderate'}
      />
      <SignalCard label="Fluid conditions" value={Number(patient?.fluid_condition_count ?? 0)} meta={Number(patient?.fluid_critical_count ?? 0) > 0 ? 'Critical daily balance' : 'Effective UTC day'} tone={Number(patient?.fluid_critical_count ?? 0) > 0 ? 'critical' : 'moderate'} />
      <SignalCard
        label="Due Meds"
        value={dueMeds}
        meta={patient?.next_due_medication_at ? formatTime(patient.next_due_medication_at) : null}
        tone={dueMeds > 0 ? 'high' : 'stable'}
      />
      <SignalCard
        label="Results"
        value={results}
        meta={criticalResults > 0 ? `${criticalResults} critical` : labOrders > 0 ? `${labOrders} orders` : null}
        tone={criticalResults > 0 ? 'critical' : 'info'}
      />
      <SignalCard
        label="Discharge"
        value={dischargeBlockers}
        meta={patient?.discharge_status || null}
        tone={dischargeBlockers > 0 ? 'moderate' : 'stable'}
      />
      <SignalCard
        label="Overdue Tasks"
        value={overdueTasks}
        meta={patient?.next_nursing_task_due_at ? formatTime(patient.next_nursing_task_due_at) : null}
        tone={overdueTasks > 0 ? 'critical' : 'stable'}
      />
      <SignalCard
        label="Last Obs"
        value={lastObs ? formatTimestamp(lastObs) : '—'}
      />
    </div>
  );
}

export function ExpandedPatientDetailPanel({ patient, onTaskAction, pendingAction }) {
  const patientId = getPatientId(patient);
  const admissionId = patient?.admission_id || patient?.admission_case_id || patient?.current_admission_id;
  const user = useContext(AuthContext)?.user;
  const permissions = useChronicleClinicalPermissions();
  const access = useReadOnlyMode({ optional: true });
  const canReadTasks = !isRustV2ApiMode() || Boolean(permissions.can_view_full_clinical
    && userHasCapability(user, 'nursing.task.manage') && user?.accessContext?.features?.includes('nursing') === true);
  const canDecideTasks = !isRustV2ApiMode() || (canReadTasks && access?.canWrite() === true);
  const { data, isLoading, isError, error } = useWardBoardPatient(patientId, { admissionId, enabled: canReadTasks });
  const detail = canReadTasks && !isError && data && typeof data === 'object' ? { ...patient, ...data } : patient;
  const tasks = canReadTasks && !isError ? getPatientTasks(detail) : [];

  return (
    <div className="bg-background">
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
        <div className="grid gap-0">
          <div className="min-w-0 space-y-4 p-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-heading text-sm font-semibold text-foreground">
                  Patient Work
                </h3>
                <Link
                  to={patientChronicleHref(detail)}
                  className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-amber-700"
                >
                  Patient Chronicle
                  <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {PATIENT_CHRONICLE_QUICK_ACTIONS.map((item) => (
                  <Link
                    key={item.action}
                    to={patientChronicleActionHref(detail, item.action)}
                    className="rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-amber-300 hover:text-amber-700"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
              {!canReadTasks ? <p className="text-sm text-muted-foreground">Task details require full clinical access and nursing permission.</p> : !isError && <TaskTable
                key={`${patientId}:${admissionId}`}
                tasks={tasks}
                patientId={patientId}
                currentWardId={patient?.ward_id}
                onTaskAction={canDecideTasks ? onTaskAction : undefined}
                pendingAction={pendingAction}
              />}
            </div>

            <div>
              <h3 className="mb-2 font-heading text-sm font-semibold text-foreground">Board Signals</h3>
              <BoardSignals patient={detail} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
