/**
 * ChartTemplateCard - Chronicle-styled card for chart template display
 *
 * Magazine-style card for browsing and selecting chart templates.
 * Follows Chronicle Design System with warm colors and editorial typography.
 */

import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Brain from 'lucide-react/dist/esm/icons/brain.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Wind from 'lucide-react/dist/esm/icons/wind.js';
import Flame from 'lucide-react/dist/esm/icons/flame.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Bandage from 'lucide-react/dist/esm/icons/bandage.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Apple from 'lucide-react/dist/esm/icons/apple.js';
import Move from 'lucide-react/dist/esm/icons/move.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Building from 'lucide-react/dist/esm/icons/building.js';
import Globe from 'lucide-react/dist/esm/icons/globe.js';
import Lock from 'lucide-react/dist/esm/icons/lock.js';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Category to icon mapping
const CATEGORY_ICONS = {
  neurological: Brain,
  cardiovascular: Heart,
  respiratory: Wind,
  metabolic: Flame,
  fluid_balance: Droplets,
  pain: Activity,
  wound: Bandage,
  infection: Shield,
  nutrition: Apple,
  mobility: Move,
  safety: Shield,
  custom: ClipboardList,
};

// Category to color mapping (Chronicle palette)
const CATEGORY_COLORS = {
  neurological: 'rose',
  cardiovascular: 'rose',
  respiratory: 'sky',
  metabolic: 'amber',
  fluid_balance: 'sky',
  pain: 'rose',
  wound: 'emerald',
  infection: 'rose',
  nutrition: 'emerald',
  mobility: 'amber',
  safety: 'amber',
  custom: 'amber',
};

// Visibility icons
const VISIBILITY_ICONS = {
  private: Lock,
  role: Users,
  department: Building,
  facility: Globe,
};

const ChartTemplateCard = ({
  template,
  index = 0,
  onSelect,
  onEdit,
  onClone,
  onDelete,
  onView,
  showActions = true,
  selected = false,
}) => {
  const CategoryIcon = CATEGORY_ICONS[template.category] || ClipboardList;
  const colorClass = CATEGORY_COLORS[template.category] || 'amber';
  const VisibilityIcon = VISIBILITY_ICONS[template.visibility] || Globe;

  const colorStyles = {
    amber: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-500/50',
      badge: 'badge-chronicle-amber',
    },
    rose: {
      bg: 'bg-rose-100 dark:bg-rose-900/30',
      text: 'text-rose-600 dark:text-rose-400',
      border: 'border-rose-500/50',
      badge: 'badge-chronicle-rose',
    },
    sky: {
      bg: 'bg-sky-100 dark:bg-sky-900/30',
      text: 'text-sky-600 dark:text-sky-400',
      border: 'border-sky-500/50',
      badge: 'badge-chronicle-sky',
    },
    emerald: {
      bg: 'bg-emerald-100 dark:bg-emerald-900/30',
      text: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-500/50',
      badge: 'badge-chronicle-emerald',
    },
  };

  const colors = colorStyles[colorClass];
  const handleSelect = () => {
    onSelect?.(template);
  };

  return (
    <div
      className={cn(
        "group relative bg-card border border-border rounded-xl sm:rounded-2xl overflow-hidden",
        "transition-all duration-300 hover:border-primary/30 hover:shadow-lg",
        "animate-chronicle-enter",
        selected && `ring-2 ring-primary ${colors.border}`,
        `stagger-${Math.min(index + 1, 10)}`
      )}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 rounded-xl sm:rounded-2xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={handleSelect}
        aria-label={`Select chart template ${template.name}`}
      />

      {/* Category ribbon */}
      <div className={cn(
        "absolute top-0 left-0 w-1 h-full",
        colors.bg.replace('bg-', 'bg-').replace('/30', '/60')
      )} />

      {/* Content */}
      <div className="relative z-10 pointer-events-none p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("p-2 rounded-lg", colors.bg)}>
              <CategoryIcon className={cn("size-4 sm:h-5 sm:w-5", colors.text)} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-base sm:text-lg text-foreground truncate">
                {template.name}
              </h3>
              <p className="font-mono text-[10px] sm:text-xs text-muted-foreground">
                {template.category_display}
              </p>
            </div>
          </div>

          {/* Actions dropdown */}
          {showActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="pointer-events-auto size-8 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[200]">
                {onView && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onView(template); }}>
                    <Eye className="size-4 mr-2" />
                    View Details
                  </DropdownMenuItem>
                )}
                {onEdit && !template.is_system && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(template); }}>
                    <Pencil className="size-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                )}
                {onClone && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClone(template); }}>
                    <Copy className="size-4 mr-2" />
                    Clone
                  </DropdownMenuItem>
                )}
                {onDelete && !template.is_system && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onDelete(template); }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="size-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Description */}
        {template.description && (
          <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mb-3">
            {template.description}
          </p>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Field count */}
          <span className="font-mono text-[10px] sm:text-xs text-muted-foreground">
            {template.field_count || 0} fields
          </span>

          {/* Interval */}
          <span className={cn(
            "font-mono text-[10px] sm:text-xs px-1.5 py-0.5 rounded",
            "bg-muted text-muted-foreground"
          )}>
            {template.interval_display}
          </span>

          {template.scope_type_display && (
            <span className="font-mono text-[10px] sm:text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {template.scope_type_display}
            </span>
          )}

          {/* Visibility */}
          <span className={cn(
            "flex items-center gap-1 font-mono text-[10px] sm:text-xs",
            "px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
          )}>
            <VisibilityIcon className="size-3" />
            <span className="hidden sm:inline">{template.visibility}</span>
          </span>

          {/* System badge */}
          {template.is_system && (
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              System
            </span>
          )}
        </div>

        {/* Creator info */}
        {template.created_by_name && (
          <p className="font-mono text-[9px] sm:text-[10px] text-muted-foreground mt-2">
            Created by {template.created_by_name}
          </p>
        )}
      </div>
    </div>
  );
};

export { ChartTemplateCard };
