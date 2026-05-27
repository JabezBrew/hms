import Ban from 'lucide-react/dist/esm/icons/ban.js';
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

export function BlockedTimeCard({ blocked, canMutate = true, onEdit, onDelete }) {
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const isDateRange = blocked.start_date && blocked.end_date && blocked.start_date !== blocked.end_date;
  const isPast = new Date(blocked.end_date || blocked.date) < new Date();

  return (
    <div
      className={cn(
        'p-3 rounded-lg border border-border/50 hover:border-border bg-background/50 transition-colors mb-2',
        isPast && 'opacity-50',
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-rose-100 dark:bg-rose-900/30">
              <Ban className="size-3 text-rose-600 dark:text-rose-400" />
            </div>
            <h4 className="font-heading text-sm font-medium text-foreground truncate">
              {blocked.reason || 'Blocked'}
            </h4>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground mt-2">
            {isDateRange
              ? `${formatDate(blocked.start_date)} – ${formatDate(blocked.end_date)}`
              : formatDate(blocked.date || blocked.start_date)}
            {blocked.is_all_day ? ' • All Day' : ` • ${blocked.start_time} – ${blocked.end_time}`}
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
