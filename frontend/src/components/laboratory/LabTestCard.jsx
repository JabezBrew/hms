import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import Tag from 'lucide-react/dist/esm/icons/tag.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * LabTestCard - Chronicle-styled card for displaying lab tests in catalog
 *
 * Features:
 * - Magazine-style card with warm stone colors
 * - Shows test name, code, category, price, TAT
 * - Status indicators for system/modified/custom tests
 * - Hover-reveal action buttons
 */
const LabTestCard = ({
  test,
  index = 0,
  onCustomize,
  onReset,
  onDelete,
  className,
}) => {
  // Format price
  const formatPrice = (price) => {
    if (!price) return "Not set";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(price);
  };

  // Get status badge config
  const getStatusBadge = () => {
    if (!test.is_system_default) {
      return {
        label: "Custom",
        className: "bg-sky-500/10 text-sky-600 border-sky-500/30",
      };
    }
    if (test.is_facility_modified) {
      return {
        label: "Modified",
        className: "bg-amber-500/10 text-amber-600 border-amber-500/30",
      };
    }
    return {
      label: "System",
      className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    };
  };

  const statusBadge = getStatusBadge();

  // Category display name
  const getCategoryDisplay = (category) => {
    const categories = {
      hematology: "Hematology",
      chemistry: "Chemistry",
      microbiology: "Microbiology",
      immunology: "Immunology",
      urinalysis: "Urinalysis",
      coagulation: "Coagulation",
      serology: "Serology",
      molecular: "Molecular/PCR",
      pathology: "Pathology",
      toxicology: "Toxicology",
      endocrine: "Endocrine",
      cardiac: "Cardiac Markers",
      other: "Other",
    };
    return categories[category] || category;
  };

  // Get category color
  const getCategoryColor = (category) => {
    const colors = {
      hematology: "badge-chronicle-rose",
      chemistry: "badge-chronicle-amber",
      coagulation: "badge-chronicle-rose",
      urinalysis: "badge-chronicle-sky",
      cardiac: "badge-chronicle-rose",
      endocrine: "badge-chronicle-emerald",
      default: "badge-chronicle-amber",
    };
    return colors[category] || colors.default;
  };

  return (
    <article
      className={cn(
        "relative bg-card/30 rounded-xl p-5 border border-border/50",
        "hover:border-border hover:bg-card/50 transition-all duration-200",
        "group animate-chronicle-enter",
        className
      )}
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Header row with status badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
            <TestTube2 className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          </div>
          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full border font-mono",
              statusBadge.className
            )}
          >
            {statusBadge.label}
          </span>
        </div>

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onCustomize?.(test)}>
              <Settings2 className="h-4 w-4 mr-2" aria-hidden="true" />
              Customize
            </DropdownMenuItem>
            {test.is_system_default && test.is_facility_modified && (
              <DropdownMenuItem onClick={() => onReset?.(test)}>
                <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
                Reset to Defaults
              </DropdownMenuItem>
            )}
            {!test.is_system_default && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete?.(test)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                  Delete Test
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Test name */}
      <h3 className="font-display text-lg text-foreground mb-1 line-clamp-2">
        {test.name}
      </h3>

      {/* LOINC code and category */}
      <div className="flex items-center gap-2 mb-3">
        {test.loinc_code && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="font-mono text-xs text-muted-foreground">
                  {test.loinc_code}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>LOINC Code</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <span className={getCategoryColor(test.category)}>
          {getCategoryDisplay(test.category)}
        </span>
      </div>

      {/* Description if available */}
      {test.description && (
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {test.description}
        </p>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2 mt-auto pt-3 border-t border-border/50">
        {/* Price */}
        <div className="flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-sm text-foreground">
            {formatPrice(test.price)}
          </span>
        </div>

        {/* TAT */}
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-sm text-foreground">
            {test.tat_hours ? `${test.tat_hours}h TAT` : "—"}
          </span>
        </div>
      </div>

      {/* Specimen type */}
      {test.specimen_type && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/30">
          <Tag className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-xs text-muted-foreground uppercase">
            {test.specimen_type}
          </span>
        </div>
      )}

      {/* Active/Inactive indicator */}
      {test.is_active === false && (
        <div className="absolute top-2 right-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
            Inactive
          </span>
        </div>
      )}
    </article>
  );
};

/**
 * LabPanelCard - Chronicle-styled card for displaying lab panels
 */
const LabPanelCard = ({
  panel,
  index = 0,
  onCustomize,
  onReset,
  onDelete,
  className,
}) => {
  // Format price
  const formatPrice = (price) => {
    if (!price) return "Not set";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(price);
  };

  // Get status badge config
  const getStatusBadge = () => {
    if (!panel.is_system_default) {
      return {
        label: "Custom",
        className: "bg-sky-500/10 text-sky-600 border-sky-500/30",
      };
    }
    if (panel.is_facility_modified) {
      return {
        label: "Modified",
        className: "bg-amber-500/10 text-amber-600 border-amber-500/30",
      };
    }
    return {
      label: "System",
      className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    };
  };

  const statusBadge = getStatusBadge();
  const testsCount = panel.tests?.length || panel.tests_count || 0;

  return (
    <article
      className={cn(
        "relative bg-card/30 rounded-xl p-5 border border-border/50",
        "hover:border-border hover:bg-card/50 transition-all duration-200",
        "group animate-chronicle-enter",
        className
      )}
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Header row with status badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <TestTube2 className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full border font-mono",
              statusBadge.className
            )}
          >
            {statusBadge.label}
          </span>
        </div>

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onCustomize?.(panel)}>
              <Settings2 className="h-4 w-4 mr-2" aria-hidden="true" />
              Customize
            </DropdownMenuItem>
            {panel.is_system_default && panel.is_facility_modified && (
              <DropdownMenuItem onClick={() => onReset?.(panel)}>
                <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
                Reset to Defaults
              </DropdownMenuItem>
            )}
            {!panel.is_system_default && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete?.(panel)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                  Delete Panel
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Panel name */}
      <h3 className="font-display text-lg text-foreground mb-1 line-clamp-2">
        {panel.name}
      </h3>

      {/* Code and tests count */}
      <div className="flex items-center gap-2 mb-3">
        {panel.code && (
          <span className="font-mono text-xs text-muted-foreground">
            {panel.code}
          </span>
        )}
        <span className="badge-chronicle-amber">
          {testsCount} test{testsCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Description */}
      {panel.description && (
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {panel.description}
        </p>
      )}

      {/* Price */}
      <div className="flex items-center gap-1.5 mt-auto pt-3 border-t border-border/50">
        <DollarSign className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-mono text-sm text-foreground">
          {formatPrice(panel.price)}
        </span>
      </div>

      {/* Active/Inactive indicator */}
      {panel.is_active === false && (
        <div className="absolute top-2 right-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
            Inactive
          </span>
        </div>
      )}
    </article>
  );
};

export default LabTestCard;
export { LabTestCard, LabPanelCard };
