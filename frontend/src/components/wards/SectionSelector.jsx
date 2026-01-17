import Users from 'lucide-react/dist/esm/icons/users.js';
import Home from 'lucide-react/dist/esm/icons/house.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import React from 'react';

import { useWardSections } from '@/hooks/useWardQueries';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * SectionSelector - Dropdown for selecting ward sections
 * Shows gender restrictions, accommodation tier, and availability
 */
export function SectionSelector({
  wardId,
  value,
  onValueChange,
  placeholder = "Select section...",
  disabled = false,
  className
}) {
  const { data: sections = [], isLoading } = useWardSections(wardId, {
    enabled: !!wardId,
  });

  const activeSections = sections.filter(section => section.is_active);

  // Get icon for accommodation tier
  const getTierIcon = (tier) => {
    switch (tier) {
      case 'vip':
        return <Sparkles className="h-3 w-3" />;
      case 'private':
        return <Home className="h-3 w-3" />;
      case 'semi_private':
        return <Users className="h-3 w-3" />;
      default:
        return null;
    }
  };

  // Get color for accommodation tier
  const getTierColor = (tier) => {
    switch (tier) {
      case 'vip':
        return 'text-amber-600 bg-amber-50 border-amber-200';
      case 'private':
        return 'text-sky-600 bg-sky-50 border-sky-200';
      case 'semi_private':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'open':
        return 'text-stone-600 bg-stone-50 border-stone-200';
      default:
        return 'text-stone-600 bg-stone-50 border-stone-200';
    }
  };

  // Get gender restriction badge
  const getGenderBadge = (restriction) => {
    if (restriction === 'male_only') {
      return (
        <Badge variant="outline" className="text-xs text-sky-700 bg-sky-50 border-sky-200">
          Male Only
        </Badge>
      );
    }
    if (restriction === 'female_only') {
      return (
        <Badge variant="outline" className="text-xs text-rose-700 bg-rose-50 border-rose-200">
          Female Only
        </Badge>
      );
    }
    return null;
  };

  if (!wardId) {
    return (
      <Select disabled={true}>
        <SelectTrigger className={className}>
          <SelectValue placeholder="Select a ward first" />
        </SelectTrigger>
      </Select>
    );
  }

  if (isLoading) {
    return (
      <Select disabled={true}>
        <SelectTrigger className={className}>
          <SelectValue placeholder="Loading sections..." />
        </SelectTrigger>
      </Select>
    );
  }

  if (activeSections.length === 0) {
    return (
      <Select disabled={true}>
        <SelectTrigger className={className}>
          <SelectValue placeholder="No sections available" />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {activeSections.map((section) => (
          <SelectItem key={section.id} value={section.id}>
            <div className="flex items-center gap-2 py-1">
              {/* Section name with tier icon */}
              <div className="flex items-center gap-1.5 font-medium">
                {getTierIcon(section.accommodation_tier)}
                <span>{section.name}</span>
              </div>

              {/* Gender badge */}
              {getGenderBadge(section.gender_restriction)}

              {/* Isolation indicator */}
              {section.is_isolation_capable && (
                <Badge variant="outline" className="text-xs">
                  <Shield className="h-3 w-3 mr-1" />
                  Isolation
                </Badge>
              )}

              {/* Availability */}
              <span className="text-xs text-stone-500 ml-auto">
                {section.available_beds_count}/{section.bed_count} available
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * SectionBadge - Display section info as a badge
 */
export function SectionBadge({ section, className }) {
  if (!section) return null;

  const getTierColor = (tier) => {
    switch (tier) {
      case 'vip':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'private':
        return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'semi_private':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'open':
        return 'bg-stone-50 text-stone-700 border-stone-200';
      default:
        return 'bg-stone-50 text-stone-700 border-stone-200';
    }
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        'font-normal',
        getTierColor(section.accommodation_tier),
        className
      )}
    >
      {section.name}
      {section.gender_restriction === 'male_only' && ' (Male)'}
      {section.gender_restriction === 'female_only' && ' (Female)'}
    </Badge>
  );
}
