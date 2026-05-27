import Ban from 'lucide-react/dist/esm/icons/ban.js';
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days.js';
import CalendarX from 'lucide-react/dist/esm/icons/calendar-x.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/shared/components/page/PageHeader';

import { StatCard } from './StatCard';

export function AvailabilityHeader({
  isDoctor,
  canMutate,
  stats,
  onCreateAvailability,
  onCreateBlockedTime,
}) {
  return (
    <div className="bg-card border-b border-border">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <PageHeader
          wrap={false}
          title={isDoctor ? 'My Availability' : 'Practitioner Availability'}
          description={
            isDoctor
              ? 'View your calendar and blocked time'
              : 'Manage personal calendars and blocked time'
          }
          actions={canMutate ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="font-mono text-xs"
                onClick={onCreateBlockedTime}
              >
                <Ban className="size-3.5 mr-1.5" />
                Block Time
              </Button>
              <Button
                className="bg-amber-600 hover:bg-amber-700 font-mono text-xs"
                onClick={onCreateAvailability}
              >
                <Plus className="size-3.5 mr-1.5" />
                New Rule
              </Button>
            </div>
          ) : null}
        />

        {!canMutate && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            Availability rule and blocked-time management is not available in this deployment yet.
            Calendar availability remains read-only until scheduling management is enabled.
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard
            icon={CalendarClock}
            label="Active Rules"
            value={stats.activeSchedules}
            sublabel={`of ${stats.totalSchedules} total`}
            color="amber"
          />
          <StatCard
            icon={CalendarX}
            label="Active Blocks"
            value={stats.activeBlocks}
            sublabel={`${stats.totalBlocks} total`}
            color="rose"
          />
          <StatCard
            icon={CalendarDays}
            label="This Week"
            value="—"
            sublabel="appointments"
            color="sky"
          />
        </div>
      </div>
    </div>
  );
}
