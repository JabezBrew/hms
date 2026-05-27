import Award from 'lucide-react/dist/esm/icons/award.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import GraduationCap from 'lucide-react/dist/esm/icons/graduation-cap.js';

import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

import { InfoItem } from './InfoItem';

export function StaffProfessionalSection({ form, isEditing, view, practitioner, onManageSchedule }) {
  if (!view.isPractitioner) return null;

  return (
    <section>
      <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
        <GraduationCap className="size-5 text-muted-foreground" />
        Professional
      </h2>
      <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border space-y-6">
        {isEditing ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField control={form.control} name="license_number" render={({ field }) => (
              <FormItem>
                <FormLabel>License Number</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="specialization" render={({ field }) => (
              <FormItem>
                <FormLabel>Specialization</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="qualification" render={({ field }) => (
              <FormItem>
                <FormLabel>Qualification</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
            <InfoItem label="License Number" value={practitioner?.license_number} icon={FileText} />
            <InfoItem label="Specialization" value={practitioner?.specialization} icon={Award} />
            <InfoItem
              label="Qualification"
              value={practitioner?.qualification}
              icon={GraduationCap}
              className="col-span-2 sm:col-span-1"
            />
          </div>
        )}

        {!isEditing && view.userType === 'doctor' ? (
          <div className="pt-4 border-t border-border">
            <Button variant="outline" className="w-full sm:w-auto" onClick={onManageSchedule}>
              <Calendar className="size-4 mr-2" />
              Manage Schedule & Availability
              <ExternalLink className="size-3 ml-2" />
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Configure personal calendars, blocked times, and appointment slots
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
