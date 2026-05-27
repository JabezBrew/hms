import Mail from 'lucide-react/dist/esm/icons/mail.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

export function StaffContactSection({ form, isEditing, view }) {
  return (
    <section>
      <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
        <Mail className="size-5 text-muted-foreground" />
        Contact
      </h2>
      <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
        {isEditing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="first_name" render={({ field }) => (
              <FormItem>
                <FormLabel>First Name</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="last_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Last Name</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="phone_number" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone Number</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Mail className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">Email</p>
                {view.email ? (
                  <a href={`mailto:${view.email}`} className="text-sm text-foreground hover:text-primary transition-colors truncate block">
                    {view.email}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">Not provided</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Phone className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">Phone</p>
                {view.phone ? (
                  <a href={`tel:${view.phone}`} className="text-sm text-foreground hover:text-primary transition-colors">
                    {view.phone}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">Not provided</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
