/**
 * UnitSelector - Searchable dropdown for selecting clinical units.
 *
 * Features:
 * - Search by name or code
 * - Optional filtering by unit type, facility, or admission capabilities
 * - Shows unit path for context
 * - Supports single and multiple selection
 */
import Check from 'lucide-react/dist/esm/icons/check.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import { useId, useState, useMemo } from 'react';

import { cn } from '@/lib/utils';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useClinicalUnits } from '@/features/admin/hooks';

export function UnitSelector({
  value,
  onChange,
  placeholder = 'Select unit...',
  disabled = false,
  unitType = null,
  facility = null,
  canAdmit = null,
  canConsult = null,
  multiple = false,
  className,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const listboxId = useId();

  // Build query params
  const queryParams = useMemo(() => {
    const params = {};
    if (unitType) params.unit_type = unitType;
    if (facility) params.facility = facility;
    if (canAdmit !== null) params.accepts_admissions = canAdmit;
    return params;
  }, [unitType, facility, canAdmit]);

  const { data: unitsData, isLoading } = useClinicalUnits(queryParams);
  const units = unitsData?.data?.results || unitsData?.results || [];

  // Filter units based on search
  const filteredUnits = useMemo(() => {
    if (!search) return units;
    const searchLower = search.toLowerCase();
    return units.filter(
      (unit) =>
        unit.name.toLowerCase().includes(searchLower) ||
        unit.code.toLowerCase().includes(searchLower) ||
        (unit.path_cache && unit.path_cache.toLowerCase().includes(searchLower))
    );
  }, [units, search]);

  // Handle selection
  const handleSelect = (unitId) => {
    if (multiple) {
      const currentValue = Array.isArray(value) ? value : [];
      if (currentValue.includes(unitId)) {
        onChange(currentValue.filter((id) => id !== unitId));
      } else {
        onChange([...currentValue, unitId]);
      }
    } else {
      onChange(unitId === value ? null : unitId);
      setOpen(false);
    }
  };

  // Get selected unit(s) for display
  const selectedUnits = useMemo(() => {
    if (!value) return [];
    const valueArray = Array.isArray(value) ? value : [value];
    return units.filter((unit) => valueArray.includes(unit.id));
  }, [value, units]);

  const displayValue = () => {
    if (selectedUnits.length === 0) return placeholder;
    if (multiple) {
      return `${selectedUnits.length} unit${selectedUnits.length > 1 ? 's' : ''} selected`;
    }
    return selectedUnits[0]?.name || placeholder;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn('w-full justify-between', className)}
        >
          <span className="truncate">{displayValue()}</span>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 size-4 shrink-0 opacity-50" />
            <input
              aria-label="Search units"
              placeholder="Search units..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandList id={listboxId}>
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading units…
              </div>
            ) : filteredUnits.length === 0 ? (
              <CommandEmpty>No units found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredUnits.slice(0, 50).map((unit) => {
                  const isSelected = multiple
                    ? Array.isArray(value) && value.includes(unit.id)
                    : value === unit.id;

                  return (
                    <CommandItem
                      key={unit.id}
                      value={unit.id}
                      onSelect={() => handleSelect(unit.id)}
                      className="flex items-start gap-2 py-3"
                    >
                      <div
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-sm border mt-0.5',
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/50'
                        )}
                      >
                        {isSelected && <Check className="size-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Building2 className="size-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">{unit.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {unit.unit_type_code || unit.unit_type_name}
                          </Badge>
                        </div>
                        {unit.path_cache && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {unit.path_cache}
                          </p>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
                {filteredUnits.length > 50 && (
                  <div className="py-2 text-center text-xs text-muted-foreground">
                    Showing 50 of {filteredUnits.length} units. Refine your search.
                  </div>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default UnitSelector;
