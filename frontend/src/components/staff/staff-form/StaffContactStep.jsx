import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TabsContent } from '@/components/ui/tabs';

export function StaffContactStep({ form }) {
  return (
    <TabsContent value="contact" className="space-y-4 mt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="address_line1"
          render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Address Line 1
              </FormLabel>
              <FormControl>
                <Input placeholder="Address line 1" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address_line2"
          render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Address Line 2
              </FormLabel>
              <FormControl>
                <Input placeholder="Address line 2" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                City
              </FormLabel>
              <FormControl>
                <Input placeholder="City" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="state"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                State/Province
              </FormLabel>
              <FormControl>
                <Input placeholder="State/Province" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="postal_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Postal Code
              </FormLabel>
              <FormControl>
                <Input placeholder="Postal code" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Country
              </FormLabel>
              <FormControl>
                <Input placeholder="Country" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </TabsContent>
  );
}
