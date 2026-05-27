import User from 'lucide-react/dist/esm/icons/user.js';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { SearchBar } from '@/components/ui/search-bar';

export function PersonalCalendarPractitionerFields({
  currentUserName,
  form,
  isEditing,
  isLoading,
  practitionerOptions,
  practitionerSearchErrorMessage,
  setSearchTerm,
  shouldAutoFillPractitioner,
  submitting,
}) {
  if (shouldAutoFillPractitioner) {
    return (
      <FormItem>
        <FormLabel className="font-heading text-sm font-medium">Practitioner</FormLabel>
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <User className="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display text-sm font-medium truncate">{currentUserName}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Your Calendar
            </p>
          </div>
        </div>
        <FormDescription className="text-xs text-muted-foreground">
          This personal calendar rule will be created for you.
        </FormDescription>
      </FormItem>
    );
  }

  return (
    <FormField
      control={form.control}
      name="practitioner"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="font-heading text-sm font-medium">Practitioner</FormLabel>
          <FormControl>
            <SearchBar
              options={practitionerOptions}
              value={field.value}
              onChange={field.onChange}
              onInputChange={setSearchTerm}
              placeholder="Select a practitioner"
              emptyMessage={isLoading ? 'Searching...' : 'No practitioners found.'}
              searchPlaceholder="Search by name, employee ID, or license number..."
              disabled={submitting || isEditing}
              maxHeight="20rem"
              isLoading={isLoading}
            />
          </FormControl>
          <FormDescription className="text-xs text-muted-foreground">
            The practitioner this rule applies to. Search by name, employee ID, or license number.
            {isEditing && ' Practitioner cannot be changed after creation.'}
          </FormDescription>
          {practitionerSearchErrorMessage ? (
            <p className="text-xs text-destructive" role="alert">
              {practitionerSearchErrorMessage}
            </p>
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
