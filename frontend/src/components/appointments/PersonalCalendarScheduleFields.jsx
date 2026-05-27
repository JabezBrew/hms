import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import format from 'date-fns/format';
import { useFieldArray } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  FormControl,
  FormDescription,
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
import { Switch } from '@/components/ui/switch';
import { TimePicker } from '@/components/ui/time-picker';
import { cn } from '@/lib/utils';
import { personalCalendarDaysOfWeek } from './personalCalendarFormUtils';

function DateField({ form, name, label, emptyLabel, description, submitting }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-col">
          <FormLabel className="font-heading text-sm font-medium">{label}</FormLabel>
          <Popover>
            <PopoverTrigger asChild>
              <FormControl>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full pl-3 text-left font-mono text-sm',
                    !field.value && 'text-muted-foreground'
                  )}
                  disabled={submitting}
                >
                  {field.value ? format(field.value, 'PPP') : <span>{emptyLabel}</span>}
                  <CalendarIcon className="ml-auto size-4 opacity-50" />
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-[400]" align="start" side="bottom" avoidCollisions>
              <Calendar
                mode="single"
                selected={field.value}
                onSelect={field.onChange}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <FormDescription className="text-xs text-muted-foreground">
            {description}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function TimeRangeFields({ form, submitting }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <FormField
        control={form.control}
        name="start_time"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-heading text-sm font-medium">Start Time</FormLabel>
            <FormControl>
              <TimePicker
                value={field.value}
                onChange={field.onChange}
                disabled={submitting}
                placeholder="Select start time"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="end_time"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-heading text-sm font-medium">End Time</FormLabel>
            <FormControl>
              <TimePicker
                value={field.value}
                onChange={field.onChange}
                disabled={submitting}
                placeholder="Select end time"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function BreakFields({ form }) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'breaks',
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <FormLabel className="font-heading text-sm font-medium">Breaks</FormLabel>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="font-mono text-xs h-7"
          onClick={() => append({ start: '12:00', end: '13:00' })}
        >
          <Plus className="mr-1.5 size-3.5" />
          Add Break
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">No breaks defined.</p>
      ) : null}

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
            <FormField
              control={form.control}
              name={`breaks.${index}.start`}
              render={({ field }) => (
                <FormItem className="flex-1 space-y-0">
                  <FormControl>
                    <TimePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Start"
                      className="h-8"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <span className="text-muted-foreground text-xs">to</span>
            <FormField
              control={form.control}
              name={`breaks.${index}.end`}
              render={({ field }) => (
                <FormItem className="flex-1 space-y-0">
                  <FormControl>
                    <TimePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="End"
                      className="h-8"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
              onClick={() => remove(index)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PersonalCalendarScheduleFields({ form, submitting }) {
  return (
    <>
      <FormField
        control={form.control}
        name="days_of_week"
        render={({ field }) => {
          const fieldValue = field.value || [];
          const allDayIds = personalCalendarDaysOfWeek.map((day) => day.id);
          const weekdayIds = [0, 1, 2, 3, 4];
          const allSelected = allDayIds.every((id) => fieldValue.includes(id));
          const weekdaysSelected = weekdayIds.every((id) => fieldValue.includes(id));

          return (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel className="font-heading text-sm font-medium">Days of Week</FormLabel>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 font-mono text-[10px]"
                    onClick={() => field.onChange(weekdaysSelected ? [] : weekdayIds)}
                    disabled={submitting}
                  >
                    {weekdaysSelected ? 'Clear' : 'Weekdays'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 font-mono text-[10px]"
                    onClick={() => field.onChange(allSelected ? [] : allDayIds)}
                    disabled={submitting}
                  >
                    {allSelected ? 'None' : 'All'}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 mt-2">
                {personalCalendarDaysOfWeek.map((day) => {
                  const isChecked = fieldValue.includes(day.id);
                  return (
                    <label
                      key={day.id}
                      className={cn(
                        'flex items-center justify-center rounded-md border px-2 py-2 cursor-pointer transition-colors text-center',
                        isChecked
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                          : 'border-border hover:bg-muted/50'
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Repeat on ${day.label}`}
                        className="sr-only"
                        checked={isChecked}
                        onChange={(event) => {
                          if (event.target.checked) {
                            field.onChange([...fieldValue, day.id]);
                          } else {
                            field.onChange(fieldValue.filter((value) => value !== day.id));
                          }
                        }}
                        disabled={submitting}
                      />
                      <span className={cn(
                        'font-mono text-xs',
                        isChecked ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted-foreground'
                      )}>
                        {day.label.slice(0, 3)}
                      </span>
                    </label>
                  );
                })}
              </div>
              <FormDescription className="text-xs text-muted-foreground">
                Select the days of the week when this rule applies.
              </FormDescription>
              <FormMessage />
            </FormItem>
          );
        }}
      />

      <TimeRangeFields form={form} submitting={submitting} />
      <BreakFields form={form} />

      <FormField
        control={form.control}
        name="slot_duration"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-heading text-sm font-medium">Slot Duration</FormLabel>
            <div className="flex items-center gap-2">
              <FormControl>
                <Input
                  type="number"
                  min={5}
                  step={5}
                  className="font-mono text-sm w-24"
                  {...field}
                  onChange={(event) => field.onChange(parseInt(event.target.value, 10))}
                  disabled={submitting}
                />
              </FormControl>
              <span className="font-mono text-xs text-muted-foreground">minutes</span>
            </div>
            <FormDescription className="text-xs text-muted-foreground">
              The duration of each appointment slot.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-2 gap-4">
        <DateField
          form={form}
          name="active_from"
          label="Active From"
          emptyLabel="Pick a date"
          description="When this rule becomes active."
          submitting={submitting}
        />
        <DateField
          form={form}
          name="active_to"
          label="Active To"
          emptyLabel="No end date"
          description="Optional. Leave blank for indefinite."
          submitting={submitting}
        />
      </div>

      <FormField
        control={form.control}
        name="is_active"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3">
            <div className="space-y-0.5">
              <FormLabel className="font-heading text-sm font-medium">Active Status</FormLabel>
              <FormDescription className="text-xs text-muted-foreground">
                Enable to generate appointment slots.
              </FormDescription>
            </div>
            <FormControl>
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                disabled={submitting}
              />
            </FormControl>
          </FormItem>
        )}
      />
    </>
  );
}
