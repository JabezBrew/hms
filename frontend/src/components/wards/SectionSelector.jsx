import Users from 'lucide-react/dist/esm/icons/users.js';
import Home from 'lucide-react/dist/esm/icons/house.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import React from 'react';

import { useWardSections } from '@/features/wards/hooks/useWardQueries';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

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
        return <Sparkles className="size-3" />;
      case 'private':
        return <Home className="size-3" />;
      case 'semi_private':
        return <Users className="size-3" />;
      default:
        return null;
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
                  <Shield className="size-3 mr-1" />
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
