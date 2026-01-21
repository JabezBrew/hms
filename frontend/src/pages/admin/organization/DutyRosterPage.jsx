/**
 * DutyRosterPage - Operations-focused duty roster view
 * Shows who's on duty now, quick links to setup and builder
 * Chronicle Design System styling
 */
import { useState, useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Wrench from 'lucide-react/dist/esm/icons/wrench.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import format from 'date-fns/format';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';
import addMonths from 'date-fns/addMonths';
import subMonths from 'date-fns/subMonths';

import {
  useClinicalUnitsTree,
  useRosterOnDutyAll,
  useRosterOnDutyDepartment,
  useRosterEntries,
} from '@/hooks/useOrganization';
import { flattenUnitTree, toList } from './duty-roster/utils';
import { EmptyState } from './duty-roster/components';

/**
 * OnDutyCard - Shows a single on-duty entry
 */
function OnDutyCard({ entry, showDepartment = false }) {
  return (
    <div
      className={cn(
        'p-4 rounded-lg border transition-colors animate-chronicle-enter',
        entry.is_override
          ? 'bg-amber-500/5 border-amber-500/20'
          : 'bg-card border-border hover:border-primary/30'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-heading font-medium text-foreground">
              {entry.team_name || 'Unknown Team'}
            </span>
            {entry.is_override && (
              <Badge
                variant="outline"
                className="text-[9px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
              >
                Override
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {entry.duty_type_name || 'Duty'}
            {showDepartment && entry.department_name && (
              <span className="ml-1">• {entry.department_name}</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm text-foreground">
            {entry.start_time || '--:--'} - {entry.end_time || '--:--'}
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-mono mt-1',
              entry.status === 'published'
                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
            )}
          >
            {entry.status || 'draft'}
          </Badge>
        </div>
      </div>
    </div>
  );
}

/**
 * OnDutyWidget - Shows current on-duty coverage
 */
function OnDutyWidget({ departmentId }) {
  // Fetch both - only one will be enabled based on departmentId
  const departmentQuery = useRosterOnDutyDepartment(departmentId, {}, { enabled: !!departmentId });
  const allQuery = useRosterOnDutyAll({}, { enabled: !departmentId });

  const { data, isLoading } = departmentId ? departmentQuery : allQuery;

  const onDuty = useMemo(() => {
    // apiClient.get returns results array directly (unwrapped by handlePaginatedResponse)
    if (Array.isArray(data)) {
      return data;
    }
    // Fallback for wrapped responses
    const results = data?.results || data?.data?.results || [];
    return Array.isArray(results) ? results : [];
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (onDuty.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No teams currently on duty"
        description="Generate a roster or check the time range."
      />
    );
  }

  return (
    <div className="space-y-3">
      {onDuty.map((entry, index) => (
        <OnDutyCard
          key={`${entry.id || index}-${entry.team}`}
          entry={entry}
          showDepartment={!departmentId}
        />
      ))}
    </div>
  );
}

/**
 * RosterCalendarView - Shows roster for a selected date
 */
function RosterCalendarView({ departmentId, flatUnits }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const startDate = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

  const { data, isLoading } = useRosterEntries(
    departmentId,
    { date_from: startDate, date_to: endDate },
    { enabled: !!departmentId }
  );
  const entries = toList(data);

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const selectedEntries = entries.filter((e) => e.date === selectedDateStr);

  // Get dates with entries for calendar highlighting
  const datesWithEntries = useMemo(
    () => new Set(entries.map((e) => e.date)),
    [entries]
  );

  const teamById = useMemo(() => {
    const map = new Map();
    flatUnits.forEach((u) => {
      if (u.unit_type_code === 'team') {
        map.set(u.id, u);
      }
    });
    return map;
  }, [flatUnits]);

  if (!departmentId) {
    return (
      <EmptyState
        icon={CalendarIcon}
        title="Select a department"
        description="Choose a department to view its roster calendar."
      />
    );
  }

  return (
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
                {selectedEntries.length} assignment{selectedEntries.length !== 1 ? 's' : ''}
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
              title="No assignments for this date"
              description="Generate a roster or add assignments in the Builder."
            />
          ) : (
            <div className="space-y-3">
              {selectedEntries.map((entry, index) => (
                <div
                  key={entry.id}
                  className={cn(
                    'p-4 rounded-lg border transition-colors animate-chronicle-enter',
                    entry.is_override
                      ? 'bg-amber-500/5 border-amber-500/20'
                      : entry.status === 'published'
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : 'bg-card border-border'
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-heading font-medium text-foreground">
                          {teamById.get(entry.team)?.name || entry.team_name || 'Unknown'}
                        </span>
                        {entry.is_override && (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono bg-amber-500/10 text-amber-600 border-amber-500/20"
                          >
                            Override
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {entry.duty_type_name || 'Duty'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm text-foreground">
                        {entry.start_time || '--:--'} - {entry.end_time || '--:--'}
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] font-mono mt-1',
                          entry.status === 'published'
                            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                        )}
                      >
                        {entry.status || 'draft'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * DutyRosterPage - Main component
 */
export default function DutyRosterPage() {
  const [activeTab, setActiveTab] = useState('now');
  const [selectedDepartment, setSelectedDepartment] = useState('');

  const { data: treeData, isLoading: treeLoading } = useClinicalUnitsTree();
  const flatUnits = useMemo(() => {
    const nodes = treeData?.data || treeData || [];
    return flattenUnitTree(Array.isArray(nodes) ? nodes : []);
  }, [treeData]);

  const departments = useMemo(
    () => flatUnits.filter((u) => u.unit_type_code === 'department'),
    [flatUnits]
  );

  return (
    <>
      <Helmet>
        <title>Duty Roster | Organization</title>
      </Helmet>

      <div className="min-h-screen bg-background">
        <div className="container max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <header className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  Duty Roster
                </h1>
                <p className="mt-2 text-muted-foreground text-sm">
                  View who's on duty and manage roster operations.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/admin/organization/roster-setup">
                    <Wrench className="h-4 w-4 mr-1" />
                    Setup
                  </Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/admin/organization/roster-builder">
                    <CalendarIcon className="h-4 w-4 mr-1" />
                    Build Roster
                  </Link>
                </Button>
              </div>
            </div>
          </header>

          {/* Quick Stats */}
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <Card className="border-border bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-display font-semibold">
                      {format(new Date(), 'h:mm a')}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {format(new Date(), 'EEEE, MMM d')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Link to="/admin/organization/roster-setup" className="block group">
              <Card className="border-border hover:border-amber-500/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors">
                      <Settings className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="font-heading font-medium group-hover:text-primary transition-colors">
                        Roster Setup
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Teams, duty types, rules
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link to="/admin/organization/roster-builder" className="block group">
              <Card className="border-border hover:border-emerald-500/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                      <CalendarIcon className="h-5 w-5 text-emerald-500" />
                    </div>
                    <div>
                      <p className="font-heading font-medium group-hover:text-primary transition-colors">
                        Roster Builder
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Generate & edit roster
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>

          {/* Department Filter */}
          <div className="mb-6">
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2 block">
              Filter by Department
            </label>
            <Select value={selectedDepartment || 'all'} onValueChange={(v) => setSelectedDepartment(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="border-b border-border">
              <TabsList className="h-auto p-0 bg-transparent">
                <TabsTrigger
                  value="now"
                  className={cn(
                    'relative px-4 py-3 rounded-none border-b-2 border-transparent',
                    'text-sm font-medium text-muted-foreground',
                    'hover:text-foreground transition-colors',
                    'data-[state=active]:text-foreground data-[state=active]:border-primary'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    On Duty Now
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="calendar"
                  className={cn(
                    'relative px-4 py-3 rounded-none border-b-2 border-transparent',
                    'text-sm font-medium text-muted-foreground',
                    'hover:text-foreground transition-colors',
                    'data-[state=active]:text-foreground data-[state=active]:border-primary'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    Calendar View
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="now" className="mt-0 animate-chronicle-enter">
              <Card className="border-border">
                <CardHeader className="border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="font-display text-lg">Currently On Duty</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        Teams currently assigned based on published roster
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <OnDutyWidget departmentId={selectedDepartment || null} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="calendar" className="mt-0 animate-chronicle-enter">
              <RosterCalendarView
                departmentId={selectedDepartment || null}
                flatUnits={flatUnits}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
