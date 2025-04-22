import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { 
  Calendar, 
  Clock, 
  User, 
  UserRound, 
  FileText, 
  MessageSquare,
  Edit,
  Trash2,
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import {toast} from 'sonner';
import { 
  useAppointment, 
  useUpdateAppointmentStatus, 
  useDeleteAppointment 
} from '@/hooks/useAppointmentQueries';

// Status badge colors
const statusColors = {
  proposed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  booked: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  arrived: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  fulfilled: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  noshow: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
};

const AppointmentDetail = ({ appointmentId, onBack }) => {
  const navigate = useNavigate();

  // Use React Query hooks for data fetching
  const { 
    data: appointment, 
    isLoading, 
    isError, 
    error 
  } = useAppointment(appointmentId);

  // Show error toast if query fails
  useEffect(() => {
    if (isError) {
      toast.error(error?.message || 'Failed to load appointment details');
      console.error('Error loading appointment:', error);
    }
  }, [isError, error]);

  // Format date and time
  const formatDateTime = (dateTimeString) => {
    if (!dateTimeString) return 'N/A';
    try {
      const dateTime = parseISO(dateTimeString);
      return format(dateTime, 'MMMM d, yyyy h:mm a');
    } catch (error) {
      return 'Invalid date';
    }
  };

  // Get patient details
  const getPatientDetails = () => {
    if (!appointment) return { name: 'Unknown', id: '' };

    const patientParticipant = appointment.participant?.find(p => 
      p.actor?.reference?.startsWith('Patient/'));

    if (!patientParticipant) return { name: 'Unknown', id: '' };

    const reference = patientParticipant.actor?.reference || '';
    const id = reference.split('/')[1] || '';
    const name = patientParticipant.actor?.display || 'Unknown Patient';

    return { name, id };
  };

  // Get practitioner details
  const getPractitionerDetails = () => {
    if (!appointment) return { name: 'Unknown', id: '' };

    const practitionerParticipant = appointment.participant?.find(p => 
      p.actor?.reference?.startsWith('Practitioner/'));

    if (!practitionerParticipant) return { name: 'Unknown', id: '' };

    const reference = practitionerParticipant.actor?.reference || '';
    const id = reference.split('/')[1] || '';
    const name = practitionerParticipant.actor?.display || 'Unknown Practitioner';

    return { name, id };
  };

  // Get appointment type
  const getAppointmentType = () => {
    if (!appointment || !appointment.appointmentType) return 'General';

    return appointment.appointmentType.coding?.[0]?.display || 'General';
  };

  // Get appointment duration in minutes
  const getAppointmentDuration = () => {
    if (!appointment || !appointment.start || !appointment.end) return 'N/A';

    try {
      const start = parseISO(appointment.start);
      const end = parseISO(appointment.end);
      const durationMs = end.getTime() - start.getTime();
      const durationMinutes = Math.round(durationMs / (1000 * 60));

      return `${durationMinutes} minutes`;
    } catch (error) {
      return 'N/A';
    }
  };

  // Use the update appointment status mutation
  const updateStatusMutation = useUpdateAppointmentStatus();

  // Handle status update
  const handleStatusUpdate = (newStatus) => {
    updateStatusMutation.mutate(
      { id: appointmentId, status: newStatus },
      {
        onSuccess: () => {
          toast.success(`Appointment status updated to ${newStatus}`);
        },
        onError: (error) => {
          console.error('Error updating appointment status:', error);
          toast.error(error.message || 'Failed to update appointment status');
        }
      }
    );
  };

  // Use the delete appointment mutation
  const deleteMutation = useDeleteAppointment();

  // Handle appointment deletion
  const handleDelete = () => {
    deleteMutation.mutate(appointmentId, {
      onSuccess: () => {
        toast.success('Appointment deleted successfully');

        // Navigate back to appointments list
        if (onBack) {
          onBack();
        } else {
          navigate('/appointments');
        }
      },
      onError: (error) => {
        console.error('Error deleting appointment:', error);
        toast.error(error.message || 'Failed to delete appointment');
      }
    });
  };

  // Handle edit appointment
  const handleEdit = () => {
    navigate(`/appointments/${appointmentId}/edit`);
  };

  // Handle back navigation
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate('/appointments');
    }
  };

  // Render loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="ml-4 space-y-2">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
          </div>
        </div>
        <Skeleton className="h-[200px] w-full rounded-md" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-[100px] w-full rounded-md" />
          <Skeleton className="h-[100px] w-full rounded-md" />
        </div>
        <div className="flex justify-between">
          <Skeleton className="h-10 w-[100px]" />
          <div className="space-x-2">
            <Skeleton className="h-10 w-[100px] inline-block" />
            <Skeleton className="h-10 w-[100px] inline-block" />
          </div>
        </div>
      </div>
    );
  }

  // If appointment not found
  if (!appointment) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Appointment Not Found</CardTitle>
          <CardDescription>
            The appointment you're looking for doesn't exist or has been deleted.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Appointments
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const patient = getPatientDetails();
  const practitioner = getPractitionerDetails();

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" onClick={handleBack} className="mb-4 pl-0">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Appointments
      </Button>

      {/* Appointment header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Appointment Details
          </h1>
          <p className="text-muted-foreground">
            {formatDateTime(appointment.start)}
          </p>
        </div>

        <div className="mt-4 md:mt-0 flex items-center space-x-2">
          <Badge 
            variant="outline" 
            className={statusColors[appointment.status] || ""}
          >
            {appointment.status?.charAt(0).toUpperCase() + appointment.status?.slice(1) || 'Unknown'}
          </Badge>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={updateStatusMutation.isPending}>
                Change Status
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Update Appointment Status</DialogTitle>
                <DialogDescription>
                  Select a new status for this appointment.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => handleStatusUpdate('proposed')}
                  disabled={appointment.status === 'proposed' || updateStatusMutation.isPending}
                >
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mr-2"></div>
                    Proposed
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => handleStatusUpdate('pending')}
                  disabled={appointment.status === 'pending' || updateStatusMutation.isPending}
                >
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-yellow-500 mr-2"></div>
                    Pending
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => handleStatusUpdate('booked')}
                  disabled={appointment.status === 'booked' || updateStatusMutation.isPending}
                >
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>
                    Booked
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => handleStatusUpdate('arrived')}
                  disabled={appointment.status === 'arrived' || updateStatusMutation.isPending}
                >
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-purple-500 mr-2"></div>
                    Arrived
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => handleStatusUpdate('fulfilled')}
                  disabled={appointment.status === 'fulfilled' || updateStatusMutation.isPending}
                >
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 mr-2"></div>
                    Fulfilled
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => handleStatusUpdate('cancelled')}
                  disabled={appointment.status === 'cancelled' || updateStatusMutation.isPending}
                >
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-red-500 mr-2"></div>
                    Cancelled
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => handleStatusUpdate('noshow')}
                  disabled={appointment.status === 'noshow' || updateStatusMutation.isPending}
                >
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-gray-500 mr-2"></div>
                    No Show
                  </div>
                </Button>
              </div>
              <DialogFooter>
                <Button variant="outline" disabled={updateStatusMutation.isPending}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left column - Appointment details */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Appointment Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">Type</div>
                <div className="flex items-center">
                  <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                  {getAppointmentType()}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">Duration</div>
                <div className="flex items-center">
                  <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
                  {getAppointmentDuration()}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">Start Time</div>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                  {formatDateTime(appointment.start)}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">End Time</div>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                  {formatDateTime(appointment.end)}
                </div>
              </div>
            </div>

            <Separator />

            {appointment.description && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">Description</div>
                <p>{appointment.description}</p>
              </div>
            )}

            {appointment.comment && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">Comments</div>
                <div className="flex items-start">
                  <MessageSquare className="h-4 w-4 mr-2 text-muted-foreground mt-0.5" />
                  <p>{appointment.comment}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column - Patient and Practitioner */}
        <Card>
          <CardHeader>
            <CardTitle>Participants</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Patient</div>
              <div className="flex items-center">
                <User className="h-5 w-5 mr-2 text-muted-foreground" />
                <div>
                  <div className="font-medium">{patient.name}</div>
                  <Button 
                    variant="link" 
                    className="p-0 h-auto text-sm text-muted-foreground"
                    onClick={() => navigate(`/patients/${patient.id}`)}
                  >
                    View Patient Profile
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Practitioner</div>
              <div className="flex items-center">
                <UserRound className="h-5 w-5 mr-2 text-muted-foreground" />
                <div>
                  <div className="font-medium">{practitioner.name}</div>
                  <Button 
                    variant="link" 
                    className="p-0 h-auto text-sm text-muted-foreground"
                    onClick={() => navigate(`/practitioners/${practitioner.id}`)}
                  >
                    View Practitioner Profile
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex justify-between">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={deleteMutation.isPending}>
              <Trash2 className="mr-2 h-4 w-4" />
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Appointment'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the appointment.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="space-x-2">
          <Button variant="outline" onClick={handleBack}>
            Cancel
          </Button>
          <Button onClick={handleEdit}>
            <Edit className="mr-2 h-4 w-4" />
            Edit Appointment
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AppointmentDetail;
