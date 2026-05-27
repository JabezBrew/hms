/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
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
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

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
  useAvailabilityRules,
  useDeleteAvailabilityRule,
  useBlockedTimes,
  useDeleteBlockedTime
} from '@/features/appointments/hooks/useAppointmentQueries';
import { useSearchPractitioners } from '@/features/encounters/hooks/useEncounterQueries';
import { usePractitioner } from '@/features/staff/hooks';
import PersonalCalendarForm from '@/features/appointments/components/PersonalCalendarForm';
import BlockedTimeForm from '@/features/appointments/components/BlockedTimeForm';
import DoctorAvailabilityCalendar from '@/features/appointments/components/DoctorAvailabilityCalendar';
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
  const { search, state } = useLocation();
  const { user } = useAuth();
  const userRole = user?.role;
  const isDoctor = userRole === 'doctor';
  const availabilityMutationsAvailable = !isRustV2ApiMode();
  const practitionerFromState = state?.practitionerId
    ? String(state.practitionerId)
    : null;
  const queryParams = useMemo(() => new URLSearchParams(search), [search]);
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
    if (practitionerFromState) {
      return practitionerFromState;
    }
    if (practitionerFromQuery) {
      return String(practitionerFromQuery);
    }
    return null;
  }, [isDoctor, practitionerFromQuery, practitionerFromState, user?.practitionerId]);

  // Keep selection synchronized when arriving via redirect query params.
  const [selectedPractitioner, setSelectedPractitioner] = useState(desiredSelectedPractitioner);
  useEffect(() => {
    setSelectedPractitioner((current) => (
      current === desiredSelectedPractitioner ? current : desiredSelectedPractitioner
    ));
  }, [desiredSelectedPractitioner]);

  // Dialog states
  const [isCreateAvailabilityDialogOpen, setIsCreateAvailabilityDialogOpen] = useState(false);
  const [isEditAvailabilityDialogOpen, setIsEditAvailabilityDialogOpen] = useState(false);
  const [isDeleteAvailabilityDialogOpen, setIsDeleteAvailabilityDialogOpen] = useState(false);
  const [selectedAvailabilityRule, setSelectedAvailabilityRule] = useState(null);
  const [availabilityToDelete, setAvailabilityToDelete] = useState(null);

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

  // Fetch data - pass filters so doctors only see their own personal calendar rules
  // and the query key matches what DoctorAvailabilityCalendar uses
  const {
    data: availabilityRules = [],
    isLoading: availabilityLoading,
    isError: isAvailabilityError,
    error: availabilityError,
    refetch: refetchAvailability
  } = useAvailabilityRules(scheduleFilters);

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

  const { data: selectedPractitionerDetails } = usePractitioner(selectedPractitioner);

  const selectedPractitionerLabel = useMemo(() => {
    if (!selectedPractitionerDetails) return null;

    if (selectedPractitionerDetails?.name) {
      return selectedPractitionerDetails.name;
    }

    const userDetails = selectedPractitionerDetails?.staff_details?.user_details
      || selectedPractitionerDetails?.staff?.user_details
      || selectedPractitionerDetails?.staff?.user
      || selectedPractitionerDetails?.user;

    const first = userDetails?.first_name || '';
    const last = userDetails?.last_name || '';
    const full = `${first} ${last}`.trim();
    return full || null;
  }, [selectedPractitionerDetails]);

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
        label: selectedPractitionerLabel || 'Selected practitioner',
        value: String(selectedPractitioner),
      },
      ...options,
    ];
  }, [practitioners, selectedPractitioner, selectedPractitionerLabel]);

  // Mutations
  const deleteAvailabilityMutation = useDeleteAvailabilityRule();
  const deleteBlockedTimeMutation = useDeleteBlockedTime();

  // Calculate stats
  const stats = useMemo(() => {
    const activeSchedules = availabilityRules.filter(s => s.is_active).length;
    const totalSchedules = availabilityRules.length;
    const activeBlocks = blockedTimes.filter(b => {
      const endDate = new Date(b.end_date || b.date);
      return endDate >= new Date();
    }).length;
    return { activeSchedules, totalSchedules, activeBlocks, totalBlocks: blockedTimes.length };
  }, [availabilityRules, blockedTimes]);

  // Error handling
  if (isAvailabilityError) {
    toast.error(availabilityError?.message || 'Failed to load personal calendar rules');
  }
  if (isBlockedTimesError) {
    toast.error(blockedTimesError?.message || 'Failed to load blocked times');
  }

  // Handlers
  const handleCreateAvailabilitySuccess = () => {
    setIsCreateAvailabilityDialogOpen(false);
    toast.success('Personal calendar rule created successfully');
  };

  const handleUpdateAvailabilitySuccess = () => {
    setIsEditAvailabilityDialogOpen(false);
    toast.success('Personal calendar rule updated successfully');
  };

  const handleDeleteAvailability = (scheduleId) => {
    deleteAvailabilityMutation.mutate(scheduleId, {
      onSuccess: () => {
        setIsDeleteAvailabilityDialogOpen(false);
        toast.success('Personal calendar rule deleted successfully');
      },
      onError: (_error) => {
        toast.error('Failed to delete personal calendar rule');
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
  if (availabilityLoading && blockedTimesLoading) {
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
                ? 'View your calendar and blocked time'
                : 'Manage personal calendars and blocked time'
            }
            actions={availabilityMutationsAvailable ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="font-mono text-xs"
                  onClick={() => setIsCreateBlockedTimeDialogOpen(true)}
                >
                  <Ban className="size-3.5 mr-1.5" />
                  Block Time
                </Button>
                <Button
                  className="bg-amber-600 hover:bg-amber-700 font-mono text-xs"
                  onClick={() => setIsCreateAvailabilityDialogOpen(true)}
                >
                  <Plus className="size-3.5 mr-1.5" />
                  New Rule
                </Button>
              </div>
            ) : null}
          />

          {!availabilityMutationsAvailable && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              Availability rule and blocked-time management is not available in this deployment yet.
              Calendar availability remains read-only until scheduling management is enabled.
            </div>
          )}

          {/* Stats */}
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
                    <CalendarDays className="size-8 text-amber-600 dark:text-amber-400" />
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
                type="button"
                onClick={() => setActiveTab('schedules')}
                className={cn(
                  "flex-1 py-2 px-4 font-mono text-xs rounded-md transition-colors",
                  activeTab === 'schedules'
                    ? "bg-card text-foreground shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Personal Calendar
              </button>
              <button
                type="button"
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

            {/* Personal calendar rules list */}
            {activeTab === 'schedules' && (
              <div className="bg-card rounded-xl border border-border/50">
                <div className="p-4 border-b border-border/50 flex items-center justify-between">
                  <h3 className="font-heading text-sm font-semibold text-foreground">Personal Calendar</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refetchAvailability()}
                    className="size-7 p-0"
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </div>
                <ScrollArea className="h-[400px]">
                  {availabilityLoading ? (
                    <div className="p-4 space-y-3">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
                    </div>
                  ) : availabilityRules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                      <div className="p-3 rounded-full bg-muted/50 mb-3">
                        <Clock className="size-6 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground">No personal calendar rules configured</p>
                      {availabilityMutationsAvailable && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 font-mono text-xs"
                          onClick={() => setIsCreateAvailabilityDialogOpen(true)}
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
                          canMutate={availabilityMutationsAvailable}
                          onEdit={() => {
                            setSelectedAvailabilityRule(schedule);
                            setIsEditAvailabilityDialogOpen(true);
                          }}
                          onDelete={() => {
                            setAvailabilityToDelete(schedule);
                            setIsDeleteAvailabilityDialogOpen(true);
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
                    className="size-7 p-0"
                  >
                    <RefreshCw className="size-3.5" />
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
                        <Ban className="size-6 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground">No blocked times</p>
                      {availabilityMutationsAvailable && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 font-mono text-xs"
                          onClick={() => setIsCreateBlockedTimeDialogOpen(true)}
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
                          canMutate={availabilityMutationsAvailable}
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
      <Dialog open={isCreateAvailabilityDialogOpen} onOpenChange={setIsCreateAvailabilityDialogOpen}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <CalendarClock className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Create Personal Calendar Rule</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {isDoctor ? 'Your availability' : 'Practitioner availability'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              <PersonalCalendarForm onSuccess={handleCreateAvailabilitySuccess} />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditAvailabilityDialogOpen} onOpenChange={setIsEditAvailabilityDialogOpen}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <CalendarClock className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Edit Personal Calendar Rule</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Update calendar details
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              {selectedAvailabilityRule && (
                <PersonalCalendarForm
                  initialData={selectedAvailabilityRule}
                  onSuccess={handleUpdateAvailabilitySuccess}
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
              <div className="flex size-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
                <CalendarX className="size-5 text-rose-600 dark:text-rose-400" />
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
              <div className="flex size-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
                <CalendarX className="size-5 text-rose-600 dark:text-rose-400" />
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

      <AlertDialog open={isDeleteAvailabilityDialogOpen} onOpenChange={setIsDeleteAvailabilityDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Personal Calendar Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this personal calendar rule. This action cannot be undone.
            </AlertDialogDescription>
            {availabilityToDelete && (
              <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                <p className="font-medium">{availabilityToDelete.name}</p>
                <p className="text-sm text-muted-foreground">
                  {getPractitionerName(availabilityToDelete)}
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleDeleteAvailability(availabilityToDelete?.id)}
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
          <Icon className={cn("size-5", colors.icon)} />
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
 * ScheduleCard - Chronicle-style personal calendar rule display
 */
function ScheduleCard({ schedule, canMutate = true, onEdit, onDelete }) {
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
        {canMutate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0">
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[200]">
              <DropdownMenuItem onClick={onEdit} className="text-xs">
                <Edit className="size-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-xs text-destructive">
                <Trash2 className="size-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

/**
 * BlockedTimeCard - Chronicle-style blocked time display
 */
function BlockedTimeCard({ blocked, canMutate = true, onEdit, onDelete }) {
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
              <Ban className="size-3 text-rose-600 dark:text-rose-400" />
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
        {canMutate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0">
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[200]">
              <DropdownMenuItem onClick={onEdit} className="text-xs">
                <Edit className="size-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-xs text-destructive">
                <Trash2 className="size-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

export default PractitionerAvailabilityPage;
