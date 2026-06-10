import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

import { staffRoleLabels } from '../staffForm.utils';

export function StaffCredentialsStep({ form, isPractitioner, userType }) {
  if (!isPractitioner) return null;

  return (
    <TabsContent value="credentials" className="space-y-4 mt-4">
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Practitioner credentials are required for {staffRoleLabels[userType]?.toLowerCase()} roles.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="license_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  License Number <span className="text-rose-500">*</span>
                </FormLabel>
                <FormControl>
                  <Input placeholder="License number" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="specialization"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Specialization <span className="text-rose-500">*</span>
                </FormLabel>
                <FormControl>
                  <Input placeholder="Specialization" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="qualification"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Qualification <span className="text-rose-500">*</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Qualification and training background"
                  className="min-h-[100px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </TabsContent>
  );
}
