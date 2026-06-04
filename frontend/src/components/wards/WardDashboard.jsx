import Search from 'lucide-react/dist/esm/icons/search.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import List from 'lucide-react/dist/esm/icons/list.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Home from 'lucide-react/dist/esm/icons/house.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

import { useWard, useWardBedMap } from '@/features/wards/hooks/useWardQueries';
import { WardBedLayout } from './WardBedLayout';

const EMPTY_WARD_FILTERS = {
  status: 'all',
  searchTerm: '',
};

const EMPTY_BEDS = [];
const EMPTY_SECTIONS = [];

const WARD_TYPE_LABELS = {
  general: 'General Ward',
  private: 'Private Ward',
  icu: 'Intensive Care Unit',
  emergency: 'Emergency Ward',
  maternity: 'Maternity Ward',
  pediatric: 'Pediatric Ward',
  psychiatric: 'Psychiatric Ward',
  isolation: 'Isolation Ward',
};

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Vacant' },
  { value: 'occupied', label: 'Occupied' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'maintenance', label: 'Blocked' },
];

const STAT_CARD_COLOR_CLASSES = {
  primary: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    icon: 'text-primary',
    active: 'ring-2 ring-primary',
  },
  emerald: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-600',
    icon: 'text-emerald-600',
    active: 'ring-2 ring-emerald-500',
  },
  rose: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-600',
    icon: 'text-rose-600',
    active: 'ring-2 ring-rose-500',
  },
  amber: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-600',
    icon: 'text-amber-600',
    active: 'ring-2 ring-amber-500',
  },
  slate: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-600',
    icon: 'text-slate-600',
    active: 'ring-2 ring-slate-500',
  },
  sky: {
    bg: 'bg-sky-500/10',
    text: 'text-sky-600',
    icon: 'text-sky-600',
    active: 'ring-2 ring-sky-500',
  },
};

function getSectionTierIcon(tier) {
  switch (tier) {
    case 'vip':
      return <Sparkles className="size-3.5" />;
    case 'private':
      return <Home className="size-3.5" />;
    case 'semi_private':
      return <Users className="size-3.5" />;
    default:
      return null;
  }
}

function getSectionTierColor(tier) {
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
}

function getSectionOccupancyColor(rate) {
  if (rate >= 90) return 'text-rose-600';
  if (rate >= 70) return 'text-amber-600';
  return 'text-emerald-600';
}

function canonicalBedStatus(status) {
  if (status === 'blocked' || status === 'closed' || status === 'maintenance') return 'maintenance';
  if (status === 'cleaning') return 'cleaning';
  if (status === 'reserved') return 'reserved';
  if (status === 'occupied') return 'occupied';
  return 'available';
}

function filterBeds(beds, filters) {
  const normalizedSearch = filters.searchTerm.toLowerCase();

  return beds.filter((bed) => {
    if (filters.status !== 'all' && canonicalBedStatus(bed.status) !== filters.status) return false;
    if (normalizedSearch && !bed.bed_number.toLowerCase().includes(normalizedSearch)) {
      return false;
    }
    return true;
  });
}

function countBedsByStatus(beds) {
  return beds.reduce(
    (acc, bed) => {
      acc.total += 1;
      const status = canonicalBedStatus(bed.status);
      acc[status] += 1;
      return acc;
    },
    { total: 0, available: 0, occupied: 0, reserved: 0, cleaning: 0, maintenance: 0 },
  );
}

function aggregateCount(source, keys, fallback) {
  const names = Array.isArray(keys) ? keys : [keys];
  for (const key of names) {
    const value = source?.[key];
    if (value !== undefined && value !== null) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function buildWardStats(ward, beds) {
  const bedPageCounts = countBedsByStatus(beds);

  return {
    total: aggregateCount(ward, 'total_beds', bedPageCounts.total),
    available: aggregateCount(ward, 'available_beds_count', bedPageCounts.available),
    occupied: aggregateCount(ward, 'occupied_beds_count', bedPageCounts.occupied),
    reserved: aggregateCount(ward, 'reserved_beds_count', bedPageCounts.reserved),
    cleaning: aggregateCount(
      ward,
      'cleaning_beds_count',
      bedPageCounts.cleaning,
    ),
    maintenance: aggregateCount(
      ward,
      ['blocked_beds_count', 'maintenance_beds_count'],
      bedPageCounts.maintenance,
    ),
  };
}

function buildWardStatsSource(ward, bedMap) {
  if (!bedMap?.totals) return ward;

  return {
    ...ward,
    total_beds: bedMap.totals.total_beds,
    available_beds_count: bedMap.totals.available_beds_count,
    occupied_beds_count: bedMap.totals.occupied_beds_count,
    reserved_beds_count: bedMap.totals.reserved_beds_count,
    cleaning_beds_count: bedMap.totals.cleaning_beds_count,
    maintenance_beds_count: bedMap.totals.maintenance_beds_count,
  };
}

function buildSectionStats(sections, beds) {
  if (!sections || sections.length === 0) return [];

  const bedsBySection = new Map();
  beds.forEach((bed) => {
    const current = bedsBySection.get(bed.section) || {
      totalBeds: 0,
      availableBeds: 0,
      occupiedBeds: 0,
      reservedBeds: 0,
      cleaningBeds: 0,
      maintenanceBeds: 0,
    };

    current.totalBeds += 1;
    const status = canonicalBedStatus(bed.status);
    if (status === 'available') current.availableBeds += 1;
    if (status === 'occupied') current.occupiedBeds += 1;
    if (status === 'reserved') current.reservedBeds += 1;
    if (status === 'cleaning') current.cleaningBeds += 1;
    if (status === 'maintenance') current.maintenanceBeds += 1;
    bedsBySection.set(bed.section, current);
  });

  return sections
    .toSorted((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .map((section) => {
      const {
        totalBeds = 0,
        availableBeds = 0,
        occupiedBeds = 0,
        reservedBeds = 0,
        cleaningBeds = 0,
        maintenanceBeds = 0,
      } = bedsBySection.get(section.id) || {};
      const aggregateTotalBeds = aggregateCount(section, 'bed_count', totalBeds);
      const aggregateAvailableBeds = aggregateCount(
        section,
        'available_beds_count',
        availableBeds,
      );
      const aggregateOccupiedBeds = aggregateCount(section, 'occupied_beds_count', occupiedBeds);
      const aggregateReservedBeds = aggregateCount(section, 'reserved_beds_count', reservedBeds);
      const aggregateCleaningBeds = aggregateCount(
        section,
        'cleaning_beds_count',
        cleaningBeds,
      );
      const aggregateMaintenanceBeds = aggregateCount(
        section,
        ['blocked_beds_count', 'maintenance_beds_count'],
        maintenanceBeds,
      );
      const occupancyRate = aggregateTotalBeds > 0
        ? Math.round((aggregateOccupiedBeds / aggregateTotalBeds) * 100)
        : 0;

      return {
        ...section,
        totalBeds: aggregateTotalBeds,
        availableBeds: aggregateAvailableBeds,
        occupiedBeds: aggregateOccupiedBeds,
        reservedBeds: aggregateReservedBeds,
        cleaningBeds: aggregateCleaningBeds,
        maintenanceBeds: aggregateMaintenanceBeds,
        occupancyRate,
      };
    });
}

function hasWardFilters(filters) {
  return filters.status !== 'all' || filters.searchTerm;
}

function WardDashboardLoadingState() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-28" />)}
      </div>
    </div>
  );
}

function WardDashboardErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Building2 className="size-12 text-muted-foreground mb-4" />
      <h2 className="text-xl font-display text-foreground mb-2">Unable to load ward</h2>
      <p className="text-muted-foreground text-sm mb-4">
        {error?.message || 'Please try again'}
      </p>
      <Button onClick={onRetry} variant="outline">
        <RefreshCw className="size-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}

function WardDashboardNotFoundState({ onBack }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Building2 className="size-12 text-muted-foreground mb-4" />
      <h2 className="text-xl font-display text-foreground">Ward not found</h2>
      <p className="text-muted-foreground text-sm mt-1">
        The requested ward could not be found
      </p>
      <Button className="mt-4" variant="outline" onClick={onBack}>
        Back to Wards
      </Button>
    </div>
  );
}

function WardDashboardHeader({ ward, onNewAdmission }) {
  return (
    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-display font-bold text-foreground">
            {ward.name}
          </h1>
          <span className={cn(
            "px-2.5 py-1 rounded-full text-xs font-mono",
            ward.is_active
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-muted text-muted-foreground"
          )}>
            {ward.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <p className="text-muted-foreground">
          {WARD_TYPE_LABELS[ward.ward_type] || ward.ward_type}
          {ward.description && ` — ${ward.description}`}
        </p>
      </div>
      <Button onClick={onNewAdmission} className="shrink-0">
        <UserPlus className="size-4 mr-2" />
        New Admission
      </Button>
    </div>
  );
}

function WardStatsGrid({ canFilterByStatus, filters, onFilterChange, stats }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard icon={Bed} label="Total Beds" value={stats.total} color="primary" />
      <StatCard
        icon={Activity}
        label="Vacant"
        value={stats.available}
        color="emerald"
        onClick={canFilterByStatus ? () => onFilterChange('status', stats.available > 0 ? 'available' : 'all') : undefined}
        active={canFilterByStatus && filters.status === 'available'}
      />
      <StatCard
        icon={Users}
        label="Occupied"
        value={stats.occupied}
        color="rose"
        onClick={canFilterByStatus ? () => onFilterChange('status', stats.occupied > 0 ? 'occupied' : 'all') : undefined}
        active={canFilterByStatus && filters.status === 'occupied'}
      />
      <StatCard
        label="Cleaning"
        value={stats.cleaning}
        color="amber"
        onClick={canFilterByStatus ? () => onFilterChange('status', stats.cleaning > 0 ? 'cleaning' : 'all') : undefined}
        active={canFilterByStatus && filters.status === 'cleaning'}
      />
      <StatCard
        label="Blocked"
        value={stats.maintenance}
        color="slate"
        onClick={canFilterByStatus ? () => onFilterChange('status', stats.maintenance > 0 ? 'maintenance' : 'all') : undefined}
        active={canFilterByStatus && filters.status === 'maintenance'}
      />
      <StatCard
        label="Reserved"
        value={stats.reserved}
        color="sky"
        onClick={canFilterByStatus ? () => onFilterChange('status', stats.reserved > 0 ? 'reserved' : 'all') : undefined}
        active={canFilterByStatus && filters.status === 'reserved'}
      />
    </div>
  );
}

function WardSectionOverview({ sectionStats }) {
  if (sectionStats.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Section Overview</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sectionStats.map((section) => (
          <SectionStatCard key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}

function WardFilterBar({
  canFilterByStatus,
  filters,
  hasActiveFilters,
  onClearFilters,
  onFilterChange,
  onViewModeChange,
  viewMode,
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/50 p-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
          <Label htmlFor="bed-search" className="sr-only">Search beds</Label>
          <Input
            id="bed-search"
            placeholder="Search beds..."
            className="pl-10 font-mono text-sm w-full sm:w-48"
            value={filters.searchTerm}
            onChange={(event) => onFilterChange('searchTerm', event.target.value)}
          />
        </div>

        <fieldset className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg bg-muted/50 p-1">
          <legend className="sr-only">Bed status filter</legend>
          {STATUS_FILTERS.map((status) => (
            <Button
              key={status.value}
              type="button"
              variant={filters.status === status.value ? 'secondary' : 'ghost'}
              size="sm"
              disabled={!canFilterByStatus && status.value !== 'all'}
              onClick={() => onFilterChange('status', status.value)}
              className="h-8 px-2.5 font-mono text-xs"
              aria-pressed={filters.status === status.value}
            >
              {status.label}
            </Button>
          ))}
        </fieldset>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-muted-foreground"
          >
            <Filter className="size-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      <fieldset className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg">
        <legend className="sr-only">View mode</legend>
        <Button
          variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('grid')}
          className="h-8 gap-1.5 px-2.5"
          aria-label="Bay map view"
          aria-pressed={viewMode === 'grid'}
        >
          <LayoutGrid className="size-4" aria-hidden="true" />
          <span className="hidden font-mono text-xs sm:inline">Bay Map</span>
        </Button>
        <Button
          variant={viewMode === 'list' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('list')}
          className="h-8 gap-1.5 px-2.5"
          aria-label="List view"
          aria-pressed={viewMode === 'list'}
        >
          <List className="size-4" aria-hidden="true" />
          <span className="hidden font-mono text-xs sm:inline">List</span>
        </Button>
      </fieldset>
    </div>
  );
}

function WardBedsContent({
  beds,
  filteredBeds,
  hasActiveFilters,
  onClearFilters,
  sections,
  viewMode,
  wardId,
}) {
  if (filteredBeds.length === 0) {
    return (
      <div className="text-center py-12">
        <Bed className="size-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-medium text-foreground">
          {beds.length > 0 ? 'No beds match your filters' : 'No beds configured'}
        </h3>
        <p className="text-muted-foreground text-sm mt-1">
          {beds.length > 0 ? 'Try adjusting your filters' : 'Add beds to this ward to get started'}
        </p>
        {hasActiveFilters && (
          <Button variant="outline" className="mt-4" onClick={onClearFilters}>
            Clear Filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <WardBedLayout
      beds={filteredBeds}
      sections={sections}
      wardId={wardId}
      viewMode={viewMode}
    />
  );
}

/**
 * WardDashboard - Chronicle-style ward detail view
 *
 * Features:
 * - Elegant header with ward info and quick stats
 * - Streamlined filtering with visual indicators
 * - Grid/List view toggle
 * - Beautiful bed visualization
 */
export function WardDashboard() {
  const { wardId } = useParams();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState('grid');
  const [filters, setFilters] = useState(EMPTY_WARD_FILTERS);

  // Fetch data with React Query
  const {
    data: ward,
    isLoading: isWardLoading,
    isError: isWardError,
    error: wardError,
    refetch: refetchWard
  } = useWard(wardId);

  const {
    data: bedMap,
    isLoading: isBedMapLoading,
    isError: isBedMapError,
    error: bedMapError,
    refetch: refetchBedMap,
  } = useWardBedMap(wardId);

  const beds = bedMap?.beds || EMPTY_BEDS;
  const sections = bedMap?.sections || EMPTY_SECTIONS;
  const isLoading = isWardLoading || isBedMapLoading;

  const filteredBeds = useMemo(() => filterBeds(beds, filters), [beds, filters]);
  const statsSource = useMemo(() => buildWardStatsSource(ward, bedMap), [ward, bedMap]);
  const stats = useMemo(() => buildWardStats(statsSource, beds), [statsSource, beds]);
  const sectionStats = useMemo(() => buildSectionStats(sections, beds), [sections, beds]);
  const canFilterByStatus = stats.total > 0 && beds.length >= stats.total;

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  // Handle new admission
  const handleNewAdmission = () => {
    navigate('/admissions/new', { state: { wardId } });
  };

  // Handle refresh
  const handleRefresh = () => {
    refetchWard();
    refetchBedMap();
  };

  // Clear filters
  const clearFilters = () => {
    setFilters(EMPTY_WARD_FILTERS);
  };

  const hasActiveFilters = hasWardFilters(filters);

  // Loading state
  if (isLoading) {
    return <WardDashboardLoadingState />;
  }

  // Error state
  if (isWardError || isBedMapError) {
    return <WardDashboardErrorState error={wardError || bedMapError} onRetry={handleRefresh} />;
  }

  if (!ward) {
    return <WardDashboardNotFoundState onBack={() => navigate('/wards')} />;
  }

  return (
    <div className="space-y-6">
      <WardDashboardHeader ward={ward} onNewAdmission={handleNewAdmission} />

      <WardStatsGrid
        canFilterByStatus={canFilterByStatus}
        filters={filters}
        onFilterChange={handleFilterChange}
        stats={stats}
      />

      <WardSectionOverview sectionStats={sectionStats} />

      <WardFilterBar
        canFilterByStatus={canFilterByStatus}
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        onFilterChange={handleFilterChange}
        onViewModeChange={setViewMode}
        viewMode={viewMode}
      />

      <WardBedsContent
        beds={beds}
        filteredBeds={filteredBeds}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        sections={sections}
        viewMode={viewMode}
        wardId={ward.id}
      />

      {filteredBeds.length > 0 && (
        <div className="text-center">
          <p className="font-mono text-xs text-muted-foreground">
            Showing {filteredBeds.length} of {stats.total} beds
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * StatCard - Clickable stat card for quick filtering
 */
function StatCard({ icon: Icon, label, value, color = 'primary', onClick, active }) {
  const colors = STAT_CARD_COLOR_CLASSES[color];

  const CardElement = onClick ? 'button' : 'div';
  const interactiveProps = onClick
    ? {
        type: 'button',
        onClick,
        'aria-pressed': active,
        'aria-label': `Filter by ${label}: ${value}`,
      }
    : {};

  return (
    <CardElement
      {...interactiveProps}
      className={cn(
        "rounded-xl p-4 border border-border/50 transition-all text-left",
        onClick && "w-full bg-transparent",
        onClick && "cursor-pointer hover:border-border hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active && colors.active
      )}
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={cn("p-2 rounded-lg", colors.bg)}>
            <Icon className={cn("size-4", colors.icon)} aria-hidden="true" />
          </div>
        )}
        <div>
          <p className={cn("font-mono text-xl font-bold", colors.text)}>{value}</p>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
        </div>
      </div>
    </CardElement>
  );
}

/**
 * SectionStatCard - Section statistics card
 */
function SectionStatCard({ section }) {
  return (
    <div className="rounded-xl p-4 border border-border/50 bg-card/50 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {getSectionTierIcon(section.accommodation_tier)}
          <h4 className="font-semibold text-sm text-foreground truncate">
            {section.name}
          </h4>
        </div>
        {section.accommodation_tier && (
          <Badge
            variant="outline"
            className={cn('text-xs shrink-0', getSectionTierColor(section.accommodation_tier))}
          >
            {section.accommodation_tier.replace('_', ' ')}
          </Badge>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="font-mono text-xs text-muted-foreground">Beds</p>
          <p className="font-mono text-lg font-bold text-foreground">
            {section.availableBeds}/{section.totalBeds}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">available</p>
        </div>

        <div className="text-right space-y-1">
          <p className="font-mono text-xs text-muted-foreground">Occupancy</p>
          <p className={cn(
            "font-mono text-lg font-bold",
            getSectionOccupancyColor(section.occupancyRate)
          )}>
            {section.occupancyRate}%
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {section.occupiedBeds} occupied
          </p>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        {section.gender_restriction === 'male_only' && (
          <Badge variant="outline" className="text-xs text-sky-700 bg-sky-50 border-sky-200">
            Male Only
          </Badge>
        )}
        {section.gender_restriction === 'female_only' && (
          <Badge variant="outline" className="text-xs text-rose-700 bg-rose-50 border-rose-200">
            Female Only
          </Badge>
        )}
        {section.is_isolation_capable && (
          <Badge variant="outline" className="text-xs">
            <Shield className="size-3 mr-1" />
            Isolation
          </Badge>
        )}
      </div>
    </div>
  );
}
