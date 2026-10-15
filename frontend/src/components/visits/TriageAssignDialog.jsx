import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import format from 'date-fns/format';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { staffApi } from '@/lib/api/staff';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { createScopedQueryKey, getAuthQueryScope, keyWith } from '@/shared/lib/queryKeys';
import { triageAssignmentApi } from '@/features/triage/api';

const triageAssignKeys = {
  clinics: () => keyWith('clinics', 'walk-in'),
  appointmentTypes: () => keyWith('appointment-types'),
  practitioners: (clinicId) => keyWith('clinic-practitioners', clinicId),
};

const ANY_PRACTITIONER_VALUE = '__any_available';

function buildAssignSchema({ practitionerRequired }) {
  return z.object({
    clinic_id: z.string().min(1, 'Clinic is required'),
    appointment_type_id: z.string().min(1, 'Appointment type is required'),
    start_time: z.string().min(1, 'Start time is required'),
    practitioner_id: practitionerRequired
      ? z.string().min(1, 'Practitioner is required in Rust V2 mode')
      : z.string().optional(),
  });
}

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
  if (!entry) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      {isRustV2ApiMode() ? <TriageStaffAssignForm
        key={`${entry.id}:${open ? 'open' : 'closed'}`}
        open={open}
        onClose={onClose}
        entry={entry}
        onSuccess={onSuccess}
      /> : <TriageAssignForm
        key={`${entry.id}:${open ? 'open' : 'closed'}`}
        open={open}
        onClose={onClose}
        entry={entry}
        onSuccess={onSuccess}
      />}
    </Dialog>
  );
}

function TriageStaffAssignForm({ open, onClose, entry, onSuccess }) {
  const auth = useAuth();
  const { assignToClinic } = useTriageActions();
  const [selectedUserId, setSelectedUserId] = React.useState(entry.assigned_to_user_id || '');
  const staffQuery = useInfiniteQuery({
    queryKey: createScopedQueryKey(keyWith('triage', 'assignment-staff'), getAuthQueryScope(auth)),
    queryFn: ({ pageParam, signal }) => triageAssignmentApi.listStaff({ cursor: pageParam, signal }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.next_cursor || undefined,
    enabled: open && Boolean(auth.facilityCode),
  });
  const staff = [...new Map((staffQuery.data?.pages || [])
    .flatMap((page) => page.results)
    .map((member) => [member.user_id, member])).values()];

  function submit(event) {
    event.preventDefault();
    if (!selectedUserId || assignToClinic.isPending) return;
    assignToClinic.mutate({ id: entry.id, assigned_to_user_id: selectedUserId }, { onSuccess });
  }

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-display text-xl">Assign Triage Staff</DialogTitle>
        <DialogDescription>Select the staff member responsible for this assessment.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="font-heading font-semibold">{entry.patient_name}</p>
          {entry.assigned_to_name && <p className="mt-1 text-sm text-muted-foreground">Currently assigned to {entry.assigned_to_name}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="triage_staff">Staff member *</Label>
          <Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={assignToClinic.isPending}>
            <SelectTrigger id="triage_staff"><SelectValue placeholder="Select staff member..." /></SelectTrigger>
            <SelectContent>
              {entry.assigned_to_user_id && !staff.some((member) => member.user_id === entry.assigned_to_user_id) && (
                <SelectItem value={entry.assigned_to_user_id}>{entry.assigned_to_name || 'Current assignee'}</SelectItem>
              )}
              {staff.map((member) => (
                <SelectItem key={member.user_id} value={member.user_id}>
                  {member.display_name}{member.position ? ` · ${member.position}` : ''}
                </SelectItem>
              ))}
              {!staff.length && <SelectItem value="__no_staff" disabled>{staffQuery.isPending ? 'Loading staff…' : 'No staff available'}</SelectItem>}
            </SelectContent>
          </Select>
          {staffQuery.isError && (
            <div role="alert" className="space-y-2 text-sm">
              <p className="text-destructive">Staff could not be loaded.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => staffQuery.refetch()}>Retry staff list</Button>
            </div>
          )}
          {staffQuery.hasNextPage && (
            <Button type="button" variant="outline" size="sm" disabled={staffQuery.isFetchingNextPage} onClick={() => staffQuery.fetchNextPage()}>
              {staffQuery.isFetchingNextPage ? 'Loading staff…' : 'Load more staff'}
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={assignToClinic.isPending}>Cancel</Button>
          <Button type="submit" disabled={assignToClinic.isPending || !selectedUserId}>
            {assignToClinic.isPending ? 'Assigning...' : 'Assign Staff'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function TriageAssignForm({ open, onClose, entry, onSuccess }) {
  const { facilityCode } = useAuth();
  const { assignToClinic } = useTriageActions();
  const isRustV2 = isRustV2ApiMode();
  const assignSchema = React.useMemo(
    () => buildAssignSchema({ practitionerRequired: isRustV2 }),
    [isRustV2],
  );
  const initialFormValues = React.useMemo(() => ({
    clinic_id: '',
    appointment_type_id: '',
    start_time: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    practitioner_id: '',
  }), []);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(assignSchema),
    defaultValues: initialFormValues,
    values: initialFormValues,
  });

  const clinicId = watch('clinic_id');

  // Fetch clinics that accept walk-ins
  const { data: clinics, isLoading: clinicsLoading } = useQuery({
    queryKey: triageAssignKeys.clinics(),
    queryFn: ({ signal }) => clinicsApi.list({ accepts_walk_ins: true }, { signal }),
    enabled: open && Boolean(facilityCode),
  });

  // Fetch appointment types
  const { data: appointmentTypes, isLoading: typesLoading } = useQuery({
    queryKey: triageAssignKeys.appointmentTypes(),
    queryFn: ({ signal }) => appointmentsApi.getAppointmentTypes({ signal }),
    enabled: open && Boolean(facilityCode),
  });

  // Fetch practitioners for selected clinic
  const { data: practitioners, isLoading: practitionersLoading } = useQuery({
    queryKey: triageAssignKeys.practitioners(clinicId),
    queryFn: ({ signal }) => staffApi.getPractitioners({ clinic: clinicId, page_size: 100 }, { signal }),
    enabled: open && Boolean(clinicId),
  });

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
          reset(initialFormValues);
          onSuccess?.();
        },
      }
    );
  };

  const handleClose = () => {
    reset(initialFormValues);
    onClose();
  };

  const clinicsList = clinics?.results || clinics || [];
  const typesList = appointmentTypes?.results || appointmentTypes || [];
  const practitionersList = practitioners?.results || practitioners || [];

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-display text-xl">
          Assign to Clinic
        </DialogTitle>
        <DialogDescription>
          Choose the clinic, appointment type, time, and practitioner for this triage entry.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Patient Info */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`size-2 rounded-full ${
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
              <Building2 className="size-4" />
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
                  <SelectItem value="__loading_clinics" disabled>
                    Loading…
                  </SelectItem>
                ) : clinicsList.length === 0 ? (
                  <SelectItem value="__no_clinics" disabled>
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
              <p className="text-sm text-rose-700 dark:text-rose-300">{errors.clinic_id.message}</p>
            )}
          </div>

          {/* Appointment Type */}
          <div className="space-y-2">
            <Label htmlFor="appointment_type_id" className="flex items-center gap-2">
              <Calendar className="size-4" />
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
                  <SelectItem value="__loading_appointment_types" disabled>
                    Loading…
                  </SelectItem>
                ) : typesList.length === 0 ? (
                  <SelectItem value="__no_appointment_types" disabled>
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
              <p className="text-sm text-rose-700 dark:text-rose-300">{errors.appointment_type_id.message}</p>
            )}
          </div>

          {/* Start Time */}
          <div className="space-y-2">
            <Label htmlFor="start_time" className="flex items-center gap-2">
              <Clock className="size-4" />
              Start Time
            </Label>
            <Input
              id="start_time"
              type="datetime-local"
              {...register('start_time')}
            />
            {errors.start_time && (
              <p className="text-sm text-rose-700 dark:text-rose-300">{errors.start_time.message}</p>
            )}
          </div>

          {/* Practitioner */}
          <div className="space-y-2">
            <Label htmlFor="practitioner_id" className="flex items-center gap-2">
              <User className="size-4" />
              {isRustV2 ? 'Practitioner *' : 'Practitioner (Optional)'}
            </Label>
            <Select
              value={watch('practitioner_id')}
              onValueChange={(value) => setValue(
                'practitioner_id',
                value === ANY_PRACTITIONER_VALUE ? '' : value,
                { shouldValidate: true },
              )}
              disabled={!clinicId}
            >
              <SelectTrigger>
                <SelectValue placeholder={isRustV2 ? 'Select practitioner...' : 'Any available...'} />
              </SelectTrigger>
              <SelectContent>
                {!isRustV2 && (
                  <SelectItem value={ANY_PRACTITIONER_VALUE}>Any available</SelectItem>
                )}
                {practitionersLoading ? (
                  <SelectItem value="__loading_practitioners" disabled>
                    Loading…
                  </SelectItem>
                ) : practitionersList.length === 0 ? (
                  <SelectItem value="__no_practitioners" disabled>
                    No practitioners available
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
            {isRustV2 && (
              <p className="text-sm text-muted-foreground">
                Select a practitioner before assigning this triage entry to a clinic.
              </p>
            )}
            {errors.practitioner_id && (
              <p className="text-sm text-rose-700 dark:text-rose-300">{errors.practitioner_id.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={assignToClinic.isPending || (isRustV2 && !watch('practitioner_id'))}
            >
              {assignToClinic.isPending ? 'Assigning...' : 'Assign to Clinic'}
            </Button>
          </DialogFooter>
      </form>
    </DialogContent>
  );
}
