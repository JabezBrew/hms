import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import MoreVertical from 'lucide-react/dist/esm/icons/ellipsis-vertical.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function ScheduleCard({ schedule, canMutate = true, onEdit, onDelete }) {
  return (
    <div className="p-3 rounded-lg border border-border/50 hover:border-border bg-background/50 transition-colors mb-2">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-heading text-sm font-medium text-foreground truncate">{schedule.name}</h4>
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider',
                schedule.is_active
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {schedule.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {schedule.days_of_week.map((day) => (
              <span
                key={day}
                className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-mono rounded"
              >
                {DAY_NAMES[day]}
              </span>
            ))}
          </div>
          <p className="font-mono text-[10px] text-muted-foreground mt-2">
            {schedule.start_time} – {schedule.end_time} • {schedule.slot_duration}min slots
          </p>
        </div>
        {canMutate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0">
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[200]">
              <DropdownMenuItem onClick={onEdit} className="text-xs">
                <Edit className="size-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-xs text-destructive">
                <Trash2 className="size-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
