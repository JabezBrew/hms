import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import User from 'lucide-react/dist/esm/icons/user.js';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TimelineEntry } from '@/components/chronicle';
import { cn } from '@/lib/utils';
import { formatEncounterDate } from './encounterDetailUtils';

function EncounterInfoItem({ label, value, icon: Icon, className }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="text-sm sm:text-base text-foreground truncate">
        {value || <span className="text-muted-foreground">-</span>}
      </p>
    </div>
  );
}

function EncounterDetailsSection({ encounter }) {
  return (
    <section>
      <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
        <FileText className="size-5 text-muted-foreground" />
        Details
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
        <EncounterInfoItem
          label="Start Time"
          value={formatEncounterDate(encounter.start_time)}
          icon={Clock}
        />
        <EncounterInfoItem
          label="End Time"
          value={formatEncounterDate(encounter.end_time) || 'Ongoing'}
          icon={Clock}
        />
        <EncounterInfoItem
          label="Service Type"
          value={encounter.service_type}
          icon={Activity}
        />
        <EncounterInfoItem
          label="Reason"
          value={encounter.reason}
          icon={FileText}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {encounter.diagnosis && (
        <div className="mt-4 p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
          <h3 className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Diagnosis
          </h3>
          <p className="text-foreground">{encounter.diagnosis}</p>
        </div>
      )}
    </section>
  );
}

function EncounterTimelineSection({ isLoadingNotes, timelineEntries }) {
  return (
    <section>
      <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
        <Clock className="size-5 text-muted-foreground" />
        Clinical Notes
        {timelineEntries.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded ml-2">
            {timelineEntries.length}
          </span>
        )}
      </h2>

      {isLoadingNotes ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : timelineEntries.length === 0 ? (
        <div className="p-8 rounded-xl sm:rounded-2xl bg-card/50 border border-dashed border-border text-center">
          <FileText className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No clinical notes for this encounter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {timelineEntries.map((entry, index) => (
            <TimelineEntry
              key={entry.id}
              entry={entry}
              index={index}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EncounterQuickActions({ actionState, encounter, encounterId, onNavigate }) {
  return (
    <section className="pt-4 border-t border-border">
      <div className="flex flex-wrap gap-2">
        {encounter.patient && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate(`/patients/${encounter.patient}`)}
          >
            <User className="size-4 mr-2" />
            View Patient Record
          </Button>
        )}
        {actionState.canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate(`/encounters/${encounterId}/edit`)}
          >
            <Edit className="size-4 mr-2" />
            Edit Encounter
          </Button>
        )}
      </div>
    </section>
  );
}

export function EncounterDetailContent({
  actionState,
  encounter,
  encounterId,
  isLoadingNotes,
  onNavigate,
  timelineEntries,
}) {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
      <EncounterDetailsSection encounter={encounter} />
      <EncounterTimelineSection
        isLoadingNotes={isLoadingNotes}
        timelineEntries={timelineEntries}
      />
      <EncounterQuickActions
        actionState={actionState}
        encounter={encounter}
        encounterId={encounterId}
        onNavigate={onNavigate}
      />
    </main>
  );
}
