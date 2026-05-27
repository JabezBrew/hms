import User from 'lucide-react/dist/esm/icons/user.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { SearchBar } from '@/components/ui/search-bar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

function AppointmentCreatePatientField({
  form,
  isLoadingPatients,
  patientOptions,
  setPatientSearchQuery,
  submitting,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <User className="size-4 text-primary" />
        Patient
      </div>
      <FormField
        control={form.control}
        name="patientId"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <SearchBar
                options={patientOptions}
                value={field.value}
                onChange={field.onChange}
                onInputChange={setPatientSearchQuery}
                placeholder="Search patients..."
                emptyMessage={isLoadingPatients ? 'Searching...' : 'No patients found.'}
                disabled={submitting}
                maxHeight="15rem"
                isLoading={isLoadingPatients}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function AppointmentCreateClinicField({
  clinics,
  form,
  handleClinicChange,
  selectedClinic,
  submitting,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <Building2 className="size-4 text-sky-500" />
        Clinic
      </div>
      <FormField
        control={form.control}
        name="clinicId"
        render={({ field }) => (
          <FormItem>
            <Select
              onValueChange={(value) => handleClinicChange(value, field.onChange)}
              value={field.value}
              disabled={submitting}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select clinic..." />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {clinics.length > 0 ? clinics.map((clinic) => (
                  <SelectItem key={clinic.id} value={clinic.id}>
                    <div className="flex items-center gap-2">
                      <span>{clinic.name}</span>
                      <span className="text-xs text-muted-foreground capitalize">
                        ({clinic.booking_mode === 'clinic_pool' ? 'Pool' : 'Direct'})
                      </span>
                    </div>
                  </SelectItem>
                )) : (
                  <SelectItem value="none" disabled>
                    No clinics available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      {selectedClinic ? (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Badge variant="outline" className="capitalize">
            {selectedClinic.booking_mode === 'clinic_pool' ? 'Clinic Pool' : 'Practitioner Direct'}
          </Badge>
          {selectedClinic.waitlist_enabled ? (
            <Badge variant="outline" className="text-amber-700 border-amber-400/60 bg-amber-100/40">
              Auto waitlist enabled
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AppointmentCreatePractitionerField({
  form,
  handlePractitionerChange,
  isLoadingPractitioners,
  isPoolClinic,
  practitionerOptions,
  setPractitionerSearchQuery,
  submitting,
  watchClinicId,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <Stethoscope className="size-4 text-emerald-500" />
        Doctor
      </div>

      {isPoolClinic ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Clinic pool booking: doctor assignment happens at check-in.
        </div>
      ) : (
        <FormField
          control={form.control}
          name="practitionerId"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <SearchBar
                  options={practitionerOptions}
                  value={field.value}
                  onChange={(value) => handlePractitionerChange(value, field.onChange)}
                  onInputChange={setPractitionerSearchQuery}
                  placeholder={watchClinicId ? 'Search doctors...' : 'Select clinic first...'}
                  emptyMessage={isLoadingPractitioners ? 'Searching...' : 'No doctors found.'}
                  disabled={submitting || !watchClinicId}
                  maxHeight="15rem"
                  isLoading={isLoadingPractitioners}
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

function AppointmentCreateTypeField({
  appointmentTypes,
  clearSelectedTime,
  form,
  submitting,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <FileText className="size-4 text-amber-500" />
        Appointment Type
      </div>
      <FormField
        control={form.control}
        name="appointmentTypeId"
        render={({ field }) => (
          <FormItem>
            <Select
              onValueChange={(value) => {
                field.onChange(value);
                clearSelectedTime();
              }}
              value={field.value}
              disabled={submitting}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {Array.isArray(appointmentTypes) ? appointmentTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    <div className="flex items-center gap-2">
                      <span>{type.name}</span>
                      <span className="text-xs text-muted-foreground">({type.duration_minutes}min)</span>
                    </div>
                  </SelectItem>
                )) : (
                  <SelectItem value="none" disabled>
                    No types available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function AppointmentCreateNotesFields({
  form,
  selectedSlotRequiresOverbook,
  submitting,
}) {
  return (
    <div className="space-y-4">
      {selectedSlotRequiresOverbook ? (
        <FormField
          control={form.control}
          name="overbookReason"
          render={({ field }) => (
            <FormItem>
              <label
                htmlFor="overbook-reason"
                className="font-mono text-xs uppercase tracking-wider text-amber-700"
              >
                Overbooking Approval Reason
              </label>
              <FormControl>
                <Textarea
                  id="overbook-reason"
                  placeholder="Clinician or supervisor approval"
                  className="h-16 resize-none border-amber-400/60 bg-amber-50/40 text-sm"
                  {...field}
                  disabled={submitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <label
              htmlFor="appointment-description"
              className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
            >
              Reason for Visit
            </label>
            <FormControl>
              <Textarea
                id="appointment-description"
                placeholder="Brief description..."
                className="resize-none h-16 text-sm"
                {...field}
                disabled={submitting}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="comment"
        render={({ field }) => (
          <FormItem>
            <label
              htmlFor="appointment-comment"
              className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
            >
              Additional Notes
            </label>
            <FormControl>
              <Textarea
                id="appointment-comment"
                placeholder="Special instructions..."
                className="resize-none h-16 text-sm"
                {...field}
                disabled={submitting}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function AppointmentCreateActions({
  formReady,
  isWaitlistPromotion,
  onCancel,
  submitting,
}) {
  return (
    <div className="pt-4 border-t border-border/50 space-y-3">
      <Button
        type="submit"
        className="w-full font-mono text-xs bg-primary hover:bg-primary/90"
        disabled={submitting || !formReady}
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Scheduling
          </>
        ) : (
          <>
            <CheckCircle className="mr-2 size-4" />
            {isWaitlistPromotion ? 'Promote to Appointment' : 'Schedule Appointment'}
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full font-mono text-xs"
        onClick={onCancel}
        disabled={submitting}
      >
        Cancel
      </Button>
    </div>
  );
}

export function AppointmentCreateSidebar({
  appointmentTypes,
  clearSelectedTime,
  clinicState,
  clinics,
  form,
  formReady,
  handleClinicChange,
  handlePractitionerChange,
  onCancel,
  patientOptions,
  practitionerOptions,
  selectedSlotRequiresOverbook,
  setPatientSearchQuery,
  setPractitionerSearchQuery,
  searchState,
  submissionState,
}) {
  const { isPoolClinic, selectedClinic, watchClinicId } = clinicState;
  const { isLoadingPatients, isLoadingPractitioners } = searchState;
  const { isWaitlistPromotion, submitting } = submissionState;

  return (
    <div className="border-r border-border bg-card/30 p-6 space-y-6 overflow-y-auto">
      <AppointmentCreatePatientField
        form={form}
        isLoadingPatients={isLoadingPatients}
        patientOptions={patientOptions}
        setPatientSearchQuery={setPatientSearchQuery}
        submitting={submitting}
      />

      <AppointmentCreateClinicField
        clinics={clinics}
        form={form}
        handleClinicChange={handleClinicChange}
        selectedClinic={selectedClinic}
        submitting={submitting}
      />

      <AppointmentCreatePractitionerField
        form={form}
        handlePractitionerChange={handlePractitionerChange}
        isLoadingPractitioners={isLoadingPractitioners}
        isPoolClinic={isPoolClinic}
        practitionerOptions={practitionerOptions}
        setPractitionerSearchQuery={setPractitionerSearchQuery}
        submitting={submitting}
        watchClinicId={watchClinicId}
      />

      <AppointmentCreateTypeField
        appointmentTypes={appointmentTypes}
        clearSelectedTime={clearSelectedTime}
        form={form}
        submitting={submitting}
      />

      <div className="border-t border-border/50" />

      <AppointmentCreateNotesFields
        form={form}
        selectedSlotRequiresOverbook={selectedSlotRequiresOverbook}
        submitting={submitting}
      />

      <AppointmentCreateActions
        formReady={formReady}
        isWaitlistPromotion={isWaitlistPromotion}
        onCancel={onCancel}
        submitting={submitting}
      />
    </div>
  );
}
