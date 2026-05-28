import Check from 'lucide-react/dist/esm/icons/check.js';
import ChevronsUpDown from 'lucide-react/dist/esm/icons/chevrons-up-down.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useId, useState } from 'react';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

import { cn } from '@/lib/utils';
import { useDrugSearch } from '@/hooks/useDrugSafetyQueries';
import { useDebounce } from '@/hooks/use-debounce';

/**
 * MedicationAutocomplete - Autocomplete for drug search using RxNorm
 *
 * @param {Object} props
 * @param {string} props.value - Selected medication name
 * @param {Function} props.onSelect - Callback when medication is selected (receives { name, rxcui })
 * @param {string} props.placeholder - Placeholder text
 * @param {boolean} props.disabled - Whether input is disabled
 * @param {string} props.className - Additional CSS classes
 */
export function MedicationAutocomplete({
  value,
  onSelect,
  placeholder = 'Search for medication...',
  disabled = false,
  className,
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const listboxId = useId();
  const debouncedQuery = useDebounce(searchQuery, 300);

  const { data: searchResults, isLoading, isFetching } = useDrugSearch(debouncedQuery, {
    enabled: debouncedQuery.length >= 2,
  });

  // Filter out entries with null names and deduplicate by rxcui
  // Note: apiClient.get() already extracts the results array from { results: [...] }
  const rawResults = Array.isArray(searchResults) ? searchResults : (searchResults?.results || []);
  const seenRxcuis = new Set();
  const results = [];
  for (const drug of rawResults) {
    if (!drug.name || !drug.rxcui || seenRxcuis.has(drug.rxcui)) continue;
    seenRxcuis.add(drug.rxcui);
    results.push(drug);
  }

  const handleSelect = (medication) => {
    // Return both name and rxcui for drug form lookup
    onSelect?.({ name: medication.name, rxcui: medication.rxcui });
    setOpen(false);
    setSearchQuery('');
  };

  // Determine display state
  const showLoading = isLoading || isFetching || (searchQuery.length >= 2 && debouncedQuery !== searchQuery);
  const showTypeMore = !showLoading && debouncedQuery.length < 2;
  const showNoResults = !showLoading && debouncedQuery.length >= 2 && results.length === 0;
  const showResults = !showLoading && results.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          className={cn('w-full justify-between', className)}
          disabled={disabled}
        >
          {value || placeholder}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[500px] p-0 z-[200]" align="start">
        <Command shouldFilter={false} className="border-border">
          <CommandInput
            placeholder="Type to search medications..."
            value={searchQuery}
            onValueChange={setSearchQuery}
            className="font-mono text-sm"
          />
          <CommandList id={listboxId} className="max-h-[300px]">
            {showLoading && (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner className="size-5 text-sky-600" />
                <span className="ml-3 font-mono text-sm text-muted-foreground">
                  Searching RxNorm database…
                </span>
              </div>
            )}

            {showTypeMore && (
              <div className="py-8 text-center">
                <p className="font-mono text-xs text-muted-foreground">
                  Type at least 2 characters to search medications
                </p>
              </div>
            )}

            {showNoResults && (
              <div className="py-8 text-center">
                <p className="font-mono text-sm text-muted-foreground mb-1">
                  No medications found
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  Try a different search term
                </p>
              </div>
            )}

            {showResults && (
              <CommandGroup className="p-2">
                {results.map((drug) => (
                  <CommandItem
                    key={drug.rxcui}
                    value={drug.name}
                    onSelect={() => handleSelect(drug)}
                    className="cursor-pointer p-3 rounded-md hover:bg-sky-50 dark:hover:bg-sky-900/20 mb-1"
                  >
                    <div className="flex items-start gap-3 w-full">
                      <div className="p-1.5 rounded-md bg-sky-100 dark:bg-sky-900/30 mt-0.5">
                        <Pill className="size-3.5 text-sky-600 dark:text-sky-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-sm font-medium text-foreground">
                          {drug.name}
                        </div>
                        {drug.rxcui && (
                          <div className="font-mono text-xs text-muted-foreground mt-0.5">
                            RxCUI: {drug.rxcui}
                          </div>
                        )}
                      </div>
                      <Check
                        className={cn(
                          'size-4 text-sky-600 flex-shrink-0 mt-1',
                          value === drug.name ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
