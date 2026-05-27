import PlusCircle from 'lucide-react/dist/esm/icons/circle-plus.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import {
  formatEncounterDate,
  getEncounterStatusConfig,
  getEncounterTypeConfig,
} from './encounterListUtils';

const ENCOUNTER_COLUMNS = [
  {
    key: 'patient',
    header: 'Patient',
    width: '240px',
    render: (encounter) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{encounter.patient_name || 'Unknown Patient'}</p>
        <p className="truncate text-xs text-muted-foreground">{encounter.id || 'Encounter'}</p>
      </div>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    width: '140px',
    render: (encounter) => (
      <Badge variant="outline" className="text-xs">
        {getEncounterTypeConfig(encounter.encounter_type).label}
      </Badge>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: '140px',
    render: (encounter) => {
      const statusConfig = getEncounterStatusConfig(encounter.status);
      return (
        <Badge variant="outline" className={cn('text-xs', statusConfig.className)}>
          {statusConfig.label}
        </Badge>
      );
    },
  },
  {
    key: 'practitioner',
    header: 'Practitioner',
    width: '220px',
    render: (encounter) => (
      <span className="truncate text-sm text-muted-foreground">
        {encounter.practitioner_name || 'Unassigned'}
      </span>
    ),
  },
  {
    key: 'start_time',
    header: 'Scheduled',
    width: '180px',
    render: (encounter) => (
      <span className="font-mono text-sm text-muted-foreground">
        {formatEncounterDate(encounter.start_time)}
      </span>
    ),
  },
  {
    key: 'location',
    header: 'Location',
    width: '180px',
    render: (encounter) => (
      <span className="truncate text-sm text-muted-foreground">
        {encounter.location || '—'}
      </span>
    ),
  },
];

export function EncounterTable({ encounters, isLoading, onCreateEncounter, onOpenEncounter }) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, index) => (
          <Skeleton key={index} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (encounters.length === 0) {
    return (
      <div className={cn(
        "bg-card/50 border border-border rounded-2xl p-12 text-center",
        "animate-chronicle-enter"
      )}>
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <FileText className="size-8 text-muted-foreground" />
        </div>
        <h3 className="font-display text-xl text-foreground mb-2">No Encounters Found</h3>
        <p className="text-muted-foreground text-sm mb-6">
          No encounters match your current filters.
        </p>
        <Button onClick={onCreateEncounter} className="font-mono text-xs">
          <PlusCircle className="size-4 mr-2" />
          Create New Encounter
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={encounters}
        rowKey={(encounter) => encounter.id}
        rowHeight={68}
        columns={ENCOUNTER_COLUMNS}
        onRowClick={onOpenEncounter}
        rowClassName="hover:bg-muted/30"
        className="min-w-[1100px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}
