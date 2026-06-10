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

import { MIN_STAFF_DATE } from './staffFormDate';

export function StaffEmploymentStep({
  form,
  currentDate,
  dateOfBirth,
  departmentOptions,
  isDepartmentsLoading,
}) {
  return (
    <TabsContent value="employment" className="space-y-4 mt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="department"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Department <span className="text-rose-500">*</span>
              </FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={isDepartmentsLoading || !departmentOptions.length}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isDepartmentsLoading
                          ? 'Loading departments…'
                          : departmentOptions.length
                            ? 'Select department'
                            : 'No departments configured'
                      }
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {departmentOptions.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!isDepartmentsLoading && !departmentOptions.length ? (
                <p className="text-[11px] font-mono text-amber-600">
                  Create a department under Organization first.
                </p>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="position"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Position <span className="text-rose-500">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="Position" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="hire_date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Hire Date <span className="text-rose-500">*</span>
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
                    disabled={(date) => (
                      date > currentDate ||
                      date < MIN_STAFF_DATE ||
                      (dateOfBirth ? date < dateOfBirth : false)
                    )}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </TabsContent>
  );
}
