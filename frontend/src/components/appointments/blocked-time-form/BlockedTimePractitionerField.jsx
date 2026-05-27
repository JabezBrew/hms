import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const getPractitionerLabel = (practitioner) => {
  return practitioner?.name
    || `${practitioner.staff_details?.user_details?.first_name || ''} ${practitioner.staff_details?.user_details?.last_name || ''}`.trim()
    || 'Unknown';
};

export function BlockedTimePractitionerField({ control, practitioners, initialData }) {
  return (
    <FormField
      control={control}
      name="practitioner_id"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Practitioner</FormLabel>
          <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!!initialData}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select a practitioner" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {practitioners.map((practitioner) => (
                <SelectItem key={practitioner.id} value={practitioner.id}>
                  {getPractitionerLabel(practitioner)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
