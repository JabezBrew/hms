import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import DoctorAvailabilityCalendar from '@/features/appointments/components/DoctorAvailabilityCalendar';

function AppointmentCreateSummaryCard({ label, value }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground truncate mt-1">{value || 'Not selected'}</p>
    </div>
  );
}

function AppointmentCreateEmptyState({
  description,
  icon: Icon,
  title,
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="p-6 rounded-full bg-muted/50 mb-6">
        <Icon className="size-12 text-muted-foreground/50" />
      </div>
      <h3 className="text-xl font-medium text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground max-w-md">
        {description}
      </p>
    </div>
  );
}

export function AppointmentCreateTimePanel({
  form,
  handleSlotSelect,
  isPoolClinic,
  requiresPractitioner,
  selectedClinicName,
  selectedPatientName,
  selectedPractitionerName,
  selectedTypeName,
  watchAppointmentTypeId,
  watchClinicId,
  watchPractitionerId,
}) {
  return (
    <div className="p-6 overflow-y-auto bg-background">
      <div className="flex items-center gap-2 mb-6">
        <Clock className="size-5 text-rose-500" />
        <h2 className="font-display text-lg text-foreground">Select Date & Time</h2>
      </div>

      <div className="grid gap-4 mb-6 sm:grid-cols-2 xl:grid-cols-4">
        <AppointmentCreateSummaryCard label="Patient" value={selectedPatientName} />
        <AppointmentCreateSummaryCard label="Clinic" value={selectedClinicName} />
        <AppointmentCreateSummaryCard
          label="Doctor"
          value={isPoolClinic ? 'Assigned at check-in' : selectedPractitionerName}
        />
        <AppointmentCreateSummaryCard label="Type" value={selectedTypeName} />
      </div>

      {!watchClinicId ? (
        <AppointmentCreateEmptyState
          icon={Building2}
          title="Select a Clinic First"
          description="Choose a clinic from the sidebar to load availability."
        />
      ) : requiresPractitioner && !watchPractitionerId ? (
        <AppointmentCreateEmptyState
          icon={Stethoscope}
          title="Select a Doctor"
          description="This clinic books directly to a doctor, so select a doctor to view available slots."
        />
      ) : (
        <FormField
          control={form.control}
          name="slotId"
          render={() => (
            <FormItem>
              <FormControl>
                <DoctorAvailabilityCalendar
                  clinicId={watchClinicId}
                  practitionerId={requiresPractitioner ? watchPractitionerId : undefined}
                  serviceId={watchAppointmentTypeId}
                  onSlotSelect={handleSlotSelect}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
