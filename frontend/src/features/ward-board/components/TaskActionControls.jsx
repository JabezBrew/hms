import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getTaskId, getTaskStatus, isTerminalTask } from './wardBoardUtils';

const ACTIONS = [
  { action: 'acknowledge', label: 'Ack', icon: Check },
  { action: 'assign', label: 'Assign', icon: UserPlus },
  { action: 'complete', label: 'Done', icon: CheckCircle2 },
  { action: 'escalate', label: 'Escalate', icon: ArrowUpRight },
];

export function TaskActionControls({
  task,
  patientId,
  onAction,
  pendingAction,
  className,
}) {
  const taskId = getTaskId(task);
  const status = getTaskStatus(task);
  const terminal = isTerminalTask(task);

  if (!taskId) {
    return null;
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} aria-label="Task actions">
      {ACTIONS.map((item) => {
        const Icon = item.icon;
        const isPending = pendingAction?.taskId === taskId && pendingAction?.action === item.action;
        const disabled = terminal || isPending;
        return (
          <Button
            key={item.action}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onAction({ taskId, action: item.action, patientId })}
            className={cn(
              'h-6 px-2 font-mono text-[10px]',
              item.action === 'escalate' && 'border-rose-200 text-rose-700 hover:bg-rose-50',
              item.action === 'complete' && 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
              item.action === 'acknowledge' && 'border-sky-200 text-sky-700 hover:bg-sky-50',
            )}
            title={`${item.label} task (${status})`}
          >
            <Icon className="size-3" aria-hidden="true" />
            <span>{isPending ? '…' : item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
