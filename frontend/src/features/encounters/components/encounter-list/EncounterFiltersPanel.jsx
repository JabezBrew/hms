import X from 'lucide-react/dist/esm/icons/x.js';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';

export function EncounterFiltersPanel({
  activeTab,
  filters,
  hasActiveFilters,
  onFilterChange,
  onResetFilters,
}) {
  return (
    <div className={cn(
      "bg-card border border-border rounded-2xl p-6",
      "animate-chronicle-enter"
    )}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg text-foreground">Filter Encounters</h3>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetFilters}
            className="font-mono text-xs text-muted-foreground"
          >
            <X className="size-3 mr-1" />
            Clear All
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Patient
          </Label>
          <Input
            placeholder="Name or MRN..."
            value={filters.patient}
            onChange={(event) => onFilterChange('patient', event.target.value)}
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Practitioner
          </Label>
          <Input
            placeholder="Name or employee ID..."
            value={filters.practitioner}
            onChange={(event) => onFilterChange('practitioner', event.target.value)}
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Date
          </Label>
          <DatePicker
            date={filters.date}
            setDate={(date) => onFilterChange('date', date)}
            placeholder="Select date"
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Status
          </Label>
          <Select
            value={filters.status}
            onValueChange={(value) => onFilterChange('status', value)}
          >
            <SelectTrigger className="font-mono text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="finished">Finished</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {activeTab === 'all' && (
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Type
            </Label>
            <Select
              value={filters.type}
              onValueChange={(value) => onFilterChange('type', value)}
            >
              <SelectTrigger className="font-mono text-sm">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="inpatient">Inpatient</SelectItem>
                <SelectItem value="outpatient">Outpatient</SelectItem>
                <SelectItem value="emergency">Emergency</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
