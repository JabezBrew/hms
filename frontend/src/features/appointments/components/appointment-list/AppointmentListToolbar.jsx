import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AppointmentListToolbar({
  filtersState,
  onCreateAppointment,
  onSearchChange,
  onToggleFilters,
  search,
}) {
  const { hasActiveFilters, showFilters } = filtersState;

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search appointments..."
          className="pl-10 font-mono text-sm"
          value={search}
          onChange={onSearchChange}
        />
      </div>

      <Button
        variant="outline"
        onClick={onToggleFilters}
        className={cn('font-mono text-xs', hasActiveFilters && 'border-primary text-primary')}
        aria-expanded={showFilters}
      >
        <Filter className="mr-2 size-4" />
        Filters
        {hasActiveFilters && <span className="ml-2 size-2 rounded-full bg-primary" />}
      </Button>

      <Button onClick={onCreateAppointment} className="font-mono text-xs">
        <Plus className="mr-2 size-4" />
        New Appointment
      </Button>
    </div>
  );
}
