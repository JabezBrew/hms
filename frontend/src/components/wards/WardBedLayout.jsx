import Bed from 'lucide-react/dist/esm/icons/bed.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Home from 'lucide-react/dist/esm/icons/house.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Wrench from 'lucide-react/dist/esm/icons/wrench.js';
import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import VirtualizedGrid from '@/components/ui/VirtualizedGrid';
import VirtualizedList from '@/components/ui/VirtualizedList';

import { useWardSections } from '@/features/wards/hooks/useWardQueries';

const BED_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const EMPTY_ADMISSIONS = [];
const GLOBAL_VIRTUALIZATION_THRESHOLD = 40;
const SECTION_VIRTUALIZATION_THRESHOLD = 16;

const STATUS_CONFIG = {
  available: {
    label: 'Vacant',
    shortLabel: 'Vacant',
    helper: 'Ready for admission',
    icon: Bed,
    dotClass: 'bg-emerald-500',
    railClass: 'border-l-emerald-500',
    borderClass: 'border-emerald-200/80 hover:border-emerald-400',
    bgClass: 'bg-emerald-50/30 hover:bg-emerald-50/70',
    textClass: 'text-emerald-700',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  occupied: {
    label: 'Occupied',
    shortLabel: 'LOS',
    helper: 'Occupied bed',
    icon: Users,
    dotClass: 'bg-rose-500',
    railClass: 'border-l-rose-500',
    borderClass: 'border-rose-200/80 hover:border-rose-400',
    bgClass: 'bg-rose-50/30 hover:bg-rose-50/70',
    textClass: 'text-rose-700',
    badgeClass: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  cleaning: {
    label: 'Cleaning',
    shortLabel: 'Cleaning',
    helper: 'Being cleaned',
    icon: Wrench,
    dotClass: 'bg-amber-500',
    railClass: 'border-l-amber-500',
    borderClass: 'border-amber-200/80 hover:border-amber-400',
    bgClass: 'bg-amber-50/30 hover:bg-amber-50/70',
    textClass: 'text-amber-700',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  maintenance: {
    label: 'Blocked',
    shortLabel: 'Blocked',
    helper: 'Unavailable for assignment',
    icon: Shield,
    dotClass: 'bg-stone-500',
    railClass: 'border-l-stone-500',
    borderClass: 'border-stone-300/80 hover:border-stone-500',
    bgClass: 'bg-stone-50/40 hover:bg-stone-100/70',
    textClass: 'text-stone-700',
    badgeClass: 'border-stone-300 bg-stone-100 text-stone-700',
  },
  blocked: {
    label: 'Blocked',
    shortLabel: 'Blocked',
    helper: 'Unavailable for assignment',
    icon: Shield,
    dotClass: 'bg-stone-500',
    railClass: 'border-l-stone-500',
    borderClass: 'border-stone-300/80 hover:border-stone-500',
    bgClass: 'bg-stone-50/40 hover:bg-stone-100/70',
    textClass: 'text-stone-700',
    badgeClass: 'border-stone-300 bg-stone-100 text-stone-700',
  },
  reserved: {
    label: 'Reserved',
    shortLabel: 'Reserved',
    helper: 'Held for incoming admission',
    icon: Clock,
    dotClass: 'bg-sky-500',
    railClass: 'border-l-sky-500',
    borderClass: 'border-sky-200/80 hover:border-sky-400',
    bgClass: 'bg-sky-50/30 hover:bg-sky-50/70',
    textClass: 'text-sky-700',
    badgeClass: 'border-sky-200 bg-sky-50 text-sky-700',
  },
};

const STATUS_ORDER = ['occupied', 'available', 'cleaning', 'maintenance', 'reserved'];

const BED_TYPE_LABELS = {
  standard: 'Standard',
  icu: 'ICU',
  pediatric: 'Pediatric',
  bariatric: 'Bariatric',
  maternity: 'Maternity',
  electric: 'Electric',
  manual: 'Manual',
};

function getStatusConfig(status) {
  return STATUS_CONFIG[canonicalStatus(status)] || STATUS_CONFIG.available;
}

function canonicalStatus(status) {
  if (status === 'blocked' || status === 'closed' || status === 'maintenance') return 'maintenance';
  if (status === 'cleaning') return 'cleaning';
  if (status === 'reserved') return 'reserved';
  if (status === 'occupied') return 'occupied';
  return 'available';
}

function formatBedType(type) {
  if (!type) return 'Bed';
  return BED_TYPE_LABELS[type] || type.replaceAll('_', ' ');
}

function getLosDays(admissionDate) {
  if (!admissionDate) return null;
  const admittedAt = new Date(admissionDate);
  if (Number.isNaN(admittedAt.getTime())) return null;

  const admittedDay = new Date(
    admittedAt.getFullYear(),
    admittedAt.getMonth(),
    admittedAt.getDate(),
  );
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = todayDay.getTime() - admittedDay.getTime();

  return Math.max(0, Math.floor(diff / 86_400_000));
}

function getBedOperationalAdmission(bed, admissions) {
  if (bed?.occupied_since || bed?.admitted_at || bed?.admission_date) {
    const admittedAt = bed.occupied_since || bed.admitted_at || bed.admission_date;
    return {
      losDays: getLosDays(admittedAt),
    };
  }

  const activeAdmission = admissions.find((admission) => {
    const admissionBedId = admission?.bed?.id || admission?.bed;
    return admissionBedId === bed.id && admission.status === 'admitted';
  });

  if (!activeAdmission) return null;

  return {
    losDays: getLosDays(activeAdmission.admission_date),
  };
}

function buildSectionGroups(wardBeds, sections) {
  const grouped = new Map();

  wardBeds.forEach((bed) => {
    const sectionId = bed.section || 'unassigned';
    const group = grouped.get(sectionId) || [];
    group.push(bed);
    grouped.set(sectionId, group);
  });

  grouped.forEach((group) => {
    group.sort((a, b) => BED_COLLATOR.compare(a.bed_number || '', b.bed_number || ''));
  });

  const sortedGroups = [];
  const knownSectionIds = new Set();
  sections
    .toSorted((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .forEach((section) => {
      knownSectionIds.add(section.id);
      const sectionBeds = grouped.get(section.id);
      if (sectionBeds) {
        sortedGroups.push({ section, beds: sectionBeds });
      }
    });

  grouped.forEach((beds, sectionId) => {
    if (sectionId === 'unassigned' || knownSectionIds.has(sectionId)) return;
    sortedGroups.push({
      section: { id: sectionId, name: 'Unassigned Section', is_active: true },
      beds,
    });
  });

  if (grouped.has('unassigned')) {
    sortedGroups.push({
      section: { id: 'unassigned', name: 'Unassigned Beds', is_active: true },
      beds: grouped.get('unassigned'),
    });
  }

  return sortedGroups;
}

function getSectionCounts(beds) {
  return beds.reduce(
    (counts, bed) => {
      const status = canonicalStatus(bed.status);
      counts.total += 1;
      counts[status] += 1;
      return counts;
    },
    { total: 0, occupied: 0, available: 0, cleaning: 0, maintenance: 0, reserved: 0 },
  );
}

function formatCountLabel(status, count) {
  const label = getStatusConfig(status).label.toLowerCase();
  return `${count} ${label}`;
}

/**
 * WardBedLayout - compact bed-state visualization.
 *
 * The bed grid is an operational capacity surface. It intentionally avoids
 * patient names and clinical details; LOS is the only admission-derived value.
 */
export function WardBedLayout({
  beds,
  admissions = EMPTY_ADMISSIONS,
  onBedClick,
  sections: providedSections,
  wardId,
  viewMode = 'grid',
}) {
  const wardBeds = React.useMemo(
    () => beds.filter((bed) => bed.ward === wardId || !wardId),
    [beds, wardId],
  );

  const { data: queriedSections = [] } = useWardSections(wardId, {
    enabled: !!wardId && !providedSections,
  });
  const sections = providedSections || queriedSections;

  const sectionGroups = React.useMemo(
    () => buildSectionGroups(wardBeds, sections),
    [wardBeds, sections],
  );

  const admissionByBedId = React.useMemo(() => {
    const byBedId = new Map();
    wardBeds.forEach((bed) => {
      const admission = getBedOperationalAdmission(bed, admissions);
      if (admission) byBedId.set(bed.id, admission);
    });
    return byBedId;
  }, [admissions, wardBeds]);
  const totalBedCount = React.useMemo(
    () => sectionGroups.reduce((total, group) => total + group.beds.length, 0),
    [sectionGroups],
  );

  if (viewMode === 'list') {
    return (
      <ListView
        admissionByBedId={admissionByBedId}
        onBedClick={onBedClick}
        sectionGroups={sectionGroups}
        totalBedCount={totalBedCount}
      />
    );
  }

  return (
    <GridView
      admissionByBedId={admissionByBedId}
      onBedClick={onBedClick}
      sectionGroups={sectionGroups}
      totalBedCount={totalBedCount}
    />
  );
}

function SectionHeader({ section, beds }) {
  const counts = getSectionCounts(beds);
  const isUnassigned = section.id === 'unassigned';

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        {!isUnassigned && getTierIcon(section.accommodation_tier)}
        <h3 className="truncate font-heading text-base font-semibold text-foreground">
          {section.name}
        </h3>
      </div>

      <span className="font-mono text-xs text-muted-foreground">
        {counts.total} beds
      </span>

      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
        {STATUS_ORDER.map((status) => (
          <SectionCount key={status} count={counts[status]} status={status} />
        ))}
      </div>

      {!isUnassigned && (
        <SectionBadges section={section} />
      )}
    </div>
  );
}

function SectionCount({ count, status }) {
  const config = getStatusConfig(status);

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn('size-1.5 rounded-full', config.dotClass)} aria-hidden="true" />
      {formatCountLabel(status, count)}
    </span>
  );
}

function SectionBadges({ section }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {section.accommodation_tier && (
        <Badge
          variant="outline"
          className={cn('h-6 capitalize', getTierColor(section.accommodation_tier))}
        >
          {section.accommodation_tier.replace('_', ' ')}
        </Badge>
      )}
      {section.gender_restriction === 'male_only' && (
        <Badge variant="outline" className="h-6 border-sky-200 bg-sky-50 text-sky-700">
          Male Only
        </Badge>
      )}
      {section.gender_restriction === 'female_only' && (
        <Badge variant="outline" className="h-6 border-rose-200 bg-rose-50 text-rose-700">
          Female Only
        </Badge>
      )}
      {section.is_isolation_capable && (
        <Badge variant="outline" className="h-6">
          <Shield className="mr-1 size-3" aria-hidden="true" />
          Isolation
        </Badge>
      )}
    </div>
  );
}

function getTierIcon(tier) {
  switch (tier) {
    case 'vip':
      return <Sparkles className="size-4 text-amber-600" aria-hidden="true" />;
    case 'private':
      return <Home className="size-4 text-sky-600" aria-hidden="true" />;
    case 'semi_private':
      return <Users className="size-4 text-emerald-600" aria-hidden="true" />;
    default:
      return null;
  }
}

function getTierColor(tier) {
  switch (tier) {
    case 'vip':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'private':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    case 'semi_private':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'open':
      return 'border-stone-200 bg-stone-50 text-stone-700';
    default:
      return 'border-stone-200 bg-stone-50 text-stone-700';
  }
}

function GridView({ admissionByBedId, onBedClick, sectionGroups, totalBedCount }) {
  const virtualizationThreshold = totalBedCount >= GLOBAL_VIRTUALIZATION_THRESHOLD
    ? 1
    : SECTION_VIRTUALIZATION_THRESHOLD;

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <BedMapLegend />

        {sectionGroups.map(({ section, beds }) => (
          <Collapsible key={section.id} defaultOpen className="rounded-lg border border-border bg-card/60">
            <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3">
              <SectionHeader section={section} beds={beds} />
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 size-7 shrink-0 text-muted-foreground"
                  aria-label={`Toggle ${section.name}`}
                >
                  <ChevronDown className="size-4" aria-hidden="true" />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className="p-3">
                <VirtualizedGrid
                  items={beds}
                  minItemWidth={146}
                  rowHeight={58}
                  gap={8}
                  threshold={virtualizationThreshold}
                  getItemKey={(bed) => bed.id}
                  renderItem={(bed) => (
                    <BedCell
                      admission={admissionByBedId.get(bed.id)}
                      bed={bed}
                      onBedClick={onBedClick}
                    />
                  )}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </TooltipProvider>
  );
}

function ListView({ admissionByBedId, onBedClick, sectionGroups, totalBedCount }) {
  const virtualizationThreshold = totalBedCount >= GLOBAL_VIRTUALIZATION_THRESHOLD
    ? 1
    : SECTION_VIRTUALIZATION_THRESHOLD;

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <BedMapLegend />

        {sectionGroups.map(({ section, beds }) => (
          <Collapsible key={section.id} defaultOpen className="rounded-lg border border-border bg-card/60">
            <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3">
              <SectionHeader section={section} beds={beds} />
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 size-7 shrink-0 text-muted-foreground"
                  aria-label={`Toggle ${section.name}`}
                >
                  <ChevronDown className="size-4" aria-hidden="true" />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className="p-3">
                <VirtualizedList
                  items={beds}
                  estimateSize={52}
                  gap={6}
                  threshold={virtualizationThreshold}
                  getItemKey={(bed) => bed.id}
                  renderItem={(bed) => (
                    <BedStrip
                      admission={admissionByBedId.get(bed.id)}
                      bed={bed}
                      onBedClick={onBedClick}
                    />
                  )}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </TooltipProvider>
  );
}

function BedMapLegend() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/50 px-4 py-3">
      <div>
        <h2 className="font-heading text-base font-semibold text-foreground">Bay Map Microgrid</h2>
        <p className="text-sm text-muted-foreground">Physical bed capacity and operations</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {STATUS_ORDER.map((status) => {
          const config = getStatusConfig(status);
          return (
            <span key={status} className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <span className={cn('h-1.5 w-4 rounded-full', config.dotClass)} aria-hidden="true" />
              {config.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function BedCell({ admission, bed, onBedClick }) {
  const config = getStatusConfig(bed.status);
  const StatusIcon = config.icon;
  const losLabel = admission?.losDays !== null && admission?.losDays !== undefined
    ? `LOS ${admission.losDays}d`
    : null;
  const secondaryLabel = bed.status === 'occupied'
    ? losLabel || config.label
    : config.shortLabel;
  const ariaLabel = [
    bed.bed_number,
    config.label,
    losLabel,
  ].filter(Boolean).join(', ');

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onBedClick(bed.id)}
          className={cn(
            'group flex min-h-[58px] w-full items-center gap-3 rounded-md border border-l-[3px] bg-background px-3 py-2 text-left transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            config.railClass,
            config.borderClass,
            config.bgClass,
          )}
          aria-label={ariaLabel}
        >
          <StatusIcon className={cn('size-4 shrink-0', config.textClass)} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-sm font-semibold leading-5 text-foreground">
              {bed.bed_number}
            </span>
            <span className={cn('block truncate font-mono text-xs leading-4', config.textClass)}>
              {secondaryLabel}
            </span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs p-0">
        <BedTooltip admission={admission} bed={bed} config={config} />
      </TooltipContent>
    </Tooltip>
  );
}

function BedStrip({ admission, bed, onBedClick }) {
  const config = getStatusConfig(bed.status);
  const losLabel = admission?.losDays !== null && admission?.losDays !== undefined
    ? `LOS ${admission.losDays}d`
    : null;

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onBedClick(bed.id)}
          className={cn(
            'flex min-h-[48px] w-full items-center gap-3 rounded-md border border-l-[3px] bg-background px-3 py-2 text-left transition-colors',
            'hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            config.railClass,
            config.borderClass,
          )}
          aria-label={[bed.bed_number, config.label, losLabel].filter(Boolean).join(', ')}
        >
          <span className="min-w-[5.5rem] font-mono text-sm font-semibold text-foreground">
            {bed.bed_number}
          </span>
          <Badge variant="outline" className={cn('h-6 shrink-0 font-mono text-[11px]', config.badgeClass)}>
            {config.label}
          </Badge>
          {losLabel && (
            <span className={cn('font-mono text-xs', config.textClass)}>
              {losLabel}
            </span>
          )}
          <span className="ml-auto truncate font-mono text-xs capitalize text-muted-foreground">
            {formatBedType(bed.bed_type)}
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs p-0">
        <BedTooltip admission={admission} bed={bed} config={config} />
      </TooltipContent>
    </Tooltip>
  );
}

function BedTooltip({ admission, bed, config }) {
  const losLabel = admission?.losDays !== null && admission?.losDays !== undefined
    ? `LOS ${admission.losDays}d`
    : null;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="font-mono text-sm font-bold text-foreground">
            {bed.bed_number}
          </h4>
          <p className="font-mono text-xs capitalize text-muted-foreground">
            {formatBedType(bed.bed_type)}
          </p>
        </div>
        <Badge variant="outline" className={cn('font-mono text-[11px]', config.badgeClass)}>
          {config.label}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono text-xs">
        <div>
          <p className="text-muted-foreground">Status</p>
          <p className={cn('font-medium', config.textClass)}>{config.helper}</p>
        </div>
        {losLabel && (
          <div>
            <p className="text-muted-foreground">Length of stay</p>
            <p className={cn('font-medium', config.textClass)}>{losLabel}</p>
          </div>
        )}
      </div>

      {bed.total_rate && (
        <div className="border-t border-border pt-2 font-mono text-xs text-muted-foreground">
          Rate {bed.total_rate}
        </div>
      )}

    </div>
  );
}
