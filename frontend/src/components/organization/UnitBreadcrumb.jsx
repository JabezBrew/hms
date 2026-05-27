/**
 * UnitBreadcrumb - Shows the hierarchy path for a clinical unit.
 *
 * Displays the path from root (facility) to the current unit with
 * clickable links to navigate to parent units.
 */

import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import { cn } from '@/lib/utils';
import { useUnitAncestors } from '@/features/admin/hooks';

export function UnitBreadcrumb({
  unitId,
  unit = null,
  onUnitClick = null,
  showIcon = true,
  className,
}) {
  // If ancestors are needed for navigation, fetch them
  const { data: ancestorsData, isLoading } = useUnitAncestors(
    onUnitClick ? unitId : null,
    { enabled: !!onUnitClick && !!unitId }
  );

  // If we just need to display the path and have the unit with path_cache
  if (unit?.path_cache && !onUnitClick) {
    const pathParts = unit.path_cache.split(' > ');

    return (
      <nav className={cn('flex items-center text-sm', className)}>
        {showIcon && (
          <Building2 className="size-4 text-muted-foreground mr-2 shrink-0" />
        )}
        <ol className="flex items-center flex-wrap gap-1">
          {pathParts.map((part, index) => (
            <li key={pathParts.slice(0, index + 1).join(' > ')} className="flex items-center">
              {index > 0 && (
                <ChevronRight className="size-4 text-muted-foreground mx-1 shrink-0" />
              )}
              <span
                className={cn(
                  index === pathParts.length - 1
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {part}
              </span>
            </li>
          ))}
        </ol>
      </nav>
    );
  }

  // Interactive breadcrumb with clickable ancestors
  const ancestors = ancestorsData?.data || ancestorsData || [];

  if (isLoading) {
    return (
      <nav className={cn('flex items-center text-sm', className)}>
        {showIcon && (
          <Building2 className="size-4 text-muted-foreground mr-2 shrink-0" />
        )}
        <span className="text-muted-foreground">Loading…</span>
      </nav>
    );
  }

  const allUnits = [...ancestors, ...(unit ? [unit] : [])];

  return (
    <nav className={cn('flex items-center text-sm', className)}>
      {showIcon && (
        <Building2 className="size-4 text-muted-foreground mr-2 shrink-0" />
      )}
      <ol className="flex items-center flex-wrap gap-1">
        {allUnits.map((item, index) => (
          <li key={item.id} className="flex items-center">
            {index > 0 && (
              <ChevronRight className="size-4 text-muted-foreground mx-1 shrink-0" />
            )}
            {onUnitClick && index < allUnits.length - 1 ? (
              <button
                type="button"
                onClick={() => onUnitClick(item.id)}
                className="text-muted-foreground hover:text-foreground hover:underline transition-colors"
              >
                {item.name}
              </button>
            ) : (
              <span
                className={cn(
                  index === allUnits.length - 1
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default UnitBreadcrumb;
