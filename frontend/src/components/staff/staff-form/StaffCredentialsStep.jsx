import Check from 'lucide-react/dist/esm/icons/check.js';

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
  return (
    <TabsContent value="credentials" className="space-y-4 mt-4">
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <FormField
          control={form.control}
          name="temporary_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Temporary Password <span className="text-rose-500">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Temporary password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {isPractitioner ? (
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
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-900/10">
          <div className="flex items-center gap-2">
            <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm text-emerald-800 dark:text-emerald-200 font-medium">
              No practitioner credentials needed for this role.
            </p>
          </div>
          <p className="text-xs text-emerald-700/90 dark:text-emerald-300 mt-2 font-mono">
            Practitioner credentials are only required for doctors and nurses.
          </p>
        </div>
      )}
    </TabsContent>
  );
}
