import Briefcase from 'lucide-react/dist/esm/icons/briefcase.js';
import Building from 'lucide-react/dist/esm/icons/building.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';

import { DatePicker } from '@/components/ui/date-picker';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

import { InfoItem } from './InfoItem';

export function StaffEmploymentSection({ form, isEditing, view }) {
  return (
    <section>
      <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
        <Briefcase className="size-5 text-muted-foreground" />
        Employment
      </h2>
      <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
        {isEditing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="department" render={({ field }) => (
              <FormItem>
                <FormLabel>Department</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="position" render={({ field }) => (
              <FormItem>
                <FormLabel>Position</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="hire_date" render={({ field }) => (
              <FormItem>
                <FormLabel>Hire Date</FormLabel>
                <FormControl>
                  <DatePicker date={field.value} onSelect={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
            <InfoItem label="Department" value={view.department} icon={Building} />
            <InfoItem label="Position" value={view.position} icon={Briefcase} />
            <InfoItem label="Hire Date" value={view.hireDate} icon={Calendar} />
            <InfoItem label="Tenure" value={view.tenure} icon={Clock} />
          </div>
        )}
      </div>
    </section>
  );
}
