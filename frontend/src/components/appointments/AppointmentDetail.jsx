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
  AlertCircle,
  Stethoscope
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
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
import {toast} from 'sonner';
import {
  useAppointment,
  useUpdateAppointmentStatus,
  useDeleteAppointment
} from '@/hooks/useAppointmentQueries';

// Chronicle Design System status colors
// Using amber for pending/proposed, emerald for confirmed, rose for cancelled, sky for info
const statusConfig = {
  proposed: {
    badge: "bg-[oklch(0.70_0.15_230_/_0.15)] text-[oklch(0.70_0.15_230)] border-[oklch(0.70_0.15_230_/_0.3)]",
    dot: "bg-[oklch(0.70_0.15_230)]",
    label: "Proposed"
  },
  pending: {
    badge: "bg-[oklch(0.75_0.18_55_/_0.15)] text-[oklch(0.65_0.18_55)] border-[oklch(0.75_0.18_55_/_0.3)]",
    dot: "bg-[oklch(0.75_0.18_55)]",
    label: "Pending"
  },
  booked: {
    badge: "bg-[oklch(0.70_0.17_155_/_0.15)] text-[oklch(0.55_0.17_155)] border-[oklch(0.70_0.17_155_/_0.3)]",
    dot: "bg-[oklch(0.70_0.17_155)]",
    label: "Booked"
  },
  arrived: {
    badge: "bg-[oklch(0.75_0.18_55_/_0.15)] text-[oklch(0.65_0.18_55)] border-[oklch(0.75_0.18_55_/_0.3)]",
    dot: "bg-[oklch(0.75_0.18_55)]",
    label: "Arrived"
  },
  fulfilled: {
    badge: "bg-[oklch(0.70_0.17_155_/_0.15)] text-[oklch(0.55_0.17_155)] border-[oklch(0.70_0.17_155_/_0.3)]",
    dot: "bg-[oklch(0.70_0.17_155)]",
    label: "Fulfilled"
  },
  cancelled: {
    badge: "bg-[oklch(0.65_0.22_15_/_0.15)] text-[oklch(0.55_0.22_15)] border-[oklch(0.65_0.22_15_/_0.3)]",
    dot: "bg-[oklch(0.65_0.22_15)]",
    label: "Cancelled"
  },
  noshow: {
    badge: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
    label: "No Show"
  },
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

  // Chronicle-styled loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Hero skeleton */}
        <div className="bg-card border-b border-border px-6 py-8 rounded-xl">
          <Skeleton className="h-10 w-[350px] mb-4" />
          <div className="flex gap-4">
            <Skeleton className="h-5 w-[150px]" />
            <Skeleton className="h-5 w-[120px]" />
          </div>
        </div>
        {/* Content skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-[200px] w-full rounded-xl" />
          </div>
          <Skeleton className="h-[300px] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // Chronicle-styled not found state
  if (!appointment) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="font-display text-2xl text-foreground mb-2">
          Appointment Not Found
        </h2>
        <p className="text-muted-foreground font-mono text-sm mb-6">
          The appointment you're looking for doesn't exist or has been deleted.
        </p>
        <Button onClick={handleBack} variant="outline" className="font-mono text-xs">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Appointments
        </Button>
      </div>
    );
  }

  const patient = getPatientDetails();
  const practitioner = getPractitionerDetails();
  const status = statusConfig[appointment.status] || statusConfig.pending;

  return (
    <div className="space-y-6 animate-chronicle-enter">
      {/* Back navigation */}
      <Button
        variant="ghost"
        onClick={handleBack}
        className="font-mono text-xs text-muted-foreground hover:text-foreground -ml-2"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Appointments
      </Button>

      {/* Chronicle Hero Header */}
      <header className="relative bg-card border border-border rounded-xl overflow-hidden">
        {/* Background gradient - amber accent */}
        <div className="absolute inset-0 bg-gradient-to-r from-[oklch(0.75_0.18_55_/_0.08)] via-transparent to-transparent" />

        <div className="relative px-6 py-8">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            {/* Left: Appointment Identity */}
            <div className="space-y-4 flex-1">
              {/* Status + Type */}
              <div className="flex flex-wrap items-center gap-3">
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono uppercase tracking-wider border",
                  status.badge
                )}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
                  {status.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  {getAppointmentType()}
                </span>
              </div>

              {/* Patient Name - Display typography */}
              <h1 className="font-display text-3xl sm:text-4xl text-foreground tracking-tight">
                {patient.name}
              </h1>

              {/* Appointment metadata line */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
                <span className="flex items-center gap-1.5 font-mono text-sm">
                  <Calendar className="h-3.5 w-3.5" />
                  {format(parseISO(appointment.start), 'EEEE, MMMM d, yyyy')}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-sm">
                  <Clock className="h-3.5 w-3.5" />
                  {format(parseISO(appointment.start), 'h:mm a')} - {format(parseISO(appointment.end), 'h:mm a')}
                </span>
                <span className="font-mono text-sm">
                  <span className="text-foreground">{getAppointmentDuration()}</span>
                </span>
              </div>

              {/* Practitioner */}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Stethoscope className="h-4 w-4" />
                <span className="font-mono text-sm">
                  with <span className="text-foreground">{practitioner.name}</span>
                </span>
              </div>
            </div>

            {/* Right: Quick Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="font-mono text-xs"
                    disabled={updateStatusMutation.isPending}
                  >
                    Change Status
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="font-display text-xl">Update Appointment Status</DialogTitle>
                    <DialogDescription className="font-mono text-xs">
                      Select a new status for this appointment.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-3 py-4">
                    {Object.entries(statusConfig).map(([key, config]) => (
                      <Button
                        key={key}
                        variant="outline"
                        className={cn(
                          "justify-start font-mono text-xs",
                          appointment.status === key && "ring-2 ring-primary"
                        )}
                        onClick={() => handleStatusUpdate(key)}
                        disabled={appointment.status === key || updateStatusMutation.isPending}
                      >
                        <span className={cn("w-2 h-2 rounded-full mr-2", config.dot)} />
                        {config.label}
                      </Button>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>

              <Button
                variant="outline"
                size="sm"
                className="font-mono text-xs"
                onClick={handleEdit}
              >
                <Edit className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="font-mono text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="font-display text-xl">Delete Appointment</AlertDialogTitle>
                    <AlertDialogDescription className="font-mono text-sm">
                      This action cannot be undone. This will permanently delete the appointment
                      for {patient.name} on {format(parseISO(appointment.start), 'MMMM d, yyyy')}.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="font-mono text-xs bg-destructive hover:bg-destructive/90"
                    >
                      {deleteMutation.isPending ? 'Deleting...' : 'Delete Appointment'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Appointment Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Schedule Card */}
          <article className="bg-card border border-border rounded-xl p-6 animate-chronicle-enter stagger-1">
            <h2 className="font-heading text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-[oklch(0.75_0.18_55)]" />
              Schedule Details
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Start Time */}
              <div className="space-y-2">
                <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Start Time
                </label>
                <div className="font-mono text-sm text-foreground">
                  {formatDateTime(appointment.start)}
                </div>
              </div>

              {/* End Time */}
              <div className="space-y-2">
                <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  End Time
                </label>
                <div className="font-mono text-sm text-foreground">
                  {formatDateTime(appointment.end)}
                </div>
              </div>

              {/* Duration */}
              <div className="space-y-2">
                <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Duration
                </label>
                <div className="font-mono text-sm text-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  {getAppointmentDuration()}
                </div>
              </div>

              {/* Type */}
              <div className="space-y-2">
                <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Appointment Type
                </label>
                <div className="font-mono text-sm text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  {getAppointmentType()}
                </div>
              </div>
            </div>

            {/* Description & Comments */}
            {(appointment.description || appointment.comment) && (
              <>
                <div className="my-6 h-px bg-gradient-to-r from-border via-border to-transparent" />

                {appointment.description && (
                  <div className="space-y-2 mb-4">
                    <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Description
                    </label>
                    <p className="text-sm text-foreground leading-relaxed">
                      {appointment.description}
                    </p>
                  </div>
                )}

                {appointment.comment && (
                  <div className="space-y-2">
                    <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <MessageSquare className="h-3 w-3" />
                      Comments
                    </label>
                    <p className="text-sm text-muted-foreground italic leading-relaxed">
                      "{appointment.comment}"
                    </p>
                  </div>
                )}
              </>
            )}
          </article>
        </div>

        {/* Right Column - Participants */}
        <aside className="space-y-6">
          {/* Patient Card */}
          <article className="bg-card border border-border rounded-xl p-6 animate-chronicle-enter stagger-2">
            <h3 className="font-heading text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <User className="h-4 w-4 text-[oklch(0.70_0.15_230)]" />
              Patient
            </h3>

            <div className="space-y-3">
              <div
                className="group cursor-pointer"
                onClick={() => navigate(`/patients/${patient.id}`)}
              >
                <div className="font-display text-xl text-foreground group-hover:text-primary transition-colors">
                  {patient.name}
                </div>
                <span className="font-mono text-xs text-muted-foreground group-hover:text-primary/80 transition-colors">
                  View Chronicle →
                </span>
              </div>
            </div>
          </article>

          {/* Practitioner Card */}
          <article className="bg-card border border-border rounded-xl p-6 animate-chronicle-enter stagger-3">
            <h3 className="font-heading text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-[oklch(0.70_0.17_155)]" />
              Practitioner
            </h3>

            <div className="space-y-3">
              <div
                className="group cursor-pointer"
                onClick={() => navigate(`/practitioners/${practitioner.id}`)}
              >
                <div className="font-display text-xl text-foreground group-hover:text-primary transition-colors">
                  {practitioner.name}
                </div>
                <span className="font-mono text-xs text-muted-foreground group-hover:text-primary/80 transition-colors">
                  View Profile →
                </span>
              </div>
            </div>
          </article>

          {/* Status Timeline Mini */}
          <article className="bg-card border border-border rounded-xl p-6 animate-chronicle-enter stagger-4">
            <h3 className="font-heading text-sm font-semibold text-foreground mb-4">
              Status
            </h3>

            <div className="space-y-3">
              {['proposed', 'pending', 'booked', 'arrived', 'fulfilled'].map((statusKey, index) => {
                const config = statusConfig[statusKey];
                const isActive = appointment.status === statusKey;
                const isPast = ['proposed', 'pending', 'booked', 'arrived', 'fulfilled'].indexOf(appointment.status) > index;

                return (
                  <div key={statusKey} className="flex items-center gap-3">
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full transition-all",
                      isActive ? config.dot : isPast ? "bg-muted-foreground/50" : "bg-muted"
                    )} />
                    <span className={cn(
                      "font-mono text-xs",
                      isActive ? "text-foreground font-medium" : "text-muted-foreground"
                    )}>
                      {config.label}
                    </span>
                    {isActive && (
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                        Current
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        </aside>
      </div>
    </div>
  );
};

export default AppointmentDetail;
