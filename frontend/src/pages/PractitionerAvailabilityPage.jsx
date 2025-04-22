import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Calendar, Trash2, Edit, RefreshCw, AlertCircle, CalendarDays } from 'lucide-react';

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
  useDeleteRecurringSchedule 
} from '@/hooks/useAppointmentQueries';
import { 
  useScheduleMappings 
} from '@/hooks/useAppointmentQueries';
import { 
  usePractitioners 
} from '@/hooks/useStaffQueries';
import { batchGenerateSlots, cancelSchedule } from '@/lib/api.js';
import RecurringScheduleForm from '@/components/appointments/RecurringScheduleForm';
import DoctorAvailabilityCalendar from '@/components/appointments/DoctorAvailabilityCalendar';


const PractitionerAvailabilityPage = () => {
  // Removed template state

  // Recurring schedule state
  const [selectedRecurringSchedule, setSelectedRecurringSchedule] = useState(null);
  const [isCreateRecurringDialogOpen, setIsCreateRecurringDialogOpen] = useState(false);
  const [isEditRecurringDialogOpen, setIsEditRecurringDialogOpen] = useState(false);
  const [isDeleteRecurringDialogOpen, setIsDeleteRecurringDialogOpen] = useState(false);
  const [recurringToDelete, setRecurringToDelete] = useState(null);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);

  // Schedule state
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);

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

  const { 
    data: schedules = [], 
    isLoading: schedulesLoading, 
    isError: isSchedulesError,
    error: schedulesError,
    refetch: refetchSchedules
  } = useScheduleMappings();

  const { 
    data: practitioners = [], 
    isLoading: practitionersLoading, 
    isError: isPractitionersError,
    error: practitionersError
  } = usePractitioners();

  // Use mutation hook for deleting recurring schedules
  const deleteRecurringScheduleMutation = useDeleteRecurringSchedule();

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

  if (isSchedulesError) {
    toast.error(schedulesError?.message || 'Failed to load schedules');
    console.error('Error loading schedules:', schedulesError);
  }

  if (isPractitionersError) {
    toast.error(practitionersError?.message || 'Failed to load practitioners');
    console.error('Error loading practitioners:', practitionersError);
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

  // Handle batch generate slots
  const handleBatchGenerateSlots = async () => {
    setIsGeneratingBatch(true);
    try {
      const result = await batchGenerateSlots();

      if (result.total_slots_created === 0 && result.total_practitioners > 0) {
        // If no slots were created but practitioners were found, slots likely already exist
        toast.info(`No new slots generated. Slots have already been created for ${result.total_practitioners} practitioners.`);
      } else {
        // Original success message for when slots are created
        toast.success(`Generated ${result.total_slots_created} slots for ${result.total_practitioners} practitioners`);
      }

      // Refetch schedules after successful generation
      refetchSchedules();
    } catch (error) {
      console.error('Error batch generating slots:', error);
      toast.error('Failed to generate slots');
    } finally {
      setIsGeneratingBatch(false);
    }
  };

  // Removed generate schedule handler function

  // Handle cancel schedule
  const handleCancelSchedule = async () => {
    if (!selectedSchedule) return;

    try {
      await cancelSchedule(selectedSchedule.id);
      // Refetch schedules after successful cancellation
      refetchSchedules();
      setIsCancelDialogOpen(false);
      toast.success('Schedule cancelled successfully');
    } catch (error) {
      console.error('Error cancelling schedule:', error);
      toast.error('Failed to cancel schedule');
    }
  };

  // Find practitioner name by ID
  const getPractitionerName = (practitionerId) => {
    const practitioner = practitioners.find(p => p.id === practitionerId);
    if (!practitioner) return 'Unknown';

    return `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name}`;
  };

  const getPractitionerType = (practitionerId) => {
    const practitioner = practitioners.find(p => p.id === practitionerId);
    if (!practitioner) return <Badge>Unknown</Badge>;

    return <Badge className={getUserTypeBadgeColor(practitioner.staff_details?.user_details?.user_type)}>
      {formatUserType(practitioner.staff_details?.user_details?.user_type)}
    </Badge>
  }

  // Removed getTemplateName function

  // Render loading state for all tabs
  if (recurringLoading && schedulesLoading && practitionersLoading) {
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
            <Button
              onClick={handleBatchGenerateSlots}
              variant="outline"
              disabled={isGeneratingBatch}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isGeneratingBatch ? 'animate-spin' : ''}`} />
              {isGeneratingBatch ? 'Generating...' : 'Generate Slots'}
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
            <TabsTrigger value="schedules">Generated Schedules</TabsTrigger>
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
                        <TableCell>{getPractitionerName(schedule.practitioner)}</TableCell>
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

          {/* Removed templates tab content */}

          <TabsContent value="schedules" className="space-y-4">
            {schedulesLoading ? (
                <Skeleton className="h-[400px] w-full" />
            ) : schedules.length === 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>No Generated Schedules</CardTitle>
                    <CardDescription>
                      No schedules have been generated yet. Schedules are automatically generated from recurring schedules.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Create a recurring schedule and click "Generate Slots" to generate schedules.
                    </p>
                  </CardContent>
                </Card>
            ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Practitioner</TableHead>
                        <TableHead>Date Range</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Slots</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schedules.map((schedule) => (
                          <TableRow key={schedule.id}>
                            <TableCell className="font-mono text-xs">{schedule.id.substring(0, 8)}...</TableCell>
                            <TableCell>{getPractitionerName(schedule.practitioner)}</TableCell>
                            <TableCell>
                              {new Date(schedule.start_date).toLocaleDateString()} - {new Date(schedule.end_date).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Badge variant={
                                schedule.status === 'active' ? 'success' :
                                    schedule.status === 'cancelled' ? 'destructive' :
                                        'secondary'
                              }>
                                {schedule.status === 'active' ? 'Active' :
                                    schedule.status === 'cancelled' ? 'Cancelled' :
                                        schedule.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{schedule.slots_count || 0}</TableCell>
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
                                      onClick={() => navigate(`/schedules/${schedule.id}/slots`)}
                                  >
                                    <Calendar className="mr-2 h-4 w-4" />
                                    View Slots
                                  </DropdownMenuItem>
                                  {schedule.status === 'active' && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            className="text-destructive"
                                            onClick={() => {
                                              setSelectedSchedule(schedule);
                                              setIsCancelDialogOpen(true);
                                            }}
                                        >
                                          <AlertCircle className="mr-2 h-4 w-4" />
                                          Cancel Schedule
                                        </DropdownMenuItem>
                                      </>
                                  )}
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
                  <div className="flex space-x-2">
                    <select
                      className="px-3 py-2 rounded-md border border-input bg-background text-sm"
                      value={selectedPractitioner || ''}
                      onChange={(e) => setSelectedPractitioner(e.target.value)}
                    >
                      <option value="">Select a practitioner</option>
                      {practitioners.map((practitioner) => (
                        <option key={practitioner.id} value={practitioner.id}>
                          {practitioner.staff_details?.user_details?.first_name} {practitioner.staff_details?.user_details?.last_name}
                        </option>
                      ))}
                    </select>
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

        {/* Cancel Schedule Alert Dialog */}
        <AlertDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Schedule</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to cancel this schedule? This will mark all available slots as unavailable and prevent any new appointments from being scheduled.
                <br/><br/>
                <span className="font-semibold">Note:</span> Existing appointments will not be affected, but you'll need to manually reschedule them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleCancelSchedule} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Yes, Cancel Schedule
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
  );
};

export default PractitionerAvailabilityPage;
