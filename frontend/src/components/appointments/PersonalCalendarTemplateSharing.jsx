import X from 'lucide-react/dist/esm/icons/x.js';

import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { SearchBar } from '@/components/ui/search-bar';

export function PersonalCalendarTemplateSharing({
  addSharedPractitioner,
  availableSharedPractitionerOptions,
  form,
  isLoading,
  removeSharedPractitioner,
  selectedSharedOptionMap,
  selectedSharedPractitioner,
  selectedSharedPractitioners,
  setSearchTerm,
  setSelectedSharedPractitioner,
  submitting,
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
      <div className="space-y-1">
        <h4 className="font-heading text-sm font-medium">Share As Template</h4>
        <p className="text-xs text-muted-foreground">
          Apply this same personal calendar rule to multiple practitioners in one save.
        </p>
      </div>

      <FormField
        control={form.control}
        name="template_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-heading text-xs font-medium">Template Name (Optional)</FormLabel>
            <FormControl>
              <Input
                placeholder="e.g., Internal Medicine Morning Clinic"
                className="font-mono text-xs"
                {...field}
                disabled={submitting}
              />
            </FormControl>
            <FormDescription className="text-xs text-muted-foreground">
              Used to label the shared calendar group.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="space-y-2">
        <FormLabel className="font-heading text-xs font-medium">Additional Practitioners</FormLabel>
        <div className="flex gap-2">
          <SearchBar
            options={availableSharedPractitionerOptions}
            value={selectedSharedPractitioner}
            onChange={setSelectedSharedPractitioner}
            onInputChange={setSearchTerm}
            placeholder="Search to add practitioner"
            emptyMessage={isLoading ? 'Searching...' : 'No practitioners found.'}
            searchPlaceholder="Search by name, employee ID, or license number..."
            disabled={submitting}
            maxHeight="16rem"
            isLoading={isLoading}
          />
          <Button
            type="button"
            variant="outline"
            className="font-mono text-xs whitespace-nowrap"
            onClick={addSharedPractitioner}
            disabled={!selectedSharedPractitioner || submitting}
          >
            Add
          </Button>
        </div>

        {selectedSharedPractitioners.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {selectedSharedPractitioners.map((practitionerId) => {
              const option = selectedSharedOptionMap.get(practitionerId);
              return (
                <span
                  key={practitionerId}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 font-mono text-[10px]"
                >
                  <span className="max-w-[220px] truncate">{option?.label || practitionerId}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => removeSharedPractitioner(practitionerId)}
                    aria-label="Remove practitioner"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No additional practitioners selected. This will create a single rule.
          </p>
        )}
      </div>
    </div>
  );
}
