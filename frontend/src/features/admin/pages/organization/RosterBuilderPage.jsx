/**
 * RosterBuilderPage - Build and edit roster for a period
 * Generate, view, edit, and publish roster entries
 * Chronicle Design System styling
 */
import { useState, useMemo, useCallback } from 'react';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
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
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js';
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
  useCreateRosterEntry,
  useValidationRules,
} from '@/features/admin/hooks';
import { rosterEntriesApi } from '@/features/admin/api';
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
  const [showPublishWarningConfirm, setShowPublishWarningConfirm] = useState(false);

  // Get organization tree
  const { data: treeData, isLoading: treeLoading } = useClinicalUnitsTree();
  const flatUnits = useMemo(() => {
    const nodes = treeData?.data || treeData || [];
    return flattenUnitTree(Array.isArray(nodes) ? nodes : []);
  }, [treeData]);

  // Include both departments and divisions, but only clinical units
  // Filter out ancillary and ops_only units (Lab, Radiology, Pharmacy, Administration)
  const rosterUnits = useMemo(
    () => flatUnits.filter((u) =>
      (u.unit_type_code === 'department' || u.unit_type_code === 'division') &&
      u.unit_category === 'clinical'
    ),
    [flatUnits]
  );

  // Get teams for selected unit - look under the unit itself OR its parent (for divisions)
  const teams = useMemo(() => {
    if (!selectedDepartment) return [];
    const selectedUnit = flatUnits.find((u) => u.id === selectedDepartment);
    if (!selectedUnit) return [];

    const unitIdsToCheck = [selectedDepartment];
    if (selectedUnit.unit_type_code === 'division' && selectedUnit.parentId) {
      unitIdsToCheck.push(selectedUnit.parentId);
    }

    return flatUnits.filter(
      (u) => u.unit_type_code === 'team' && unitIdsToCheck.includes(u.parentId)
    );
  }, [selectedDepartment, flatUnits]);

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

  // Fetch validation rules for real-time validation
  const { data: validationRulesData } = useValidationRules(selectedDepartment);
  const validationRules = toList(validationRulesData).filter((r) => r.is_active);

  // Client-side validation - compute violations for all entries
  const violations = useMemo(() => {
    if (!entries.length || !validationRules.length) return new Map();

    const violationsMap = new Map(); // key: "date|duty_type" -> { errors: [], warnings: [] }

    // Helper to get day of week (0=Mon, 6=Sun)
    const getDayOfWeek = (dateStr) => {
      const d = new Date(dateStr);
      const jsDay = d.getDay(); // 0=Sun, 1=Mon
      return jsDay === 0 ? 6 : jsDay - 1;
    };

    // Helper to get week number for grouping
    const getWeekKey = (dateStr) => {
      const d = new Date(dateStr);
      const startOfYear = new Date(d.getFullYear(), 0, 1);
      const days = Math.floor((d - startOfYear) / (24 * 60 * 60 * 1000));
      return `${d.getFullYear()}-W${Math.ceil((days + startOfYear.getDay() + 1) / 7)}`;
    };

    // Group entries by team and duty type for validation
    const entriesByTeamDutyType = new Map();
    entries.forEach((entry) => {
      if (!entry.team) return;
      const key = `${entry.team}|${entry.duty_type}`;
      if (!entriesByTeamDutyType.has(key)) {
        entriesByTeamDutyType.set(key, []);
      }
      entriesByTeamDutyType.get(key).push(entry);
    });
    const entriesByDateTeam = new Map();
    entries.forEach((entry) => {
      if (!entry.team) return;
      const key = `${entry.date}|${entry.team}`;
      if (!entriesByDateTeam.has(key)) {
        entriesByDateTeam.set(key, []);
      }
      entriesByDateTeam.get(key).push(entry);
    });
    const dutyTypeById = new Map(dutyTypes.map((dutyType) => [dutyType.id, dutyType]));

    // Run each rule
    validationRules.forEach((rule) => {
      const addViolation = (entry, message) => {
        const key = `${entry.date}|${entry.duty_type}`;
        if (!violationsMap.has(key)) {
          violationsMap.set(key, { errors: [], warnings: [] });
        }
        const v = violationsMap.get(key);
        if (rule.severity === 'error') {
          v.errors.push({ rule: rule.name, message });
        } else {
          v.warnings.push({ rule: rule.name, message });
        }
      };

      // Filter entries relevant to this rule
      const relevantEntries = entries.filter((e) => {
        if (!e.team) return false;
        // Check if rule applies to this duty type
        if (rule.duty_type && rule.duty_type !== e.duty_type) return false;
        // Check apply_days
        if (rule.apply_days?.length > 0) {
          const dayOfWeek = getDayOfWeek(e.date);
          if (!rule.apply_days.includes(dayOfWeek)) return false;
        }
        return true;
      });

      switch (rule.rule_type) {
        case 'no_consecutive_days': {
          const daysApart = rule.params?.days_apart || 1;
          relevantEntries.forEach((entry) => {
            const entryDate = new Date(entry.date);
            // Look for entries by same team within days_apart
            for (let d = 1; d <= daysApart; d++) {
              const checkDate = new Date(entryDate);
              checkDate.setDate(checkDate.getDate() + d);
              const checkDateStr = checkDate.toISOString().split('T')[0];

              const nextDayEntries = entriesByDateTeam.get(`${checkDateStr}|${entry.team}`) || [];
              let nextDayEntry = nextDayEntries[0];
              if (rule.duty_type) {
                nextDayEntry = null;
                for (const candidate of nextDayEntries) {
                  if (candidate.duty_type === rule.duty_type) {
                    nextDayEntry = candidate;
                    break;
                  }
                }
              }
              if (nextDayEntry) {
                const teamName = teamById.get(entry.team)?.name || 'Team';
                const nextDateFormatted = format(checkDate, 'EEE d');
                addViolation(entry, `${teamName} also on duty ${nextDateFormatted}`);
              }
            }
          });
          break;
        }

        case 'day_pair_exclusion': {
          const pairs = rule.params?.pairs || [];
          pairs.forEach(([day1, day2]) => {
            // Group by team and week
            const byTeamWeek = new Map();
            relevantEntries.forEach((entry) => {
              const dayOfWeek = getDayOfWeek(entry.date);
              if (dayOfWeek === day1 || dayOfWeek === day2) {
                const weekKey = getWeekKey(entry.date);
                const key = `${entry.team}|${weekKey}`;
                if (!byTeamWeek.has(key)) {
                  byTeamWeek.set(key, { day1Entries: [], day2Entries: [] });
                }
                if (dayOfWeek === day1) {
                  byTeamWeek.get(key).day1Entries.push(entry);
                } else {
                  byTeamWeek.get(key).day2Entries.push(entry);
                }
              }
            });

            byTeamWeek.forEach(({ day1Entries, day2Entries }) => {
              if (day1Entries.length > 0 && day2Entries.length > 0) {
                const teamName = teamById.get(day1Entries[0].team)?.name || 'Team';
                const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                day1Entries.forEach((e) =>
                  addViolation(e, `${teamName} cannot do both ${dayNames[day1]} and ${dayNames[day2]} this week`)
                );
                day2Entries.forEach((e) =>
                  addViolation(e, `${teamName} cannot do both ${dayNames[day1]} and ${dayNames[day2]} this week`)
                );
              }
            });
          });
          break;
        }

        case 'team_day_exclusion': {
          const excludedTeams = rule.params?.team_ids || [];
          const excludedDays = rule.params?.days || [];
          relevantEntries.forEach((entry) => {
            if (excludedTeams.includes(entry.team)) {
              const dayOfWeek = getDayOfWeek(entry.date);
              if (excludedDays.includes(dayOfWeek)) {
                const teamName = teamById.get(entry.team)?.name || 'Team';
                const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                addViolation(entry, `${teamName} cannot be assigned on ${dayNames[dayOfWeek]}s`);
              }
            }
          });
          break;
        }

        case 'max_per_period': {
          const maxDuties = rule.params?.max || 2;
          const period = rule.params?.period || 'week';

          // Group by team and period
          const byTeamPeriod = new Map();
          relevantEntries.forEach((entry) => {
            const periodKey =
              period === 'week' ? getWeekKey(entry.date) : entry.date.substring(0, 7);
            const key = `${entry.team}|${periodKey}`;
            if (!byTeamPeriod.has(key)) {
              byTeamPeriod.set(key, []);
            }
            byTeamPeriod.get(key).push(entry);
          });

          byTeamPeriod.forEach((periodEntries) => {
            if (periodEntries.length > maxDuties) {
              const teamName = teamById.get(periodEntries[0].team)?.name || 'Team';
              const periodLabel = period === 'week' ? 'this week' : 'this month';
              periodEntries.forEach((e) =>
                addViolation(e, `${teamName} exceeds ${maxDuties} duties ${periodLabel} (has ${periodEntries.length})`)
              );
            }
          });
          break;
        }

        case 'linked_duty_no_consecutive': {
          const linkedDutyTypes = (rule.params?.duty_type_ids || []).map(String);
          const daysApart = rule.params?.days_apart || 1;

          // Get all entries for linked duty types (not just relevantEntries which may be filtered)
          // Convert both to strings for comparison to handle UUID format mismatches
          const linkedEntries = entries.filter(
            (e) => e.team && linkedDutyTypes.includes(String(e.duty_type))
          );
          const linkedEntriesByDateTeam = new Map();
          linkedEntries.forEach((linkedEntry) => {
            const key = `${linkedEntry.date}|${linkedEntry.team}`;
            if (!linkedEntriesByDateTeam.has(key)) {
              linkedEntriesByDateTeam.set(key, []);
            }
            linkedEntriesByDateTeam.get(key).push(linkedEntry);
          });

          linkedEntries.forEach((entry) => {
            const entryDate = new Date(entry.date);
            // Look for entries by same team within days_apart across ANY linked duty type
            for (let d = 1; d <= daysApart; d++) {
              const checkDate = new Date(entryDate);
              checkDate.setDate(checkDate.getDate() + d);
              const checkDateStr = checkDate.toISOString().split('T')[0];

              const conflictEntries = linkedEntriesByDateTeam.get(`${checkDateStr}|${entry.team}`) || [];
              let conflictEntry = null;
              for (const candidate of conflictEntries) {
                if (candidate.id !== entry.id) {
                  conflictEntry = candidate;
                  break;
                }
              }
              if (conflictEntry) {
                const teamName = teamById.get(entry.team)?.name || 'Team';
                // Find duty type names for clearer message
                const entryDutyName = dutyTypeById.get(entry.duty_type)?.name || 'duty';
                const conflictDutyName = dutyTypeById.get(conflictEntry.duty_type)?.name || 'duty';
                const conflictDateFormatted = format(new Date(conflictEntry.date), 'EEE d');
                addViolation(entry, `${teamName} also assigned to ${conflictDutyName} on ${conflictDateFormatted}`);
              }
            }
          });
          break;
        }
      }
    });

    return violationsMap;
  }, [entries, validationRules, teamById, dutyTypes]);

  // Mutations
  const generateMutation = useGenerateRosterEntries();
  const publishMutation = usePublishRoster();
  const clearMutation = useClearRoster();
  const updateMutation = useUpdateRosterEntry();
  const createMutation = useCreateRosterEntry();

  // Stats
  const stats = useMemo(() => {
    const draft = entries.filter((e) => e.status === 'draft').length;
    const published = entries.filter((e) => e.status === 'published').length;
    const overrides = entries.filter((e) => e.is_override).length;

    // Count validation violations
    let errorCount = 0;
    let warningCount = 0;
    violations.forEach((v) => {
      errorCount += v.errors.length;
      warningCount += v.warnings.length;
    });

    return { draft, published, overrides, total: entries.length, errorCount, warningCount };
  }, [entries, violations]);

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

    // Block publish if there are validation errors
    if (stats.errorCount > 0) {
      toast.error(`Cannot publish: ${stats.errorCount} validation error(s) must be fixed first.`);
      return;
    }

    // Warn but allow publish if there are warnings
    if (stats.warningCount > 0) {
      setShowPublishWarningConfirm(true);
      return;
    }

    await doPublish();
  };

  const doPublish = async () => {
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
      setShowPublishWarningConfirm(false);
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
      // Include department/division name in filename
      const selectedUnit = rosterUnits.find((u) => u.id === selectedDepartment);
      const unitName = selectedUnit?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'roster';
      a.download = `roster-${unitName}-${currentPeriod}.pdf`;
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
        // Create new entry
        await createMutation.mutateAsync({
          departmentId: selectedDepartment,
          data: {
            department: selectedDepartment,
            duty_type: editingCell.dutyType.id,
            date: dateStr,
            team: teamId,
            start_time: editingCell.dutyType.start_time,
            end_time: editingCell.dutyType.end_time,
            source: 'manual',
            status: 'draft',
          },
        });
        toast.success('Entry created.');
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

  const pageMeta = usePageMeta({
    title: 'Roster Builder | Organization',
    breadcrumbs: [
      { label: 'Admin', href: '/admin' },
      { label: 'Organization', href: '/admin/organization' },
      { label: 'Roster Builder' },
    ],
  });

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Roster Builder"
        description="Generate, edit, and publish the duty roster."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/organization/duty-roster">
                <ArrowLeft className="size-4 mr-1" />
                Back to Roster
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/organization/roster-setup${selectedDepartment ? `?department=${selectedDepartment}` : ''}`}>
                <Settings className="size-4 mr-1" />
                Setup
              </Link>
            </Button>
          </div>
        )}
      />

      <div className="container max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">

          {/* Controls */}
          <Card className="mb-6 border-border">
            <CardContent className="p-4 sm:pr-6">
              <div className="flex flex-col md:flex-row md:items-end gap-4">
                {/* Unit Selector (Departments & Divisions) */}
                <div className="min-w-0 md:min-w-[200px]">
	                  <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5 block">
	                    Department / Division
	                  </span>
	                  <Select value={selectedDepartment} onValueChange={handleDepartmentChange}>
	                    <SelectTrigger aria-label="Department or division">
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent className="z-[200]">
                      {(() => {
                        // Group divisions under their parent departments
                        const departments = [];
                        const divisionsByParent = new Map();
                        rosterUnits.forEach((unit) => {
                          if (unit.unit_type_code === 'department') {
                            departments.push(unit);
                          } else if (unit.unit_type_code === 'division') {
                            const divisions = divisionsByParent.get(unit.parentId) || [];
                            divisions.push(unit);
                            divisionsByParent.set(unit.parentId, divisions);
                          }
                        });
                        const groupedUnits = [];
                        departments.forEach((dept) => {
                          groupedUnits.push({ ...dept, indent: 0 });
                          (divisionsByParent.get(dept.id) || []).forEach((div) => {
                            groupedUnits.push({ ...div, indent: 1 });
                          });
                        });
                        return groupedUnits.map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            <span className={unit.indent ? 'pl-4' : ''}>
                              {unit.name}
                              {unit.unit_type_code === 'division' && (
                                <span className="ml-2 text-xs text-muted-foreground">(Division)</span>
                              )}
                            </span>
                          </SelectItem>
                        ));
                      })()}
                    </SelectContent>
                  </Select>
                </div>

                {/* Period Navigator */}
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={goToPreviousPeriod}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="font-heading font-medium w-36 text-center">
                    {format(periodDate, 'MMMM yyyy')}
                  </span>
                  <Button variant="ghost" size="icon" onClick={goToNextPeriod}>
                    <ChevronRight className="size-4" />
                  </Button>
                </div>

                {/* Actions */}
                <div className="ml-0 flex flex-wrap items-center gap-2 md:ml-auto">
                  <Button
                    variant="outline"
                    onClick={handleGenerate}
                    disabled={!selectedDepartment || generateMutation.isPending}
                  >
                    <RefreshCw
                      className={cn('size-4 mr-1', generateMutation.isPending && 'animate-spin')}
                    />
                    Generate
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowClearConfirm(true)}
                    disabled={!selectedDepartment || stats.draft === 0 || clearMutation.isPending}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4 mr-1" />
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDownload}
                    disabled={!selectedDepartment || stats.total === 0}
                  >
                    <Download className="size-4 mr-1" />
                    PDF
                  </Button>
                  <Button
                    onClick={handlePublish}
                    disabled={!selectedDepartment || stats.draft === 0 || publishMutation.isPending}
                  >
                    <Send className="size-4 mr-1" />
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
              {stats.errorCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
                  <AlertCircle className="size-4 text-rose-500" />
                  <span className="text-xs font-mono text-rose-600 dark:text-rose-400">Errors</span>
                  <Badge variant="outline" className="font-mono bg-rose-500/10 text-rose-600">
                    {stats.errorCount}
                  </Badge>
                </div>
              )}
              {stats.warningCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="size-4 text-amber-500" />
                  <span className="text-xs font-mono text-amber-600 dark:text-amber-400">Warnings</span>
                  <Badge variant="outline" className="font-mono bg-amber-500/10 text-amber-600">
                    {stats.warningCount}
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
                  title="Select a unit"
                  description="Choose a department or division to view and build its roster."
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
              <div className="overflow-auto max-h-[70vh]">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-muted">
                      <th className="sticky left-0 z-30 bg-muted border-b border-r border-border px-3 py-2 text-left">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Date
                        </span>
                      </th>
                      {dutyTypes.map((dt) => (
                        <th
                          key={dt.id}
                          className="bg-muted border-b border-border px-3 py-2 text-center min-w-[100px]"
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
                                  <span className="text-xs text-muted-foreground">-</span>
                                </td>
                              );
                            }

                            // Check for violations on this cell
                            const cellKey = `${format(date, 'yyyy-MM-dd')}|${dt.id}`;
                            const cellViolations = violations.get(cellKey);
                            const hasErrors = cellViolations?.errors?.length > 0;
                            const hasWarnings = cellViolations?.warnings?.length > 0;

                            return (
                              <td key={dt.id} className="border-b border-border px-2 py-1">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => openCellEditor(date, dt)}
                                        className={cn(
                                          'w-full px-2 py-1.5 rounded text-xs font-mono transition-colors relative',
                                          'hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/20',
                                          hasErrors
                                            ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 ring-2 ring-rose-500/50'
                                            : hasWarnings
                                            ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 ring-2 ring-amber-500/50'
                                            : entry
                                            ? entry.is_override
                                              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                              : entry.status === 'published'
                                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                            : 'text-muted-foreground'
                                        )}
                                      >
                                        {entry ? teamById.get(entry.team)?.name || 'Unknown' : '—'}
                                        {(hasErrors || hasWarnings) && (
                                          <span className="absolute -top-1 -right-1">
                                            <AlertCircle
                                              className={cn(
                                                'size-3.5',
                                                hasErrors ? 'text-rose-500' : 'text-amber-500'
                                              )}
                                            />
                                          </span>
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs bg-popover text-popover-foreground">
                                      {hasErrors || hasWarnings ? (
                                        <div className="space-y-1.5">
                                          {cellViolations.errors.map((v, i) => (
                                            <p key={`e-${i}`} className="text-xs font-medium text-rose-600 dark:text-rose-400">
                                              {v.message}
                                            </p>
                                          ))}
                                          {cellViolations.warnings.map((v, i) => (
                                            <p key={`w-${i}`} className="text-xs font-medium text-amber-600 dark:text-amber-400">
                                              {v.message}
                                            </p>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-xs">
                                          {entry
                                            ? `${entry.status}${entry.is_override ? ' (override)' : ''}`
                                            : 'Click to assign'}
                                        </p>
                                      )}
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
                      disabled={updateMutation.isPending || createMutation.isPending}
                    >
                      {(updateMutation.isPending || createMutation.isPending) ? 'Saving...' : 'Confirm Change'}
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
                      {teams.map((team) => (
                        team.id !== editingCell?.entry?.team ? (
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
                        ) : null
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

          {/* Publish Warning Confirmation Dialog */}
          <AlertDialog open={showPublishWarningConfirm} onOpenChange={setShowPublishWarningConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display flex items-center gap-2">
                  <AlertTriangle className="size-5 text-amber-500" />
                  Validation Warnings
                </AlertDialogTitle>
                <AlertDialogDescription>
                  There are <strong>{stats.warningCount}</strong> validation warning(s) in this roster.
                  Do you want to publish anyway?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={doPublish}
                  disabled={publishMutation.isPending}
                >
                  {publishMutation.isPending ? 'Publishing...' : 'Publish Anyway'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </PageShell>
  );
}
