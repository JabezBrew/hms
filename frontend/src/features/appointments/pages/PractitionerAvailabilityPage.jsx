import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Ban from 'lucide-react/dist/esm/icons/ban.js';
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import MoreVertical from 'lucide-react/dist/esm/icons/ellipsis-vertical.js';
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import CalendarX from 'lucide-react/dist/esm/icons/calendar-x.js';
import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  useRecurringSchedules,
  useDeleteRecurringSchedule,
  useBlockedTimes,
  useDeleteBlockedTime
} from '@/features/appointments/hooks/useAppointmentQueries';
import { useSearchPractitioners } from '@/features/encounters/hooks/useEncounterQueries';
import RecurringScheduleForm from '@/components/appointments/RecurringScheduleForm';
import BlockedTimeForm from '@/components/appointments/BlockedTimeForm';
import DoctorAvailabilityCalendar from '@/components/appointments/DoctorAvailabilityCalendar';
import { SearchBar } from '@/components/ui/search-bar';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

/**
 * PractitionerAvailabilityPage - Chronicle-style availability management
 *
 * Features:
 * - Calendar-first view with practitioner selection
 * - Side panel for schedules and blocked times
 * - Elegant stat cards
 * - Quick actions
 */
const PractitionerAvailabilityPage = () => {
  const location = useLocation();
  const { user } = useAuth();
  const userRole = user?.role;
  const isDoctor = userRole === 'doctor';
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const practitionerFromQuery = useMemo(() => {
    return queryParams.get('practitioner');
  }, [queryParams]);
  const pageMeta = usePageMeta({
    title: isDoctor
      ? 'My Availability | Hospital Management System'
      : 'Practitioner Availability | Hospital Management System',
    breadcrumbs: [{ label: 'Availability', path: '/practitioner-availability' }],
  });

  const [activeTab, setActiveTab] = useState('schedules'); // 'schedules' | 'blocked'

  const desiredSelectedPractitioner = useMemo(() => {
    if (isDoctor && user?.practitionerId) {
      return String(user.practitionerId);
    }
    if (practitionerFromQuery) {
      return String(practitionerFromQuery);
    }
    return null;
  }, [isDoctor, practitionerFromQuery, user?.practitionerId]);

  // Keep selection synchronized when arriving via redirect query params.
  const [selectedPractitioner, setSelectedPractitioner] = useState(desiredSelectedPractitioner);
  useEffect(() => {
    setSelectedPractitioner((current) => (
      current === desiredSelectedPractitioner ? current : desiredSelectedPractitioner
    ));
  }, [desiredSelectedPractitioner]);

  // Dialog states
  const [isCreateRecurringDialogOpen, setIsCreateRecurringDialogOpen] = useState(false);
  const [isEditRecurringDialogOpen, setIsEditRecurringDialogOpen] = useState(false);
  const [isDeleteRecurringDialogOpen, setIsDeleteRecurringDialogOpen] = useState(false);
  const [selectedRecurringSchedule, setSelectedRecurringSchedule] = useState(null);
  const [recurringToDelete, setRecurringToDelete] = useState(null);

  const [isCreateBlockedTimeDialogOpen, setIsCreateBlockedTimeDialogOpen] = useState(false);
  const [isEditBlockedTimeDialogOpen, setIsEditBlockedTimeDialogOpen] = useState(false);
  const [isDeleteBlockedTimeDialogOpen, setIsDeleteBlockedTimeDialogOpen] = useState(false);
  const [selectedBlockedTime, setSelectedBlockedTime] = useState(null);
  const [blockedTimeToDelete, setBlockedTimeToDelete] = useState(null);

  // Build filter params - for doctors, filter by their practitioner ID
  // This ensures the page and calendar use the same cached query
  const scheduleFilters = useMemo(() => {
    if (selectedPractitioner) {
      return { practitioner: selectedPractitioner };
    }
    return {};
  }, [selectedPractitioner]);

  // Fetch data - pass filters so doctors only see their own schedules
  // and the query key matches what DoctorAvailabilityCalendar uses
  const {
    data: recurringSchedules = [],
    isLoading: recurringLoading,
    isError: isRecurringError,
    error: recurringError,
    refetch: refetchRecurring
  } = useRecurringSchedules(scheduleFilters);

  const {
    data: blockedTimes = [],
    isLoading: blockedTimesLoading,
    isError: isBlockedTimesError,
    error: blockedTimesError,
    refetch: refetchBlocked
  } = useBlockedTimes(scheduleFilters);

  // Practitioner search
  const {
    data: practitioners = [],
    isLoading: practitionersLoading,
    setSearchTerm: setPractitionerSearchTerm
  } = useSearchPractitioners();

  const handleSearchChange = (value) => {
    setPractitionerSearchTerm(value);
  };

  // Format practitioner options
  const practitionerOptions = useMemo(() => {
    if (!Array.isArray(practitioners)) return [];
    const options = practitioners.map(practitioner => {
      // Check for simple name field first (from search API)
      if (practitioner?.name) {
        return {
          label: practitioner.name,
          value: String(practitioner.id)
        };
      } else if (practitioner.fhir_resource) {
        const name = practitioner.fhir_resource.name?.[0];
        const given = name?.given?.join(' ') || '';
        const family = name?.family || '';
        const displayName = `${family}, ${given}`.trim() || 'Unknown';
        return {
          label: displayName,
          value: String(practitioner.local_data?.id || practitioner.fhir_resource.id)
        };
      } else if (practitioner.local_data?.staff_details?.user_details) {
        // Handle nested local_data structure from search API
        const user = practitioner.local_data.staff_details.user_details;
        return {
          label: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown',
          value: String(practitioner.local_data.id)
        };
      } else if (practitioner.staff_details?.user_details) {
        // Handle direct staff_details structure
        const user = practitioner.staff_details.user_details;
        return {
          label: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown',
          value: String(practitioner.id)
        };
      } else {
        return {
          label: practitioner.user?.full_name || 'Unknown',
          value: String(practitioner.id)
        };
      }
    });

    if (!selectedPractitioner) return options;
    const hasSelectedOption = options.some((option) => option.value === String(selectedPractitioner));
    if (hasSelectedOption) return options;

    return [
      {
        label: `Practitioner ${String(selectedPractitioner).slice(0, 8)}`,
        value: String(selectedPractitioner),
      },
      ...options,
    ];
  }, [practitioners, selectedPractitioner]);

  // Mutations
  const deleteRecurringMutation = useDeleteRecurringSchedule();
  const deleteBlockedTimeMutation = useDeleteBlockedTime();

  // Calculate stats
  const stats = useMemo(() => {
    const activeSchedules = recurringSchedules.filter(s => s.is_active).length;
    const totalSchedules = recurringSchedules.length;
    const activeBlocks = blockedTimes.filter(b => {
      const endDate = new Date(b.end_date || b.date);
      return endDate >= new Date();
    }).length;
    return { activeSchedules, totalSchedules, activeBlocks, totalBlocks: blockedTimes.length };
  }, [recurringSchedules, blockedTimes]);

  // Error handling
  if (isRecurringError) {
    toast.error(recurringError?.message || 'Failed to load schedules');
  }
  if (isBlockedTimesError) {
    toast.error(blockedTimesError?.message || 'Failed to load blocked times');
  }

  // Handlers
  const handleCreateRecurringSuccess = () => {
    setIsCreateRecurringDialogOpen(false);
    toast.success('Schedule created successfully');
  };

  const handleUpdateRecurringSuccess = () => {
    setIsEditRecurringDialogOpen(false);
    toast.success('Schedule updated successfully');
  };

  const handleDeleteRecurring = (scheduleId) => {
    deleteRecurringMutation.mutate(scheduleId, {
      onSuccess: () => {
        setIsDeleteRecurringDialogOpen(false);
        toast.success('Schedule deleted successfully');
      },
      onError: (_error) => {
        toast.error('Failed to delete schedule');
      }
    });
  };

  const handleCreateBlockedTimeSuccess = () => {
    setIsCreateBlockedTimeDialogOpen(false);
    toast.success('Time blocked successfully');
  };

  const handleUpdateBlockedTimeSuccess = () => {
    setIsEditBlockedTimeDialogOpen(false);
    toast.success('Blocked time updated successfully');
  };

  const handleDeleteBlockedTime = (id) => {
    deleteBlockedTimeMutation.mutate(id, {
      onSuccess: () => {
        setIsDeleteBlockedTimeDialogOpen(false);
        toast.success('Blocked time deleted successfully');
      },
      onError: (_error) => {
        toast.error('Failed to delete blocked time');
      }
    });
  };

  const getPractitionerName = (item) => item.practitioner_name || 'Unknown';

  // Loading state
  if (recurringLoading && blockedTimesLoading) {
    return (
      <PageState variant="loading">
        {pageMeta}
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-[500px] w-full" />
        </div>
      </PageState>
    );
  }

  return (
    <PageShell>
      {pageMeta}

      {/* Hero Section */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Header */}
          <PageHeader
            wrap={false}
            title={isDoctor ? 'My Availability' : 'Practitioner Availability'}
            description={
              isDoctor
                ? 'View your schedule, calendar, and blocked time'
                : 'Manage schedules, view calendars, and block time off'
            }
            actions={(
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="font-mono text-xs"
                  onClick={() => setIsCreateBlockedTimeDialogOpen(true)}
                >
                  <Ban className="h-3.5 w-3.5 mr-1.5" />
                  Block Time
                </Button>
                <Button
                  className="bg-amber-600 hover:bg-amber-700 font-mono text-xs"
                  onClick={() => setIsCreateRecurringDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  New Schedule
                </Button>
              </div>
            )}
          />

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard
              icon={CalendarClock}
              label="Active Schedules"
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

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Calendar Section (2/3 width) */}
          <div className="lg:col-span-2">
            <div className="bg-card rounded-xl border border-border/50 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-heading text-base font-semibold text-foreground">
                  {isDoctor ? 'My Availability' : 'Availability Calendar'}
                </h2>
                {/* Only show practitioner search for admin/receptionist - doctors see their own */}
                {!isDoctor && (
                  <div className="w-72">
                    <SearchBar
                      options={practitionerOptions}
                      value={selectedPractitioner}
                      onChange={setSelectedPractitioner}
                      onInputChange={handleSearchChange}
                      placeholder="Select practitioner..."
                      emptyMessage={practitionersLoading ? "Searching..." : "No practitioners found"}
                      maxHeight="20rem"
                      isLoading={practitionersLoading}
                    />
                  </div>
                )}
              </div>

              {!selectedPractitioner ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-4 rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
                    <CalendarDays className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                  </div>
                  <h3 className="font-display text-lg font-medium text-foreground mb-2">
                    {isDoctor ? 'No Practitioner Profile' : 'Select a Practitioner'}
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-sm">
                    {isDoctor
                      ? 'Your account is not linked to a practitioner profile. Contact your administrator.'
                      : 'Choose a practitioner from the dropdown above to view their availability calendar'}
                  </p>
                </div>
              ) : (
                <DoctorAvailabilityCalendar
                  practitionerId={selectedPractitioner}
                  useRoster={false}
                  onSlotSelect={(slot) => {
                    toast.info(`Selected: ${new Date(slot.start).toLocaleTimeString()} - ${new Date(slot.end).toLocaleTimeString()}`);
                  }}
                />
              )}
            </div>
          </div>

          {/* Sidebar (1/3 width) */}
          <div className="space-y-6">
            {/* Tab Navigation */}
            <div className="flex p-1 bg-muted/30 rounded-lg border border-border/50">
              <button
                onClick={() => setActiveTab('schedules')}
                className={cn(
                  "flex-1 py-2 px-4 font-mono text-xs rounded-md transition-colors",
                  activeTab === 'schedules'
                    ? "bg-card text-foreground shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Schedules
              </button>
              <button
                onClick={() => setActiveTab('blocked')}
                className={cn(
                  "flex-1 py-2 px-4 font-mono text-xs rounded-md transition-colors",
                  activeTab === 'blocked'
                    ? "bg-card text-foreground shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Blocked Times
              </button>
            </div>

            {/* Schedules List */}
            {activeTab === 'schedules' && (
              <div className="bg-card rounded-xl border border-border/50">
                <div className="p-4 border-b border-border/50 flex items-center justify-between">
                  <h3 className="font-heading text-sm font-semibold text-foreground">Recurring Schedules</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refetchRecurring()}
                    className="h-7 w-7 p-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <ScrollArea className="h-[400px]">
                  {recurringLoading ? (
                    <div className="p-4 space-y-3">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
                    </div>
                  ) : recurringSchedules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                      <div className="p-3 rounded-full bg-muted/50 mb-3">
                        <Clock className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground">No schedules configured</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 font-mono text-xs"
                        onClick={() => setIsCreateRecurringDialogOpen(true)}
                      >
                        Create Schedule
                      </Button>
                    </div>
                  ) : (
                    <div className="p-2">
                      {recurringSchedules.map((schedule) => (
                        <ScheduleCard
                          key={schedule.id}
                          schedule={schedule}
                          onEdit={() => {
                            setSelectedRecurringSchedule(schedule);
                            setIsEditRecurringDialogOpen(true);
                          }}
                          onDelete={() => {
                            setRecurringToDelete(schedule);
                            setIsDeleteRecurringDialogOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}

            {/* Blocked Times List */}
            {activeTab === 'blocked' && (
              <div className="bg-card rounded-xl border border-border/50">
                <div className="p-4 border-b border-border/50 flex items-center justify-between">
                  <h3 className="font-heading text-sm font-semibold text-foreground">Blocked Times</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refetchBlocked()}
                    className="h-7 w-7 p-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <ScrollArea className="h-[400px]">
                  {blockedTimesLoading ? (
                    <div className="p-4 space-y-3">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
                    </div>
                  ) : blockedTimes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                      <div className="p-3 rounded-full bg-muted/50 mb-3">
                        <Ban className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground">No blocked times</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 font-mono text-xs"
                        onClick={() => setIsCreateBlockedTimeDialogOpen(true)}
                      >
                        Block Time
                      </Button>
                    </div>
                  ) : (
                    <div className="p-2">
                      {blockedTimes.map((blocked) => (
                        <BlockedTimeCard
                          key={blocked.id}
                          blocked={blocked}
                          onEdit={() => {
                            setSelectedBlockedTime(blocked);
                            setIsEditBlockedTimeDialogOpen(true);
                          }}
                          onDelete={() => {
                            setBlockedTimeToDelete(blocked);
                            setIsDeleteBlockedTimeDialogOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <Dialog open={isCreateRecurringDialogOpen} onOpenChange={setIsCreateRecurringDialogOpen}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <CalendarClock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Create Recurring Schedule</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {isDoctor ? 'Your availability' : 'Practitioner availability'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              <RecurringScheduleForm onSuccess={handleCreateRecurringSuccess} />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditRecurringDialogOpen} onOpenChange={setIsEditRecurringDialogOpen}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <CalendarClock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Edit Schedule</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Update schedule details
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              {selectedRecurringSchedule && (
                <RecurringScheduleForm
                  initialData={selectedRecurringSchedule}
                  onSuccess={handleUpdateRecurringSuccess}
                />
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateBlockedTimeDialogOpen} onOpenChange={setIsCreateBlockedTimeDialogOpen}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
                <CalendarX className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Block Time</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Mark as unavailable
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              <BlockedTimeForm
                onSuccess={handleCreateBlockedTimeSuccess}
                onCancel={() => setIsCreateBlockedTimeDialogOpen(false)}
              />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditBlockedTimeDialogOpen} onOpenChange={setIsEditBlockedTimeDialogOpen}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
                <CalendarX className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Edit Blocked Time</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Update blocked time
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              {selectedBlockedTime && (
                <BlockedTimeForm
                  initialData={selectedBlockedTime}
                  onSuccess={handleUpdateBlockedTimeSuccess}
                  onCancel={() => setIsEditBlockedTimeDialogOpen(false)}
                />
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteRecurringDialogOpen} onOpenChange={setIsDeleteRecurringDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this recurring schedule. This action cannot be undone.
            </AlertDialogDescription>
            {recurringToDelete && (
              <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                <p className="font-medium">{recurringToDelete.name}</p>
                <p className="text-sm text-muted-foreground">
                  {getPractitionerName(recurringToDelete)}
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleDeleteRecurring(recurringToDelete?.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteBlockedTimeDialogOpen} onOpenChange={setIsDeleteBlockedTimeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Blocked Time?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the blocked time and make it available for bookings again.
            </AlertDialogDescription>
            {blockedTimeToDelete && (
              <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                <p className="font-medium">{blockedTimeToDelete.reason || 'Blocked Time'}</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(blockedTimeToDelete.date || blockedTimeToDelete.start_date).toLocaleDateString()}
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleDeleteBlockedTime(blockedTimeToDelete?.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
};

/**
 * StatCard - Chronicle-style stats display card
 */
function StatCard({ icon: Icon, label, value, sublabel, color = 'amber' }) {
  const colorClasses = {
    amber: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      icon: 'text-amber-600 dark:text-amber-400',
      value: 'text-amber-600 dark:text-amber-400'
    },
    emerald: {
      bg: 'bg-emerald-100 dark:bg-emerald-900/30',
      icon: 'text-emerald-600 dark:text-emerald-400',
      value: 'text-emerald-600 dark:text-emerald-400'
    },
    rose: {
      bg: 'bg-rose-100 dark:bg-rose-900/30',
      icon: 'text-rose-600 dark:text-rose-400',
      value: 'text-rose-600 dark:text-rose-400'
    },
    sky: {
      bg: 'bg-sky-100 dark:bg-sky-900/30',
      icon: 'text-sky-600 dark:text-sky-400',
      value: 'text-sky-600 dark:text-sky-400'
    },
  };
  const colors = colorClasses[color] || colorClasses.amber;

  return (
    <div className="bg-background/50 rounded-xl p-4 border border-border/50 hover:border-border transition-colors">
      <div className="flex items-center gap-3">
        <div className={cn("p-2.5 rounded-lg", colors.bg)}>
          <Icon className={cn("h-5 w-5", colors.icon)} />
        </div>
        <div className="min-w-0">
          <p className={cn("font-display text-2xl font-bold tabular-nums", colors.value)}>{value}</p>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider truncate">
            {label}
          </p>
          {sublabel && (
            <p className="font-mono text-[10px] text-muted-foreground/70">{sublabel}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ScheduleCard - Chronicle-style recurring schedule display
 */
function ScheduleCard({ schedule, onEdit, onDelete }) {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="p-3 rounded-lg border border-border/50 hover:border-border bg-background/50 transition-colors mb-2">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-heading text-sm font-medium text-foreground truncate">{schedule.name}</h4>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider",
                schedule.is_active
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {schedule.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {schedule.days_of_week.map(day => (
              <span
                key={day}
                className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-mono rounded"
              >
                {dayNames[day]}
              </span>
            ))}
          </div>
          <p className="font-mono text-[10px] text-muted-foreground mt-2">
            {schedule.start_time} – {schedule.end_time} • {schedule.slot_duration}min slots
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[200]">
            <DropdownMenuItem onClick={onEdit} className="text-xs">
              <Edit className="h-3.5 w-3.5 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-xs text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * BlockedTimeCard - Chronicle-style blocked time display
 */
function BlockedTimeCard({ blocked, onEdit, onDelete }) {
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const isDateRange = blocked.start_date && blocked.end_date && blocked.start_date !== blocked.end_date;
  const isPast = new Date(blocked.end_date || blocked.date) < new Date();

  return (
    <div className={cn(
      "p-3 rounded-lg border border-border/50 hover:border-border bg-background/50 transition-colors mb-2",
      isPast && "opacity-50"
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-rose-100 dark:bg-rose-900/30">
              <Ban className="h-3 w-3 text-rose-600 dark:text-rose-400" />
            </div>
            <h4 className="font-heading text-sm font-medium text-foreground truncate">
              {blocked.reason || 'Blocked'}
            </h4>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground mt-2">
            {isDateRange
              ? `${formatDate(blocked.start_date)} – ${formatDate(blocked.end_date)}`
              : formatDate(blocked.date || blocked.start_date)
            }
            {blocked.is_all_day
              ? ' • All Day'
              : ` • ${blocked.start_time} – ${blocked.end_time}`
            }
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[200]">
            <DropdownMenuItem onClick={onEdit} className="text-xs">
              <Edit className="h-3.5 w-3.5 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-xs text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default PractitionerAvailabilityPage;
