import Wind from 'lucide-react/dist/esm/icons/wind.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import HeartPulse from 'lucide-react/dist/esm/icons/heart-pulse.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Bath from 'lucide-react/dist/esm/icons/bath.js';
import Tv from 'lucide-react/dist/esm/icons/tv.js';
import Sun from 'lucide-react/dist/esm/icons/sun.js';
import Bell from 'lucide-react/dist/esm/icons/bell.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Accessibility from 'lucide-react/dist/esm/icons/accessibility.js';
import CheckIcon from 'lucide-react/dist/esm/icons/check.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import React, { useId, useState } from 'react';

const DEFAULT_EMPTY_ARRAY = [];

import { useAmenities } from '@/features/wards/hooks/useWardQueries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Icon mapping for amenities
const AMENITY_ICONS = {
  oxygen: Wind,
  suction: Droplets,
  cardiac_monitor: HeartPulse,
  ventilator: Activity,
  private_bathroom: Bath,
  tv: Tv,
  window: Sun,
  nurse_call: Bell,
  fall_prevention: Shield,
  wheelchair_accessible: Accessibility,
};

/**
 * BedAmenityPicker - Multi-select component for bed amenities
 * Can be used for filtering available beds or configuring a bed
 */
export function BedAmenityPicker({
  selectedAmenities = DEFAULT_EMPTY_ARRAY,
  onSelectionChange,
  mode = 'filter', // 'filter' or 'configure'
  className
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const { data: amenities = [], isLoading } = useAmenities({ is_active: true });

  // Group amenities by category
  const groupedAmenities = React.useMemo(() => {
    const groups = {
      medical: [],
      comfort: [],
      accessibility: [],
      safety: [],
    };

    amenities.forEach(amenity => {
      if (groups[amenity.category]) {
        groups[amenity.category].push(amenity);
      }
    });

    return groups;
  }, [amenities]);

  const handleToggle = (amenityId) => {
    const isSelected = selectedAmenities.includes(amenityId);

    if (isSelected) {
      onSelectionChange(selectedAmenities.filter(id => id !== amenityId));
    } else {
      onSelectionChange([...selectedAmenities, amenityId]);
    }
  };

  const handleClear = () => {
    onSelectionChange([]);
  };

  // Get amenity details by ID
  const getAmenityById = (id) => {
    return amenities.find(a => a.id === id);
  };

  // Get icon component for amenity
  const getIcon = (code) => {
    const Icon = AMENITY_ICONS[code] || Activity;
    return Icon;
  };

  const selectedCount = selectedAmenities.length;
  const selectedAmenitiesDetails = selectedAmenities
    .flatMap((id) => {
      const amenity = getAmenityById(id);
      return amenity ? [amenity] : [];
    });

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-haspopup="listbox"
            className="justify-between"
            disabled={isLoading}
          >
            <span className="truncate">
              {isLoading
                ? 'Loading amenities...'
                : selectedCount === 0
                ? mode === 'filter'
                  ? 'Filter by amenities...'
                  : 'Select amenities...'
                : `${selectedCount} amenity${selectedCount > 1 ? 'ies' : ''} selected`}
            </span>
            {selectedCount > 0 && (
              <X
                className="ml-2 size-4 shrink-0 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClear();
                }}
              />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <div id={listboxId} className="max-h-[400px] overflow-y-auto">
            {Object.entries(groupedAmenities).map(([category, items]) => {
              if (items.length === 0) return null;

              return (
                <div key={category} className="border-b last:border-b-0">
                  {/* Category header */}
                  <div className="px-4 py-2 bg-stone-50 text-xs font-medium text-stone-600 uppercase tracking-wide">
                    {category}
                  </div>

                  {/* Amenity items */}
                  <div className="p-2">
                    {items.map((amenity) => {
                      const Icon = getIcon(amenity.code);
                      const isSelected = selectedAmenities.includes(amenity.id);

                      return (
                        <label
                          key={amenity.id}
                          className={cn(
                            'flex items-center gap-3 px-2 py-2 rounded cursor-pointer hover:bg-stone-50 transition-colors',
                            isSelected && 'bg-amber-50 hover:bg-amber-100'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggle(amenity.id)}
                            aria-label={`${isSelected ? 'Remove' : 'Add'} ${amenity.name}`}
                            className="peer sr-only"
                          />
                          <span
                            aria-hidden="true"
                            className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs transition-colors',
                              isSelected && 'border-primary bg-primary text-primary-foreground'
                            )}
                          >
                            {isSelected && <CheckIcon className="size-3.5" />}
                          </span>
                          <Icon className={cn(
                            'size-4 flex-shrink-0',
                            isSelected ? 'text-amber-600' : 'text-stone-400'
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{amenity.name}</div>
                            {amenity.additional_rate > 0 && (
                              <div className="text-xs text-stone-500">
                                +${amenity.additional_rate}/night
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedCount > 0 && (
            <div className="border-t p-2 flex justify-between items-center bg-stone-50">
              <span className="text-sm text-stone-600">
                {selectedCount} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
              >
                Clear all
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Selected amenities badges */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedAmenitiesDetails.map((amenity) => {
            const Icon = getIcon(amenity.code);
            return (
              <Badge
                key={amenity.id}
                variant="outline"
                className="bg-amber-50 text-amber-700 border-amber-200 pl-2 pr-1"
              >
                <Icon className="size-3 mr-1" />
                {amenity.name}
                <button
                  type="button"
                  onClick={() => handleToggle(amenity.id)}
                  className="ml-1 rounded-full p-0.5 hover:bg-amber-200 transition-colors"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
