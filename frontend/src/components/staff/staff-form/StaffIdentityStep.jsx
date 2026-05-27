import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import format from 'date-fns/format';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { isPractitionerUserType, staffRoleOptions } from '../staffForm.utils';
import { MIN_STAFF_DATE } from './staffFormDate';

export function StaffIdentityStep({ form, currentDate, onUserTypeChange }) {
  return (
    <TabsContent value="identity" className="space-y-4 mt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="first_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                First Name <span className="text-rose-500">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="First name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="last_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Last Name <span className="text-rose-500">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="Last name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Email <span className="text-rose-500">*</span>
              </FormLabel>
              <FormControl>
                <Input type="email" placeholder="Email address" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone_number"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Phone Number
              </FormLabel>
              <FormControl>
                <Input placeholder="Phone number" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="date_of_birth"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Date of Birth <span className="text-rose-500">*</span>
              </FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full pl-3 text-left font-normal',
                        !field.value && 'text-muted-foreground'
                      )}
                    >
                      {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                      <CalendarIcon className="ml-auto size-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > currentDate || date < MIN_STAFF_DATE}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="user_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                User Type <span className="text-rose-500">*</span>
              </FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  if (!isPractitionerUserType(value)) {
                    onUserTypeChange(value);
                  }
                }}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select user type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {staffRoleOptions.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </TabsContent>
  );
}
