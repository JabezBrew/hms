import Ban from 'lucide-react/dist/esm/icons/ban.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { BlockedTimeCard } from './BlockedTimeCard';
import { ScheduleCard } from './ScheduleCard';

export function AvailabilitySidebar({
  activeTab,
  onActiveTabChange,
  availabilityRules,
  availabilityLoading,
  blockedTimes,
  blockedTimesLoading,
  canMutate,
  onCreateAvailability,
  onCreateBlockedTime,
  onRefetchAvailability,
  onRefetchBlocked,
  onEditAvailability,
  onDeleteAvailability,
  onEditBlockedTime,
  onDeleteBlockedTime,
}) {
  return (
    <div className="space-y-6">
      <div className="flex p-1 bg-muted/30 rounded-lg border border-border/50">
        <button
          type="button"
          onClick={() => onActiveTabChange('schedules')}
          className={cn(
            'flex-1 py-2 px-4 font-mono text-xs rounded-md transition-colors',
            activeTab === 'schedules'
              ? 'bg-card text-foreground shadow-sm font-medium'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Personal Calendar
        </button>
        <button
          type="button"
          onClick={() => onActiveTabChange('blocked')}
          className={cn(
            'flex-1 py-2 px-4 font-mono text-xs rounded-md transition-colors',
            activeTab === 'blocked'
              ? 'bg-card text-foreground shadow-sm font-medium'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Blocked Times
        </button>
      </div>

      {activeTab === 'schedules' && (
        <SchedulePanel
          availabilityRules={availabilityRules}
          availabilityLoading={availabilityLoading}
          canMutate={canMutate}
          onCreateAvailability={onCreateAvailability}
          onRefetchAvailability={onRefetchAvailability}
          onEditAvailability={onEditAvailability}
          onDeleteAvailability={onDeleteAvailability}
        />
      )}

      {activeTab === 'blocked' && (
        <BlockedTimesPanel
          blockedTimes={blockedTimes}
          blockedTimesLoading={blockedTimesLoading}
          canMutate={canMutate}
          onCreateBlockedTime={onCreateBlockedTime}
          onRefetchBlocked={onRefetchBlocked}
          onEditBlockedTime={onEditBlockedTime}
          onDeleteBlockedTime={onDeleteBlockedTime}
        />
      )}
    </div>
  );
}

function SchedulePanel({
  availabilityRules,
  availabilityLoading,
  canMutate,
  onCreateAvailability,
  onRefetchAvailability,
  onEditAvailability,
  onDeleteAvailability,
}) {
  return (
    <div className="bg-card rounded-xl border border-border/50">
      <div className="p-4 border-b border-border/50 flex items-center justify-between">
        <h3 className="font-heading text-sm font-semibold text-foreground">Personal Calendar</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefetchAvailability}
          className="size-7 p-0"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="h-[400px]">
        {availabilityLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : availabilityRules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <div className="p-3 rounded-full bg-muted/50 mb-3">
              <Clock className="size-6 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">No personal calendar rules configured</p>
            {canMutate && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 font-mono text-xs"
                onClick={onCreateAvailability}
              >
                Create Rule
              </Button>
            )}
          </div>
        ) : (
          <div className="p-2">
            {availabilityRules.map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                canMutate={canMutate}
                onEdit={() => onEditAvailability(schedule)}
                onDelete={() => onDeleteAvailability(schedule)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function BlockedTimesPanel({
  blockedTimes,
  blockedTimesLoading,
  canMutate,
  onCreateBlockedTime,
  onRefetchBlocked,
  onEditBlockedTime,
  onDeleteBlockedTime,
}) {
  return (
    <div className="bg-card rounded-xl border border-border/50">
      <div className="p-4 border-b border-border/50 flex items-center justify-between">
        <h3 className="font-heading text-sm font-semibold text-foreground">Blocked Times</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefetchBlocked}
          className="size-7 p-0"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="h-[400px]">
        {blockedTimesLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : blockedTimes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <div className="p-3 rounded-full bg-muted/50 mb-3">
              <Ban className="size-6 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">No blocked times</p>
            {canMutate && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 font-mono text-xs"
                onClick={onCreateBlockedTime}
              >
                Block Time
              </Button>
            )}
          </div>
        ) : (
          <div className="p-2">
            {blockedTimes.map((blocked) => (
              <BlockedTimeCard
                key={blocked.id}
                blocked={blocked}
                canMutate={canMutate}
                onEdit={() => onEditBlockedTime(blocked)}
                onDelete={() => onDeleteBlockedTime(blocked)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
