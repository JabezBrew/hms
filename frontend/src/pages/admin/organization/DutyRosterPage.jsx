/**
 * DutyRosterPage - Operations-focused roster management
 * Primary page for viewing and managing daily roster operations
 * Chronicle Design System styling
 */
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import { toast } from 'sonner';
import format from 'date-fns/format';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';
import addMonths from 'date-fns/addMonths';
import subMonths from 'date-fns/subMonths';

import { useOnDuty, useDutyRoster, useGenerateRoster } from '@/hooks/useOrganization';
import { toList } from './duty-roster/utils';
import { EmptyState } from './duty-roster/components';

// Import operational tabs
import { RosterOverridesTab } from './duty-roster/RosterOverridesTab';
import { TeamRosterEntriesTab } from './duty-roster/TeamRosterEntriesTab';

/**
 * OnDutyWidget - Shows who's currently on duty
 */
function OnDutyWidget({ unitId }) {
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
 * RosterCalendarView - Calendar with roster entries
 */
function RosterCalendarView() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const generateRoster = useGenerateRoster();

  const startDate = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

  const { data, isLoading } = useDutyRoster({
    date_from: startDate,
    date_to: endDate,
  });
  const entries = toList(data);

  const handleGenerate = async () => {
    try {
      const result = await generateRoster.mutateAsync({
        start_date: startDate,
        end_date: endDate,
      });
      const createdCount = result?.entries_created ?? result?.data?.entries_created ?? 0;
      toast.success(`Generated ${createdCount} roster entries`);
    } catch (error) {
      toast.error(error.message || 'Failed to generate roster');
    }
  };

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const selectedEntries = entries.filter((e) => e.date === selectedDateStr);

  // Get dates with entries for calendar highlighting
  const datesWithEntries = new Set(entries.map((e) => e.date));

  return (
    <div className="space-y-6">
      {/* Header with Generate button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="font-heading text-lg font-medium text-foreground">Roster Calendar</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            View and manage duty assignments by date
          </p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={generateRoster.isPending}
          className="bg-primary hover:bg-primary/90"
        >
          <RefreshCw
            className={cn('h-4 w-4 mr-2', generateRoster.isPending && 'animate-spin')}
          />
          <span className="font-mono text-xs uppercase tracking-wide">Generate Roster</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <Card className="lg:col-span-1 border-border">
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
                className="h-8 w-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-heading font-medium text-foreground">
                {format(currentMonth, 'MMMM yyyy')}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              month={currentMonth}
              onMonthChange={setCurrentMonth}
              modifiers={{
                hasEntries: (date) => datesWithEntries.has(format(date, 'yyyy-MM-dd')),
              }}
              modifiersClassNames={{
                hasEntries: 'bg-primary/10 font-medium',
              }}
              className="rounded-lg border border-border"
            />
          </CardContent>
        </Card>

        {/* Selected Date Entries */}
        <Card className="lg:col-span-2 border-border">
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <CalendarIcon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="font-display text-lg">
                  {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  {selectedEntries.length} duty assignment{selectedEntries.length !== 1 ? 's' : ''}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            ) : selectedEntries.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No duty assignments for this date"
                description="Generate a roster or add assignments manually to see coverage."
              />
            ) : (
              <div className="space-y-3">
                {selectedEntries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className={cn(
                      'p-4 rounded-lg border transition-colors animate-chronicle-enter',
                      entry.is_primary
                        ? 'bg-primary/5 border-primary/20'
                        : 'bg-card border-border hover:border-primary/30'
                    )}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-heading font-medium text-foreground">
                            {entry.practitioner_name}
                          </span>
                          {entry.is_primary && (
                            <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-mono uppercase">
                              Primary
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {entry.unit_name}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm text-foreground">
                          {entry.start_time} - {entry.end_time}
                        </div>
                        <div className="flex gap-1.5 mt-2 justify-end">
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono uppercase"
                          >
                            {entry.role}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono uppercase"
                          >
                            {entry.seniority_level}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * DutyRosterPage - Main operations page for duty roster
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
          {/* Header */}
          <header className="mb-8">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  Duty Roster
                </h1>
                <p className="mt-2 text-muted-foreground text-sm">
                  View coverage, manage overrides, and assign team members.
                </p>
              </div>
              <Button variant="outline" size="sm" asChild className="gap-2">
                <Link to="/admin/organization/roster-settings">
                  <Settings className="h-4 w-4" />
                  <span className="font-mono text-xs">Settings</span>
                </Link>
              </Button>
            </div>

            {/* On Duty Widget */}
            <div className="mt-6">
              <OnDutyWidget />
            </div>
          </header>

          {/* Tabs - Operations only */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="border-b border-border">
              <TabsList className="h-auto p-0 bg-transparent">
                <TabsTrigger
                  value="roster"
                  className={cn(
                    'relative px-4 py-3 rounded-none border-b-2 border-transparent',
                    'text-sm font-medium text-muted-foreground',
                    'hover:text-foreground transition-colors',
                    'data-[state=active]:text-foreground data-[state=active]:border-primary',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    Roster
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="overrides"
                  className={cn(
                    'relative px-4 py-3 rounded-none border-b-2 border-transparent',
                    'text-sm font-medium text-muted-foreground',
                    'hover:text-foreground transition-colors',
                    'data-[state=active]:text-foreground data-[state=active]:border-primary',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Overrides
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="team-entries"
                  className={cn(
                    'relative px-4 py-3 rounded-none border-b-2 border-transparent',
                    'text-sm font-medium text-muted-foreground',
                    'hover:text-foreground transition-colors',
                    'data-[state=active]:text-foreground data-[state=active]:border-primary',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Team Assignments
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="roster" className="mt-0 animate-chronicle-enter">
              <RosterCalendarView />
            </TabsContent>

            <TabsContent value="overrides" className="mt-0 animate-chronicle-enter">
              <RosterOverridesTab />
            </TabsContent>

            <TabsContent value="team-entries" className="mt-0 animate-chronicle-enter">
              <TeamRosterEntriesTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
