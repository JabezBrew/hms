import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STATUS_OPTIONS = [
  ['all', 'All Statuses'],
  ['proposed', 'Proposed'],
  ['pending', 'Pending'],
  ['booked', 'Booked'],
  ['arrived', 'Arrived'],
  ['fulfilled', 'Fulfilled'],
  ['cancelled', 'Cancelled'],
  ['noshow', 'No Show'],
];

export function AppointmentListFilters({
  date,
  hasActiveFilters,
  onClearFilters,
  onDateChange,
  onStatusChange,
  status,
}) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-6', 'animate-chronicle-enter')}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg text-foreground">Filter Appointments</h3>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="font-mono text-xs text-muted-foreground"
          >
            <X className="mr-1 size-3" />
            Clear All
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <span className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Status
          </span>
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger
              aria-label="Filter appointments by status"
              className="w-[180px] font-mono text-sm"
            >
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <span className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Date
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-[180px] justify-start font-mono text-sm"
                aria-label="Filter appointments by date"
              >
                <CalendarIcon className="mr-2 size-4" />
                {date ? format(parseISO(date), 'MMM d, yyyy') : 'Select date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date ? parseISO(date) : undefined}
                onSelect={(nextDate) => onDateChange(nextDate ? format(nextDate, 'yyyy-MM-dd') : '')}
                initialFocus={true}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
