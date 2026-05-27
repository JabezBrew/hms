import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days.js';

import DoctorAvailabilityCalendar from '@/features/appointments/components/DoctorAvailabilityCalendar';
import { SearchBar } from '@/components/ui/search-bar';

export function AvailabilityCalendarPanel({
  isDoctor,
  practitionerOptions,
  practitionersLoading,
  selectedPractitioner,
  onPractitionerChange,
  onSearchChange,
  onSlotSelect,
}) {
  return (
    <div className="bg-card rounded-xl border border-border/50 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading text-base font-semibold text-foreground">
          {isDoctor ? 'My Availability' : 'Availability Calendar'}
        </h2>
        {!isDoctor && (
          <div className="w-72">
            <SearchBar
              options={practitionerOptions}
              value={selectedPractitioner}
              onChange={onPractitionerChange}
              onInputChange={onSearchChange}
              placeholder="Select practitioner..."
              emptyMessage={practitionersLoading ? 'Searching...' : 'No practitioners found'}
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
          onSlotSelect={onSlotSelect}
        />
      )}
    </div>
  );
}
