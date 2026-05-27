import { Checkbox } from '@/components/ui/checkbox';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';

export function BlockedTimeAllDayField({ control }) {
  return (
    <FormField
      control={control}
      name="is_all_day"
      render={({ field }) => (
        <FormItem className="flex flex-row items-start gap-x-3 gap-y-0 rounded-md border p-4">
          <FormControl>
            <Checkbox
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel>All Day</FormLabel>
            <FormDescription>
              Block the entire day
            </FormDescription>
          </div>
        </FormItem>
      )}
    />
  );
}
