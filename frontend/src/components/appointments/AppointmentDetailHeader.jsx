import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import format from 'date-fns/format';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  appointmentStatusConfig,
  getAppointmentDuration,
  getAppointmentType,
} from './appointmentDetailUtils';

function LegacyStatusDialog({ appointment, onStatusUpdate, updateStatusMutation }) {
  return (
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
          {Object.entries(appointmentStatusConfig).map(([key, config]) => (
            <Button
              key={key}
              variant="outline"
              className={cn(
                "justify-start font-mono text-xs",
                appointment.status === key && "ring-2 ring-primary"
              )}
              onClick={() => onStatusUpdate(key)}
              disabled={appointment.status === key || updateStatusMutation.isPending}
            >
              <span className={cn("size-2 rounded-full mr-2", config.dot)} />
              {config.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RustV2CancelDialog({
  cancellationReason,
  cancelAppointmentMutation,
  onCancelAppointment,
  setCancellationReason,
  updateStatusMutation,
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          disabled={updateStatusMutation.isPending || cancelAppointmentMutation.isPending}
        >
          <XCircle className="size-3.5 mr-1.5" />
          Cancel Appointment
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl">Cancel Appointment</AlertDialogTitle>
          <AlertDialogDescription className="font-mono text-sm">
            This will cancel the appointment without deleting its schedule record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="appointment-cancellation-reason" className="font-mono text-xs">
            Cancellation reason
          </Label>
          <Textarea
            id="appointment-cancellation-reason"
            value={cancellationReason}
            onChange={(event) => setCancellationReason(event.target.value)}
            placeholder="Document why this appointment is being cancelled."
            className="min-h-24 font-mono text-sm"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="font-mono text-xs">Keep Appointment</AlertDialogCancel>
          <AlertDialogAction
            onClick={onCancelAppointment}
            className="font-mono text-xs bg-destructive hover:bg-destructive/90"
            disabled={cancelAppointmentMutation.isPending || !cancellationReason.trim()}
          >
            Confirm Cancellation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LegacyDeleteDialog({ deleteMutation, onDelete, patient, startDate }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="size-3.5 mr-1.5" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl">Delete Appointment</AlertDialogTitle>
          <AlertDialogDescription className="font-mono text-sm">
            This action cannot be undone. This will permanently delete the appointment
            for {patient.name} on {startDate ? format(startDate, 'MMMM d, yyyy') : 'N/A'}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            className="font-mono text-xs bg-destructive hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Appointment'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AppointmentDetailActions({
  actionState,
  appointment,
  cancellationReason,
  cancelAppointmentMutation,
  deleteMutation,
  onCancelAppointment,
  onDelete,
  onEdit,
  onStatusUpdate,
  patient,
  setCancellationReason,
  startDate,
  updateStatusMutation,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!actionState.rustV2Mode ? (
        <LegacyStatusDialog
          appointment={appointment}
          onStatusUpdate={onStatusUpdate}
          updateStatusMutation={updateStatusMutation}
        />
      ) : null}

      {actionState.canCheckInInRustV2 ? (
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs"
          onClick={() => onStatusUpdate('arrived')}
          disabled={updateStatusMutation.isPending}
        >
          <CheckCircle className="size-3.5 mr-1.5" />
          Check In
        </Button>
      ) : null}

      {actionState.canCancelInRustV2 ? (
        <RustV2CancelDialog
          cancellationReason={cancellationReason}
          cancelAppointmentMutation={cancelAppointmentMutation}
          onCancelAppointment={onCancelAppointment}
          setCancellationReason={setCancellationReason}
          updateStatusMutation={updateStatusMutation}
        />
      ) : null}

      {actionState.canEditInRustV2 ? (
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs"
          onClick={onEdit}
        >
          <Edit className="size-3.5 mr-1.5" />
          Edit
        </Button>
      ) : null}

      {!actionState.rustV2Mode ? (
        <LegacyDeleteDialog
          deleteMutation={deleteMutation}
          onDelete={onDelete}
          patient={patient}
          startDate={startDate}
        />
      ) : null}
    </div>
  );
}

export function AppointmentDetailHeader({
  actionState,
  appointment,
  cancellationReason,
  cancelAppointmentMutation,
  deleteMutation,
  onBack,
  onCancelAppointment,
  onDelete,
  onEdit,
  onStatusUpdate,
  patient,
  practitioner,
  setCancellationReason,
  timeRange,
  updateStatusMutation,
}) {
  const { endDate, startDate } = timeRange;
  const status = appointmentStatusConfig[appointment.status] || appointmentStatusConfig.pending;

  return (
    <>
      <Button
        variant="ghost"
        onClick={onBack}
        className="font-mono text-xs text-muted-foreground hover:text-foreground -ml-2"
      >
        <ArrowLeft className="mr-2 size-4" />
        Back to Appointments
      </Button>

      <header className="relative bg-card border border-border rounded-xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[oklch(0.75_0.18_55_/_0.08)] via-transparent to-transparent" />

        <div className="relative px-6 py-8">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div className="space-y-4 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono uppercase tracking-wider border",
                  status.badge
                )}>
                  <span className={cn("size-1.5 rounded-full", status.dot)} />
                  {status.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  {getAppointmentType(appointment)}
                </span>
              </div>

              <h1 className="font-display text-3xl sm:text-4xl text-foreground tracking-tight">
                {patient.name}
              </h1>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
                <span className="flex items-center gap-1.5 font-mono text-sm">
                  <Calendar className="size-3.5" />
                  {startDate ? format(startDate, 'EEEE, MMMM d, yyyy') : 'N/A'}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-sm">
                  <Clock className="size-3.5" />
                  {startDate ? format(startDate, 'h:mm a') : 'N/A'} - {endDate ? format(endDate, 'h:mm a') : 'N/A'}
                </span>
                <span className="font-mono text-sm">
                  <span className="text-foreground">{getAppointmentDuration(startDate, endDate)}</span>
                </span>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <Stethoscope className="size-4" />
                <span className="font-mono text-sm">
                  with <span className="text-foreground">{practitioner.name}</span>
                </span>
              </div>
            </div>

            <AppointmentDetailActions
              actionState={actionState}
              appointment={appointment}
              cancellationReason={cancellationReason}
              cancelAppointmentMutation={cancelAppointmentMutation}
              deleteMutation={deleteMutation}
              onCancelAppointment={onCancelAppointment}
              onDelete={onDelete}
              onEdit={onEdit}
              onStatusUpdate={onStatusUpdate}
              patient={patient}
              setCancellationReason={setCancellationReason}
              startDate={startDate}
              updateStatusMutation={updateStatusMutation}
            />
          </div>
        </div>
      </header>
    </>
  );
}
