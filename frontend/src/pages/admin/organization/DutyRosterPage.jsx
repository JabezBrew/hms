/**
 * DutyRosterPage - Main page for managing duty roster
 * Chronicle Design System styling
 */
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Layers from 'lucide-react/dist/esm/icons/layers.js';
import Grid from 'lucide-react/dist/esm/icons/grid-3x3.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud.js';

import { useOnDuty } from '@/hooks/useOrganization';
import { toList } from './duty-roster/utils';

// Tab imports
import { RosterTab } from './duty-roster/RosterTab';
import { TemplatesTab } from './duty-roster/TemplatesTab';
import { ShiftDefinitionsTab } from './duty-roster/ShiftDefinitionsTab';
import { DutyTypesTab } from './duty-roster/DutyTypesTab';
import { StationsTab } from './duty-roster/StationsTab';
import { DepartmentRosterPlansTab } from './duty-roster/DepartmentRosterPlansTab';
import { RosterPatternsTab } from './duty-roster/RosterPatternsTab';
import { RosterPatternSlotsTab } from './duty-roster/RosterPatternSlotsTab';
import { RosterOverridesTab } from './duty-roster/RosterOverridesTab';
import { TeamRosterPlansTab } from './duty-roster/TeamRosterPlansTab';
import { TeamRosterEntriesTab } from './duty-roster/TeamRosterEntriesTab';
import { RosterImportsTab } from './duty-roster/RosterImportsTab';

const TAB_CONFIG = [
  { value: 'roster', label: 'Roster', icon: CalendarIcon },
  { value: 'templates', label: 'Templates', icon: RefreshCw },
  { value: 'shifts', label: 'Shifts', icon: Clock },
  { value: 'duty-types', label: 'Duty Types', icon: Clipboard },
  { value: 'stations', label: 'Stations', icon: MapPin },
  { value: 'dept-plans', label: 'Dept Plans', icon: CalendarIcon },
  { value: 'patterns', label: 'Patterns', icon: Layers },
  { value: 'pattern-slots', label: 'Pattern Slots', icon: Grid },
  { value: 'overrides', label: 'Overrides', icon: AlertTriangle },
  { value: 'team-plans', label: 'Team Plans', icon: Users },
  { value: 'team-entries', label: 'Team Entries', icon: Users },
  { value: 'imports', label: 'Imports', icon: UploadCloud },
];

/**
 * OnDutyWidget - Shows who's currently on duty (for embedding elsewhere)
 */
export function OnDutyWidget({ unitId }) {
  const hasUnit = !!unitId;
  const { data, isLoading } = useOnDuty(hasUnit ? { unit_id: unitId } : null);
  const onDuty = toList(data);

  if (isLoading) {
    return <Skeleton className="h-16 w-full rounded-lg" />;
  }

  if (onDuty.length === 0) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground text-sm p-4 bg-muted/30 rounded-lg border border-border">
        <Users className="h-4 w-4" />
        <span>No teams currently on duty</span>
      </div>
    );
  }

  return (
    <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-4 w-4 text-primary" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-primary font-medium">
          Currently On Duty
        </span>
      </div>
      <div className="space-y-2">
        {onDuty.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-heading font-medium text-sm text-foreground">
                {entry.team_name}
              </span>
              {entry.source === 'override' && (
                <Badge
                  variant="outline"
                  className="text-[9px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                >
                  Override
                </Badge>
              )}
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {entry.role} {entry.start_time || '--:--'}-{entry.end_time || '--:--'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * DutyRosterPage - Main page for managing duty roster
 */
export default function DutyRosterPage() {
  const [activeTab, setActiveTab] = useState('roster');

  return (
    <>
      <Helmet>
        <title>Duty Roster | Organization</title>
      </Helmet>

      <div className="min-h-screen bg-background">
        <div className="container max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          {/* Header with Chronicle styling */}
          <header className="mb-8">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              Roster Management
            </h1>
            <p className="mt-2 text-muted-foreground text-sm">
              Configure department coverage, team assignments, and roster patterns.
            </p>
          </header>

          {/* Tabs with Chronicle styling */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="border-b border-border pb-px">
              <TabsList className="h-auto p-0 bg-transparent flex flex-wrap gap-1">
                {TAB_CONFIG.map(({ value, label, icon: Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className={cn(
                      'relative px-3 py-2 rounded-t-lg border border-b-0 border-transparent',
                      'text-sm font-medium text-muted-foreground',
                      'hover:text-foreground hover:bg-muted/50 transition-colors',
                      'data-[state=active]:text-foreground data-[state=active]:bg-background',
                      'data-[state=active]:border-border data-[state=active]:shadow-sm',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="hidden sm:inline">{label}</span>
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="roster" className="mt-0 animate-chronicle-enter">
              <RosterTab />
            </TabsContent>

            <TabsContent value="templates" className="mt-0 animate-chronicle-enter">
              <TemplatesTab />
            </TabsContent>

            <TabsContent value="shifts" className="mt-0 animate-chronicle-enter">
              <ShiftDefinitionsTab />
            </TabsContent>

            <TabsContent value="duty-types" className="mt-0 animate-chronicle-enter">
              <DutyTypesTab />
            </TabsContent>

            <TabsContent value="stations" className="mt-0 animate-chronicle-enter">
              <StationsTab />
            </TabsContent>

            <TabsContent value="dept-plans" className="mt-0 animate-chronicle-enter">
              <DepartmentRosterPlansTab />
            </TabsContent>

            <TabsContent value="patterns" className="mt-0 animate-chronicle-enter">
              <RosterPatternsTab />
            </TabsContent>

            <TabsContent value="pattern-slots" className="mt-0 animate-chronicle-enter">
              <RosterPatternSlotsTab />
            </TabsContent>

            <TabsContent value="overrides" className="mt-0 animate-chronicle-enter">
              <RosterOverridesTab />
            </TabsContent>

            <TabsContent value="team-plans" className="mt-0 animate-chronicle-enter">
              <TeamRosterPlansTab />
            </TabsContent>

            <TabsContent value="team-entries" className="mt-0 animate-chronicle-enter">
              <TeamRosterEntriesTab />
            </TabsContent>

            <TabsContent value="imports" className="mt-0 animate-chronicle-enter">
              <RosterImportsTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
