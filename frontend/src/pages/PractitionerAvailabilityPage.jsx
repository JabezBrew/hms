import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Calendar, Trash2, Edit, RefreshCw, AlertCircle, CalendarDays, Ban } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

import {
  useRecurringSchedules,
  useDeleteRecurringSchedule,
  useBlockedTimes,
  useDeleteBlockedTime
} from '@/hooks/useAppointmentQueries';
import { useSearchPractitioners } from '@/hooks/useEncounterQueries';
import { cancelSchedule } from '@/lib/api.js';
import RecurringScheduleForm from '@/components/appointments/RecurringScheduleForm';
import BlockedTimeForm from '@/components/appointments/BlockedTimeForm';
import DoctorAvailabilityCalendar from '@/components/appointments/DoctorAvailabilityCalendar';
import { SearchBar } from '@/components/ui/search-bar';


const PractitionerAvailabilityPage = () => {
  // Removed template state

  // Recurring schedule state
  const [selectedRecurringSchedule, setSelectedRecurringSchedule] = useState(null);
  const [isCreateRecurringDialogOpen, setIsCreateRecurringDialogOpen] = useState(false);
  const [isEditRecurringDialogOpen, setIsEditRecurringDialogOpen] = useState(false);
  const [isDeleteRecurringDialogOpen, setIsDeleteRecurringDialogOpen] = useState(false);
  const [recurringToDelete, setRecurringToDelete] = useState(null);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);

  // Blocked Time state
  const [selectedBlockedTime, setSelectedBlockedTime] = useState(null);
  const [isCreateBlockedTimeDialogOpen, setIsCreateBlockedTimeDialogOpen] = useState(false);
  const [isEditBlockedTimeDialogOpen, setIsEditBlockedTimeDialogOpen] = useState(false);
  const [isDeleteBlockedTimeDialogOpen, setIsDeleteBlockedTimeDialogOpen] = useState(false);
  const [blockedTimeToDelete, setBlockedTimeToDelete] = useState(null);

  // Other state
  const [selectedPractitioner, setSelectedPractitioner] = useState(null);
  const navigate = useNavigate();

  // Use React Query hooks for data fetching
  const {
    data: recurringSchedules = [],
    isLoading: recurringLoading,
    isError: isRecurringError,
    error: recurringError
  } = useRecurringSchedules();

  // Search state for practitioners
  const [practitionerSearchQuery, setPractitionerSearchQuery] = useState("");
  const {
    data: practitioners = [],
    isLoading: practitionersLoading,
    searchTerm: practitionerSearchTerm,
    setSearchTerm: setPractitionerSearchTerm
  } = useSearchPractitioners();

  const handleSearchChange = (value) => {
    setPractitionerSearchQuery(value);
    setPractitionerSearchTerm(value);
  };

  // Format practitioner options for SearchBar
  const practitionerOptions = Array.isArray(practitioners) ? practitioners.map(practitioner => {
    // Handle both old and new response structures
    if (practitioner.fhir_resource) {
      // New structure with FHIR resource
      const name = practitioner.fhir_resource.name?.[0];
      const given = name?.given?.join(' ') || '';
      const family = name?.family || '';
      const displayName = `${family}, ${given}`.trim() || 'Unknown Practitioner';
      return {
        label: displayName,
        value: practitioner.local_data?.id || practitioner.fhir_resource.id
      };
    } else if (practitioner.staff_details) {
      // Structure with staff_details
      return {
        label: `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name} - ${practitioner.staff_details?.specialization || 'Practitioner'}`.replace(/\s+/g, ' ').trim(),
        value: practitioner.id
      };
    } else {
      // Fallback to old format
      return {
        label: `${practitioner.user?.full_name || 'Unknown'} - ${practitioner.specialization || 'Practitioner'}`,
        value: practitioner.id
      };
    }
  }) : [];

  const {
    data: blockedTimes = [],
    isLoading: blockedTimesLoading,
    isError: isBlockedTimesError,
    error: blockedTimesError
  } = useBlockedTimes();

  // Use mutation hook for deleting recurring schedules
  const deleteRecurringScheduleMutation = useDeleteRecurringSchedule();
  const deleteBlockedTimeMutation = useDeleteBlockedTime();

  const getUserTypeBadgeColor = (userType) => {
    switch (userType) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'doctor':
        return 'bg-blue-100 text-blue-800';
      case 'nurse':
        return 'bg-green-100 text-green-800';
      case 'receptionist':
        return 'bg-purple-100 text-purple-800';
      case 'lab_technician':
        return 'bg-yellow-100 text-yellow-800';
      case 'pharmacist':
        return 'bg-indigo-100 text-indigo-800';
      case 'billing':
        return 'bg-pink-100 text-pink-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Function to format user type for display
  const formatUserType = (userType) => {
    if (!userType) return '';
    return userType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Removed template loading useEffect

  // Show error toasts if queries fail
  if (isRecurringError) {
    toast.error(recurringError?.message || 'Failed to load recurring schedules');
    console.error('Error loading recurring schedules:', recurringError);
  }

  // Removed practitioners error check as search hook handles it differently or silently

  if (isBlockedTimesError) {
    toast.error(blockedTimesError?.message || 'Failed to load blocked times');
    console.error('Error loading blocked times:', blockedTimesError);
  }

  // Removed template handler functions

  // Handle recurring schedule creation success
  const handleCreateRecurringSuccess = (newSchedule) => {
    // No need to manually update the state as React Query will automatically refetch
    setIsCreateRecurringDialogOpen(false);
    toast.success('Recurring schedule created successfully');
  };

  // Handle recurring schedule update success
  const handleUpdateRecurringSuccess = (updatedSchedule) => {
    // No need to manually update the state as React Query will automatically refetch
    setIsEditRecurringDialogOpen(false);
    toast.success('Recurring schedule updated successfully');
  };

  // Handle recurring schedule deletion
  const handleDeleteRecurring = async (scheduleId) => {
    if (!recurringToDelete) return;

    deleteRecurringScheduleMutation.mutate(scheduleId, {
      onSuccess: () => {
        // No need to manually update the state as React Query will automatically refetch
        setIsDeleteRecurringDialogOpen(false);
        toast.success('Recurring schedule deleted successfully');
      },
      onError: (error) => {
        console.error('Error deleting recurring schedule:', error);
        toast.error('Failed to delete recurring schedule');
      }
    });
  };

  // Handle blocked time deletion
  const handleDeleteBlockedTime = async (id) => {
    if (!blockedTimeToDelete) return;

    deleteBlockedTimeMutation.mutate(id, {
      onSuccess: () => {
        setIsDeleteBlockedTimeDialogOpen(false);
        toast.success('Blocked time deleted successfully');
      },
      onError: (error) => {
        console.error('Error deleting blocked time:', error);
        toast.error('Failed to delete blocked time');
      }
    });
  };

  const handleCreateBlockedTimeSuccess = () => {
    setIsCreateBlockedTimeDialogOpen(false);
    toast.success('Blocked time created successfully');
  };

  const handleUpdateBlockedTimeSuccess = () => {
    setIsEditBlockedTimeDialogOpen(false);
    toast.success('Blocked time updated successfully');
  };

  // Removed generate schedule handler function

  // Helper to get practitioner name from schedule/blocked object if available
  // The serializer now includes practitioner_name, so we can use that directly.
  // If not, we fall back to "Unknown" or ID.
  const getPractitionerName = (item) => {
    return item.practitioner_name || 'Unknown';
  };

  // Removed getTemplateName function

  // Render loading state for all tabs
  if (recurringLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-10 w-24" />
        </div>
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Practitioner Availability</h1>
        <div className="flex space-x-2">
          <Button onClick={() => setIsCreateBlockedTimeDialogOpen(true)} variant="outline">
            <Ban className="mr-2 h-4 w-4" />
            Block Time
          </Button>
          <Button onClick={() => setIsCreateRecurringDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Recurring Schedule
          </Button>
        </div>
      </div>

      <Tabs defaultValue="recurring" className="w-full">
        <TabsList>
          <TabsTrigger value="recurring">Recurring Schedules</TabsTrigger>
          <TabsTrigger value="blocked">Blocked Times</TabsTrigger>
          <TabsTrigger value="calendar">Calendar View</TabsTrigger>
        </TabsList>

        <TabsContent value="recurring" className="space-y-4">
          {recurringLoading ? (
            <Skeleton className="h-[400px] w-full" />
          ) : recurringSchedules.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No Recurring Schedules</CardTitle>
                <CardDescription>
                  Create a recurring schedule to define when practitioners are available for appointments.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button onClick={() => setIsCreateRecurringDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Recurring Schedule
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Practitioner</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Active Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recurringSchedules.map((schedule) => (
                    <TableRow key={schedule.id}>
                      <TableCell className="font-medium">{schedule.name}</TableCell>

                      <TableCell>{getPractitionerName(schedule)}</TableCell>
                      <TableCell>
                        {schedule.days_of_week.map(day => {
                          const dayName = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day];
                          return (
                            <Badge key={day} variant="outline" className="mr-1">
                              {dayName}
                            </Badge>
                          );
                        })}
                      </TableCell>
                      <TableCell>
                        {schedule.start_time} - {schedule.end_time}
                      </TableCell>
                      <TableCell>{schedule.slot_duration} min</TableCell>
                      <TableCell>
                        {new Date(schedule.active_from).toLocaleDateString()}
                        {schedule.active_to ? ` - ${new Date(schedule.active_to).toLocaleDateString()}` : ' - ∞'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={schedule.is_active ? "success" : "secondary"}>
                          {schedule.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <span className="sr-only">Open menu</span>
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                <circle cx="12" cy="12" r="1"></circle>
                                <circle cx="12" cy="5" r="1"></circle>
                                <circle cx="12" cy="19" r="1"></circle>
                              </svg>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedRecurringSchedule(schedule);
                                setIsEditRecurringDialogOpen(true);
                              }}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                setRecurringToDelete(schedule);
                                setIsDeleteRecurringDialogOpen(true);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="blocked" className="space-y-4">
          {blockedTimesLoading ? (
            <Skeleton className="h-[400px] w-full" />
          ) : blockedTimes.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No Blocked Times</CardTitle>
                <CardDescription>
                  Create a blocked time entry to mark periods when practitioners are unavailable (e.g., vacations, emergencies).
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button onClick={() => setIsCreateBlockedTimeDialogOpen(true)}>
                  <Ban className="mr-2 h-4 w-4" />
                  Block Time
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Practitioner</TableHead>
                    <TableHead>Date / Range</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blockedTimes.map((blocked) => (
                    <TableRow key={blocked.id}>
                      <TableCell>{getPractitionerName(blocked)}</TableCell>
                      <TableCell>
                        {blocked.start_date && blocked.end_date && blocked.start_date !== blocked.end_date ? (
                          <span>{new Date(blocked.start_date).toLocaleDateString()} - {new Date(blocked.end_date).toLocaleDateString()}</span>
                        ) : (
                          <span>{new Date(blocked.date).toLocaleDateString()}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {blocked.is_all_day ? (
                          <Badge variant="outline">All Day</Badge>
                        ) : (
                          <span>{blocked.start_time} - {blocked.end_time}</span>
                        )}
                      </TableCell>
                      <TableCell>{blocked.reason}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <span className="sr-only">Open menu</span>
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                <circle cx="12" cy="12" r="1"></circle>
                                <circle cx="12" cy="5" r="1"></circle>
                                <circle cx="12" cy="19" r="1"></circle>
                              </svg>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedBlockedTime(blocked);
                                setIsEditBlockedTimeDialogOpen(true);
                              }}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                setBlockedTimeToDelete(blocked);
                                setIsDeleteBlockedTimeDialogOpen(true);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>



        <TabsContent value="calendar" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Practitioner Availability Calendar</CardTitle>
                <CardTitle>Practitioner Availability Calendar</CardTitle>
                <div className="w-[300px]">
                  <SearchBar
                    options={practitionerOptions}
                    value={selectedPractitioner}
                    onChange={setSelectedPractitioner}
                    onInputChange={handleSearchChange}
                    placeholder="Search practitioner..."
                    emptyMessage={practitionersLoading ? "Searching..." : "No practitioners found."}
                    searchPlaceholder="Search by name..."
                    maxHeight="20rem"
                    isLoading={practitionersLoading}
                  />
                </div>
              </div>
              <CardDescription>
                View practitioner availability in a calendar format. Select a practitioner to see their available days and time slots.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedPractitioner ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CalendarDays className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Please select a practitioner to view their availability.</p>
                </div>
              ) : (
                <DoctorAvailabilityCalendar
                  practitionerId={selectedPractitioner}
                  onSlotSelect={(slot) => {
                    toast.info(`Selected slot: ${new Date(slot.start).toLocaleTimeString()} - ${new Date(slot.end).toLocaleTimeString()}`);
                  }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Removed template-related dialogs */}

      {/* Create Recurring Schedule Dialog */}
      <Dialog open={isCreateRecurringDialogOpen} onOpenChange={setIsCreateRecurringDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Create Recurring Schedule</DialogTitle>
            <DialogDescription>
              Create a new recurring schedule for a practitioner.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-1">
              <RecurringScheduleForm
                onSuccess={handleCreateRecurringSuccess}
              />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Edit Recurring Schedule Dialog */}
      <Dialog open={isEditRecurringDialogOpen} onOpenChange={setIsEditRecurringDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Recurring Schedule</DialogTitle>
            <DialogDescription>
              Update the recurring schedule details.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-1">
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

      {/* Create Blocked Time Dialog */}
      <Dialog open={isCreateBlockedTimeDialogOpen} onOpenChange={setIsCreateBlockedTimeDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Block Time</DialogTitle>
            <DialogDescription>
              Block time for a practitioner (e.g. vacation, emergency).
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-1">
              <BlockedTimeForm
                onSuccess={handleCreateBlockedTimeSuccess}
                onCancel={() => setIsCreateBlockedTimeDialogOpen(false)}
              />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Edit Blocked Time Dialog */}
      <Dialog open={isEditBlockedTimeDialogOpen} onOpenChange={setIsEditBlockedTimeDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Blocked Time</DialogTitle>
            <DialogDescription>
              Update the blocked time details.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-1">
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

      {/* Delete Recurring Schedule Alert Dialog */}
      <AlertDialog open={isDeleteRecurringDialogOpen} onOpenChange={setIsDeleteRecurringDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recurring Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this recurring schedule? This action cannot be undone.
            </AlertDialogDescription>
            {recurringToDelete && (
              <div className="mt-2 font-medium">{recurringToDelete.name}</div>
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

      {/* Delete Blocked Time Alert Dialog */}
      <AlertDialog open={isDeleteBlockedTimeDialogOpen} onOpenChange={setIsDeleteBlockedTimeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Blocked Time</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this blocked time? This will make the time available for booking again.
            </AlertDialogDescription>
            {blockedTimeToDelete && (
              <div className="mt-2 font-medium">
                {blockedTimeToDelete.reason} ({new Date(blockedTimeToDelete.date || blockedTimeToDelete.start_date).toLocaleDateString()})
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
    </div>
  );
};

export default PractitionerAvailabilityPage;
