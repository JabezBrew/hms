import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getTaskId, getTaskStatus, isTerminalTask } from './wardBoardUtils';

const ACTIONS = [
  { action: 'acknowledge', label: 'Ack', icon: Check },
  { action: 'complete', label: 'Done', icon: CheckCircle2 },
  { action: 'escalate', label: 'Escalate', icon: ArrowUpRight },
  { action: 'cancel', label: 'Cancel', icon: X },
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
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} aria-label="Task actions">
      {ACTIONS.map((item) => {
        const Icon = item.icon;
        const isPending = pendingAction?.taskId === taskId && pendingAction?.action === item.action;
        const disabled = terminal || isPending;
        return (
          <Button
            key={item.action}
            type="button"
            variant={item.action === 'cancel' ? 'ghost' : 'outline'}
            size="sm"
            disabled={disabled}
            onClick={() => onAction({ taskId, action: item.action, patientId })}
            className={cn(
              'h-7 px-2 font-mono text-[11px]',
              item.action === 'escalate' && 'border-rose-200 text-rose-700 hover:bg-rose-50',
              item.action === 'complete' && 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
            )}
            title={`${item.label} task (${status})`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isPending ? '...' : item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
