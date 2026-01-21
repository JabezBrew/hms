/**
 * RosterBuilderPage - Build and edit roster for a period
 * Generate, view, edit, and publish roster entries
 * Chronicle Design System styling
 */
import { useState, useMemo, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import { toast } from 'sonner';
import format from 'date-fns/format';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';
import addMonths from 'date-fns/addMonths';
import subMonths from 'date-fns/subMonths';
import eachDayOfInterval from 'date-fns/eachDayOfInterval';
import getDay from 'date-fns/getDay';
import isSameDay from 'date-fns/isSameDay';

import {
  useClinicalUnitsTree,
  useDepartmentDutyTypes,
  useRosterEntries,
  useGenerateRosterEntries,
  usePublishRoster,
  useClearRoster,
  useUpdateRosterEntry,
} from '@/hooks/useOrganization';
import { rosterEntriesApi } from '@/lib/api/organization';
import { flattenUnitTree, toList } from './duty-roster/utils';
import { EmptyState } from './duty-roster/components';

const DAYS_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Get current month in YYYY-MM format
 */
function getCurrentPeriod() {
  return format(new Date(), 'yyyy-MM');
}

/**
 * Parse YYYY-MM period to date
 */
function parsePeriod(period) {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

/**
 * RosterBuilderPage - Main component
 */
export default function RosterBuilderPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const departmentParam = searchParams.get('department');
  const periodParam = searchParams.get('period') || getCurrentPeriod();

  const [selectedDepartment, setSelectedDepartment] = useState(departmentParam || '');
  const [currentPeriod, setCurrentPeriod] = useState(periodParam);
  const [editingCell, setEditingCell] = useState(null);
  const [pendingTeamChange, setPendingTeamChange] = useState(null); // { teamId, teamName }
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Get organization tree
  const { data: treeData, isLoading: treeLoading } = useClinicalUnitsTree();
  const flatUnits = useMemo(() => {
    const nodes = treeData?.data || treeData || [];
    return flattenUnitTree(Array.isArray(nodes) ? nodes : []);
  }, [treeData]);

  const departments = useMemo(
    () => flatUnits.filter((u) => u.unit_type_code === 'department'),
    [flatUnits]
  );

  const teams = useMemo(
    () =>
      selectedDepartment
        ? flatUnits.filter(
            (u) => u.unit_type_code === 'team' && u.parentId === selectedDepartment
          )
        : [],
    [selectedDepartment, flatUnits]
  );

  const teamById = useMemo(() => {
    const map = new Map();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  // Get duty types for department
  const { data: dutyTypeData, isLoading: dutyTypesLoading } = useDepartmentDutyTypes(
    selectedDepartment ? { department: selectedDepartment } : null
  );
  const dutyTypes = toList(dutyTypeData);

  // Calculate dates in period
  const periodDate = useMemo(() => parsePeriod(currentPeriod), [currentPeriod]);
  const datesInPeriod = useMemo(() => {
    const start = startOfMonth(periodDate);
    const end = endOfMonth(periodDate);
    return eachDayOfInterval({ start, end });
  }, [periodDate]);

  // Get roster entries for period
  const { data: rosterData, isLoading: rosterLoading, refetch: refetchRoster } = useRosterEntries(
    selectedDepartment,
    {
      date_from: format(startOfMonth(periodDate), 'yyyy-MM-dd'),
      date_to: format(endOfMonth(periodDate), 'yyyy-MM-dd'),
    },
    { enabled: !!selectedDepartment }
  );
  const entries = toList(rosterData);

  // Group entries by date and duty_type
  const entriesByDateDutyType = useMemo(() => {
    const map = new Map();
    entries.forEach((entry) => {
      const key = `${entry.date}|${entry.duty_type}`;
      map.set(key, entry);
    });
    return map;
  }, [entries]);

  // Mutations
  const generateMutation = useGenerateRosterEntries();
  const publishMutation = usePublishRoster();
  const clearMutation = useClearRoster();
  const updateMutation = useUpdateRosterEntry();

  // Stats
  const stats = useMemo(() => {
    const draft = entries.filter((e) => e.status === 'draft').length;
    const published = entries.filter((e) => e.status === 'published').length;
    const overrides = entries.filter((e) => e.is_override).length;
    return { draft, published, overrides, total: entries.length };
  }, [entries]);

  // Navigation
  const goToPreviousPeriod = () => {
    const newDate = subMonths(periodDate, 1);
    setCurrentPeriod(format(newDate, 'yyyy-MM'));
  };

  const goToNextPeriod = () => {
    const newDate = addMonths(periodDate, 1);
    setCurrentPeriod(format(newDate, 'yyyy-MM'));
  };

  const handleDepartmentChange = (value) => {
    setSelectedDepartment(value);
    setSearchParams({ department: value, period: currentPeriod });
  };

  // Generate roster
  const handleGenerate = async () => {
    if (!selectedDepartment) {
      toast.error('Select a department first.');
      return;
    }

    try {
      const result = await generateMutation.mutateAsync({
        departmentId: selectedDepartment,
        data: { period: currentPeriod },
      });
      const count = result?.entries_created ?? result?.data?.entries_created ?? 0;
      toast.success(`Generated ${count} roster entries.`);
      refetchRoster();
    } catch (error) {
      toast.error(error.message || 'Failed to generate roster.');
    }
  };

  // Publish roster
  const handlePublish = async () => {
    if (!selectedDepartment || stats.draft === 0) {
      toast.error('No draft entries to publish.');
      return;
    }

    try {
      const start = format(startOfMonth(periodDate), 'yyyy-MM-dd');
      const end = format(endOfMonth(periodDate), 'yyyy-MM-dd');
      const result = await publishMutation.mutateAsync({
        departmentId: selectedDepartment,
        data: { date_from: start, date_to: end },
      });
      const count = result?.updated ?? result?.data?.updated ?? 0;
      toast.success(`Published ${count} roster entries.`);
      refetchRoster();
    } catch (error) {
      toast.error(error.message || 'Failed to publish roster.');
    }
  };

  // Clear roster (draft entries only)
  const handleClear = async () => {
    if (!selectedDepartment || stats.draft === 0) {
      toast.error('No draft entries to clear.');
      return;
    }

    try {
      const start = format(startOfMonth(periodDate), 'yyyy-MM-dd');
      const end = format(endOfMonth(periodDate), 'yyyy-MM-dd');
      const result = await clearMutation.mutateAsync({
        departmentId: selectedDepartment,
        data: { date_from: start, date_to: end },
      });
      const count = result?.deleted ?? result?.data?.deleted ?? 0;
      toast.success(`Cleared ${count} draft roster entries.`);
      refetchRoster();
      setShowClearConfirm(false);
    } catch (error) {
      toast.error(error.message || 'Failed to clear roster.');
    }
  };

  // Download PDF
  const handleDownload = async () => {
    if (!selectedDepartment) {
      toast.error('Select a department first.');
      return;
    }

    try {
      const response = await rosterEntriesApi.print(selectedDepartment, { period: currentPeriod });
      const blob = new Blob([response], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `roster-${currentPeriod}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Roster downloaded.');
    } catch (error) {
      toast.error(error.message || 'Failed to download roster.');
    }
  };

  // Edit cell
  const openCellEditor = (date, dutyType) => {
    const key = `${format(date, 'yyyy-MM-dd')}|${dutyType.id}`;
    const entry = entriesByDateDutyType.get(key);
    setEditingCell({ date, dutyType, entry });
  };

  const handleCellSave = async (teamId) => {
    if (!editingCell) return;

    const dateStr = format(editingCell.date, 'yyyy-MM-dd');

    try {
      if (editingCell.entry) {
        // Update existing entry
        await updateMutation.mutateAsync({
          id: editingCell.entry.id,
          data: { team: teamId },
        });
        toast.success('Entry updated.');
      } else {
        // Create new entry (this would need useCreateRosterEntry but let's use the API directly)
        toast.info('Manual entry creation not yet implemented. Use Generate first.');
      }
      refetchRoster();
      setEditingCell(null);
    } catch (error) {
      toast.error(error.message || 'Failed to save.');
    }
  };

  // Check if a duty type applies to a given day
  const dutyTypeApplies = useCallback((dutyType, date) => {
    const dayOfWeek = getDay(date);
    // JavaScript getDay: 0=Sunday, 1=Monday... but spec uses 0=Monday
    const adjustedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    return (dutyType.applicable_days || []).includes(adjustedDay);
  }, []);

  // Get entry for a cell
  const getEntry = useCallback(
    (date, dutyTypeId) => {
      const key = `${format(date, 'yyyy-MM-dd')}|${dutyTypeId}`;
      return entriesByDateDutyType.get(key);
    },
    [entriesByDateDutyType]
  );

  const isLoading = treeLoading || dutyTypesLoading || rosterLoading;

  return (
    <>
      <Helmet>
        <title>Roster Builder | Organization</title>
      </Helmet>

      <div className="min-h-screen bg-background">
        <div className="container max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <header className="mb-6">
            <div className="flex items-center gap-4 mb-4">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin/organization/duty-roster">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back to Roster
                </Link>
              </Button>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  Roster Builder
                </h1>
                <p className="mt-1 text-muted-foreground text-sm">
                  Generate, edit, and publish the duty roster.
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/admin/organization/roster-setup${selectedDepartment ? `?department=${selectedDepartment}` : ''}`}>
                  <Settings className="h-4 w-4 mr-1" />
                  Setup
                </Link>
              </Button>
            </div>
          </header>

          {/* Controls */}
          <Card className="mb-6 border-border">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                {/* Department Selector */}
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1 block">
                    Department
                  </label>
                  <Select value={selectedDepartment} onValueChange={handleDepartmentChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent className="z-[200]">
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Period Navigator */}
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Period
                  </label>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={goToPreviousPeriod}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-heading font-medium w-36 text-center">
                      {format(periodDate, 'MMMM yyyy')}
                    </span>
                    <Button variant="ghost" size="icon" onClick={goToNextPeriod}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    variant="outline"
                    onClick={handleGenerate}
                    disabled={!selectedDepartment || generateMutation.isPending}
                  >
                    <RefreshCw
                      className={cn('h-4 w-4 mr-1', generateMutation.isPending && 'animate-spin')}
                    />
                    Generate
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowClearConfirm(true)}
                    disabled={!selectedDepartment || stats.draft === 0 || clearMutation.isPending}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDownload}
                    disabled={!selectedDepartment || stats.total === 0}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    PDF
                  </Button>
                  <Button
                    onClick={handlePublish}
                    disabled={!selectedDepartment || stats.draft === 0 || publishMutation.isPending}
                  >
                    <Send className="h-4 w-4 mr-1" />
                    Publish
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          {selectedDepartment && stats.total > 0 && (
            <div className="flex flex-wrap gap-4 mb-6">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30 border border-border">
                <span className="text-xs font-mono text-muted-foreground">Total</span>
                <Badge variant="outline" className="font-mono">
                  {stats.total}
                </Badge>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <span className="text-xs font-mono text-amber-600 dark:text-amber-400">Draft</span>
                <Badge variant="outline" className="font-mono bg-amber-500/10">
                  {stats.draft}
                </Badge>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">Published</span>
                <Badge variant="outline" className="font-mono bg-emerald-500/10">
                  {stats.published}
                </Badge>
              </div>
              {stats.overrides > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
                  <span className="text-xs font-mono text-rose-600 dark:text-rose-400">Overrides</span>
                  <Badge variant="outline" className="font-mono bg-rose-500/10">
                    {stats.overrides}
                  </Badge>
                </div>
              )}
            </div>
          )}

          {/* Roster Grid */}
          {!selectedDepartment ? (
            <Card className="border-border">
              <CardContent className="p-8">
                <EmptyState
                  icon={CalendarClock}
                  title="Select a department"
                  description="Choose a department to view and build its roster."
                />
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Card className="border-border">
              <CardContent className="p-4">
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : dutyTypes.length === 0 ? (
            <Card className="border-border">
              <CardContent className="p-8">
                <EmptyState
                  icon={AlertTriangle}
                  title="No duty types configured"
                  description="Set up duty types for this department before building the roster."
                  action={
                    <Button asChild>
                      <Link to={`/admin/organization/roster-setup?department=${selectedDepartment}`}>
                        Go to Setup
                      </Link>
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="sticky left-0 z-10 bg-muted/30 border-b border-r border-border px-3 py-2 text-left">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Date
                        </span>
                      </th>
                      {dutyTypes.map((dt) => (
                        <th
                          key={dt.id}
                          className="border-b border-border px-3 py-2 text-center min-w-[100px]"
                        >
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            {dt.name}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datesInPeriod.map((date, dateIndex) => {
                      const dayOfWeek = getDay(date);
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                      return (
                        <tr
                          key={date.toISOString()}
                          className={cn(
                            'animate-chronicle-enter',
                            isWeekend && 'bg-muted/20'
                          )}
                          style={{ animationDelay: `${dateIndex * 10}ms` }}
                        >
                          <td className="sticky left-0 z-10 bg-background border-b border-r border-border px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'font-mono text-xs',
                                  isWeekend && 'text-primary font-medium'
                                )}
                              >
                                {DAYS_LABELS[dayOfWeek === 0 ? 6 : dayOfWeek - 1]}
                              </span>
                              <span className="font-heading text-sm">{format(date, 'd')}</span>
                            </div>
                          </td>
                          {dutyTypes.map((dt) => {
                            const applies = dutyTypeApplies(dt, date);
                            const entry = getEntry(date, dt.id);

                            if (!applies) {
                              return (
                                <td
                                  key={dt.id}
                                  className="border-b border-border px-2 py-1 text-center bg-muted/10"
                                >
                                  <span className="text-xs text-muted-foreground">—</span>
                                </td>
                              );
                            }

                            return (
                              <td key={dt.id} className="border-b border-border px-2 py-1">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => openCellEditor(date, dt)}
                                        className={cn(
                                          'w-full px-2 py-1.5 rounded text-xs font-mono transition-colors',
                                          'hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/20',
                                          entry
                                            ? entry.is_override
                                              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                              : entry.status === 'published'
                                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                            : 'text-muted-foreground'
                                        )}
                                      >
                                        {entry ? teamById.get(entry.team)?.name || 'Unknown' : '—'}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs">
                                        {entry
                                          ? `${entry.status}${entry.is_override ? ' (override)' : ''}`
                                          : 'Click to assign'}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Cell Editor Dialog */}
          <Dialog
            open={!!editingCell}
            onOpenChange={() => {
              setEditingCell(null);
              setPendingTeamChange(null);
            }}
          >
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">
                  {editingCell?.dutyType?.name}
                </DialogTitle>
                <DialogDescription>
                  {editingCell && format(editingCell.date, 'EEEE, MMMM d, yyyy')}
                </DialogDescription>
              </DialogHeader>

              {/* Show confirmation if changing team */}
              {pendingTeamChange ? (
                <div className="space-y-4 py-2">
                  <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
                      Change team assignment?
                    </p>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">From:</span>
                        <span className="font-medium">
                          {teamById.get(editingCell?.entry?.team)?.name || 'Unassigned'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">To:</span>
                        <span className="font-medium text-primary">{pendingTeamChange.teamName}</span>
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPendingTeamChange(null)}>
                      Back
                    </Button>
                    <Button
                      variant="default"
                      onClick={() => {
                        handleCellSave(pendingTeamChange.teamId);
                        setPendingTeamChange(null);
                      }}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? 'Saving...' : 'Confirm Change'}
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <>
                  {/* Show current assignment */}
                  {editingCell?.entry?.team && (
                    <div className="p-3 rounded-lg bg-muted/50 border border-border">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                        Currently Assigned
                      </div>
                      <div className="font-heading font-medium">
                        {teamById.get(editingCell.entry.team)?.name || 'Unknown'}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 py-2">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      {editingCell?.entry?.team ? 'Change To' : 'Assign Team'}
                    </label>
                    <div className="grid gap-2">
                      {teams
                        .filter((team) => team.id !== editingCell?.entry?.team)
                        .map((team) => (
                          <button
                            key={team.id}
                            type="button"
                            onClick={() => {
                              if (editingCell?.entry?.team) {
                                // Existing entry - show confirmation
                                setPendingTeamChange({ teamId: team.id, teamName: team.name });
                              } else {
                                // No existing entry - save directly
                                handleCellSave(team.id);
                              }
                            }}
                            className={cn(
                              'w-full px-3 py-2 rounded-lg border text-left transition-colors',
                              'hover:bg-primary/5 hover:border-primary/30 border-border'
                            )}
                          >
                            <span className="font-heading font-medium text-sm">{team.name}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {team.code}
                            </span>
                          </button>
                        ))}
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEditingCell(null)}>
                      Cancel
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>

          {/* Clear Confirmation Dialog */}
          <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="font-display text-xl text-destructive">
                  Clear Draft Roster
                </DialogTitle>
                <DialogDescription>
                  This will delete all <strong>{stats.draft}</strong> draft roster entries for{' '}
                  <strong>{format(periodDate, 'MMMM yyyy')}</strong>. Published entries will not be
                  affected.
                </DialogDescription>
              </DialogHeader>

              <div className="py-4">
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    After clearing, you can regenerate the roster. The sequence will continue from
                    the previous period's last entry.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowClearConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleClear}
                  disabled={clearMutation.isPending}
                >
                  {clearMutation.isPending ? 'Clearing...' : `Clear ${stats.draft} entries`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </>
  );
}
