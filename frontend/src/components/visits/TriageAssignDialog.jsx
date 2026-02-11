import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import format from 'date-fns/format';
import addMinutes from 'date-fns/addMinutes';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTriageActions } from '@/hooks/useVisitQueries';
import { clinicsApi } from '@/features/clinics/api';
import { appointmentsApi } from '@/features/appointments/api';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { keyWith } from '@/shared/lib/queryKeys';

const triageAssignKeys = {
  clinics: () => keyWith('clinics', 'walk-in'),
  appointmentTypes: () => keyWith('appointment-types'),
  practitioners: (clinicId) => keyWith('clinic-practitioners', clinicId),
};

const assignSchema = z.object({
  clinic_id: z.string().min(1, 'Clinic is required'),
  appointment_type_id: z.string().min(1, 'Appointment type is required'),
  start_time: z.string().min(1, 'Start time is required'),
  practitioner_id: z.string().optional(),
});

/**
 * TriageAssignDialog - Dialog for assigning triaged patient to a clinic
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether dialog is open
 * @param {Function} props.onClose - Close handler
 * @param {Object} props.entry - Triage queue entry
 * @param {Function} props.onSuccess - Success callback
 */
export function TriageAssignDialog({ open, onClose, entry, onSuccess }) {
  const { facilityCode } = useAuth();
  const { assignToClinic } = useTriageActions();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(assignSchema),
    defaultValues: {
      clinic_id: '',
      appointment_type_id: '',
      start_time: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      practitioner_id: '',
    },
  });

  const clinicId = watch('clinic_id');

  // Fetch clinics that accept walk-ins
  const { data: clinics, isLoading: clinicsLoading } = useQuery({
    queryKey: triageAssignKeys.clinics(),
    queryFn: () => clinicsApi.list({ accepts_walk_ins: true }),
    enabled: open && Boolean(facilityCode),
  });

  // Fetch appointment types
  const { data: appointmentTypes, isLoading: typesLoading } = useQuery({
    queryKey: triageAssignKeys.appointmentTypes(),
    queryFn: () => appointmentsApi.getAppointmentTypes(),
    enabled: open && Boolean(facilityCode),
  });

  // Fetch practitioners for selected clinic
  const { data: practitioners, isLoading: practitionersLoading } = useQuery({
    queryKey: triageAssignKeys.practitioners(clinicId),
    queryFn: () => apiClient.get(`/organization/clinics/${clinicId}/practitioners/`),
    enabled: open && Boolean(clinicId),
  });

  React.useEffect(() => {
    if (open) {
      reset({
        clinic_id: '',
        appointment_type_id: '',
        start_time: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        practitioner_id: '',
      });
    }
  }, [open, reset]);

  const onSubmit = async (data) => {
    if (!entry) return;

    assignToClinic.mutate(
      {
        id: entry.id,
        clinic_id: data.clinic_id,
        appointment_type_id: data.appointment_type_id,
        start_time: new Date(data.start_time).toISOString(),
        practitioner_id: data.practitioner_id || undefined,
      },
      {
        onSuccess: () => {
          reset();
          onSuccess?.();
        },
      }
    );
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!entry) return null;

  const clinicsList = clinics?.results || clinics || [];
  const typesList = appointmentTypes?.results || appointmentTypes || [];
  const practitionersList = practitioners?.results || practitioners || [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Assign to Clinic
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Patient Info */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  entry.priority === 'emergency'
                    ? 'bg-rose-500'
                    : entry.priority === 'urgent'
                    ? 'bg-amber-500'
                    : 'bg-sky-500'
                }`}
              />
              <h4 className="font-heading font-semibold">
                {entry.patient_name}
              </h4>
            </div>
            <p className="text-sm text-muted-foreground">
              Priority: {entry.priority.charAt(0).toUpperCase() + entry.priority.slice(1)}
            </p>
            {entry.triage_notes && (
              <p className="text-sm text-muted-foreground mt-1">
                Notes: {entry.triage_notes}
              </p>
            )}
          </div>

          {/* Clinic Selection */}
          <div className="space-y-2">
            <Label htmlFor="clinic_id" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Clinic
            </Label>
            <Select
              value={clinicId}
              onValueChange={(value) => {
                setValue('clinic_id', value);
                setValue('practitioner_id', ''); // Reset practitioner when clinic changes
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a clinic..." />
              </SelectTrigger>
              <SelectContent>
                {clinicsLoading ? (
                  <SelectItem value="" disabled>
                    Loading...
                  </SelectItem>
                ) : clinicsList.length === 0 ? (
                  <SelectItem value="" disabled>
                    No clinics available
                  </SelectItem>
                ) : (
                  clinicsList.map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {errors.clinic_id && (
              <p className="text-sm text-rose-400">{errors.clinic_id.message}</p>
            )}
          </div>

          {/* Appointment Type */}
          <div className="space-y-2">
            <Label htmlFor="appointment_type_id" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Appointment Type
            </Label>
            <Select
              value={watch('appointment_type_id')}
              onValueChange={(value) => setValue('appointment_type_id', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {typesLoading ? (
                  <SelectItem value="" disabled>
                    Loading...
                  </SelectItem>
                ) : typesList.length === 0 ? (
                  <SelectItem value="" disabled>
                    No types available
                  </SelectItem>
                ) : (
                  typesList.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name} ({type.duration_minutes} min)
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {errors.appointment_type_id && (
              <p className="text-sm text-rose-400">{errors.appointment_type_id.message}</p>
            )}
          </div>

          {/* Start Time */}
          <div className="space-y-2">
            <Label htmlFor="start_time" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Start Time
            </Label>
            <Input
              id="start_time"
              type="datetime-local"
              {...register('start_time')}
            />
            {errors.start_time && (
              <p className="text-sm text-rose-400">{errors.start_time.message}</p>
            )}
          </div>

          {/* Practitioner (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="practitioner_id" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Practitioner (Optional)
            </Label>
            <Select
              value={watch('practitioner_id')}
              onValueChange={(value) => setValue('practitioner_id', value)}
              disabled={!clinicId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any available..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any available</SelectItem>
                {practitionersLoading ? (
                  <SelectItem value="" disabled>
                    Loading...
                  </SelectItem>
                ) : (
                  practitionersList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name || p.user?.get_full_name || 'Unknown'}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={assignToClinic.isPending}>
              {assignToClinic.isPending ? 'Assigning...' : 'Assign to Clinic'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default TriageAssignDialog;
