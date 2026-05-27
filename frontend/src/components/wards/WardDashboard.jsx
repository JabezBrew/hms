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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useWard, useWardBeds, useAdmissions, useWardSections } from '@/features/wards/hooks/useWardQueries';
import { WardBedLayout } from './WardBedLayout';

const EMPTY_WARD_FILTERS = {
  status: 'all',
  bedType: 'all',
  searchTerm: '',
};

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

function filterBeds(beds, filters) {
  const normalizedSearch = filters.searchTerm.toLowerCase();

  return beds.filter((bed) => {
    if (filters.status !== 'all' && bed.status !== filters.status) return false;
    if (filters.bedType !== 'all' && bed.bed_type !== filters.bedType) return false;
    if (normalizedSearch && !bed.bed_number.toLowerCase().includes(normalizedSearch)) {
      return false;
    }
    return true;
  });
}

function buildWardStats(beds) {
  return beds.reduce(
    (acc, bed) => {
      acc.total += 1;
      if (bed.status === 'available') acc.available += 1;
      if (bed.status === 'occupied') acc.occupied += 1;
      if (bed.status === 'reserved') acc.reserved += 1;
      if (bed.status === 'maintenance') acc.maintenance += 1;
      return acc;
    },
    { total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0 },
  );
}

function buildSectionStats(sections, beds) {
  if (!sections || sections.length === 0) return [];

  const bedsBySection = new Map();
  beds.forEach((bed) => {
    const current = bedsBySection.get(bed.section) || {
      totalBeds: 0,
      availableBeds: 0,
      occupiedBeds: 0,
    };

    current.totalBeds += 1;
    if (bed.status === 'available') current.availableBeds += 1;
    if (bed.status === 'occupied') current.occupiedBeds += 1;
    bedsBySection.set(bed.section, current);
  });

  return sections
    .toSorted((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .map((section) => {
      const {
        totalBeds = 0,
        availableBeds = 0,
        occupiedBeds = 0,
      } = bedsBySection.get(section.id) || {};
      const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

      return {
        ...section,
        totalBeds,
        availableBeds,
        occupiedBeds,
        occupancyRate,
      };
    });
}

function findActiveAdmissionByBedId(admissions, bedId) {
  return admissions.find((admission) => {
    const admissionBedId = admission?.bed?.id || admission?.bed;
    return admissionBedId === bedId && admission.status === 'admitted';
  });
}

function hasWardFilters(filters) {
  return filters.status !== 'all' || filters.bedType !== 'all' || filters.searchTerm;
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

function WardStatsGrid({ filters, onFilterChange, stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <StatCard icon={Bed} label="Total Beds" value={stats.total} color="primary" />
      <StatCard
        icon={Activity}
        label="Available"
        value={stats.available}
        color="emerald"
        onClick={() => onFilterChange('status', stats.available > 0 ? 'available' : 'all')}
        active={filters.status === 'available'}
      />
      <StatCard
        icon={Users}
        label="Occupied"
        value={stats.occupied}
        color="rose"
        onClick={() => onFilterChange('status', stats.occupied > 0 ? 'occupied' : 'all')}
        active={filters.status === 'occupied'}
      />
      <StatCard
        label="Reserved"
        value={stats.reserved}
        color="amber"
        onClick={() => onFilterChange('status', stats.reserved > 0 ? 'reserved' : 'all')}
        active={filters.status === 'reserved'}
      />
      <StatCard
        label="Maintenance"
        value={stats.maintenance}
        color="slate"
        onClick={() => onFilterChange('status', stats.maintenance > 0 ? 'maintenance' : 'all')}
        active={filters.status === 'maintenance'}
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
  filters,
  hasActiveFilters,
  onClearFilters,
  onFilterChange,
  onViewModeChange,
  viewMode,
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between bg-card/50 rounded-xl p-4 border border-border/50">
      <div className="flex flex-wrap gap-3 items-center flex-1">
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

        <Select
          value={filters.bedType}
          onValueChange={(value) => onFilterChange('bedType', value)}
        >
          <SelectTrigger className="w-full sm:w-40 font-mono text-sm">
            <SelectValue placeholder="Bed Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="icu">ICU</SelectItem>
            <SelectItem value="pediatric">Pediatric</SelectItem>
            <SelectItem value="bariatric">Bariatric</SelectItem>
            <SelectItem value="maternity">Maternity</SelectItem>
          </SelectContent>
        </Select>

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
          className="size-8 p-0"
          aria-label="Grid view"
          aria-pressed={viewMode === 'grid'}
        >
          <LayoutGrid className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant={viewMode === 'list' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('list')}
          className="size-8 p-0"
          aria-label="List view"
          aria-pressed={viewMode === 'list'}
        >
          <List className="size-4" aria-hidden="true" />
        </Button>
      </fieldset>
    </div>
  );
}

function WardBedsContent({
  admissions,
  beds,
  filteredBeds,
  hasActiveFilters,
  onBedClick,
  onClearFilters,
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
      admissions={admissions}
      onBedClick={onBedClick}
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
    data: beds = [],
    isLoading: isBedsLoading,
    isError: isBedsError,
    refetch: refetchBeds
  } = useWardBeds(wardId);

  const {
    data: admissions = [],
    isLoading: isAdmissionsLoading
  } = useAdmissions({
    ward: wardId,
    status: 'admitted',
    page_size: 200,
  });

  const {
    data: sections = [],
    isLoading: isSectionsLoading
  } = useWardSections(wardId, {
    enabled: !!wardId,
  });

  const isLoading = isWardLoading || isBedsLoading || isAdmissionsLoading || isSectionsLoading;

  const filteredBeds = useMemo(() => filterBeds(beds, filters), [beds, filters]);
  const stats = useMemo(() => buildWardStats(beds), [beds]);
  const sectionStats = useMemo(() => buildSectionStats(sections, beds), [sections, beds]);

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  // Handle bed click
  const handleBedClick = (bedId) => {
    const activeAdmission = findActiveAdmissionByBedId(admissions, bedId);

    if (activeAdmission) {
      navigate(`/admissions/${activeAdmission.id}`);
    } else {
      navigate(`/beds/${bedId}`);
    }
  };

  // Handle new admission
  const handleNewAdmission = () => {
    navigate('/admissions/new', { state: { wardId } });
  };

  // Handle refresh
  const handleRefresh = () => {
    refetchWard();
    refetchBeds();
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
  if (isWardError || isBedsError) {
    return <WardDashboardErrorState error={wardError} onRetry={handleRefresh} />;
  }

  if (!ward) {
    return <WardDashboardNotFoundState onBack={() => navigate('/wards')} />;
  }

  return (
    <div className="space-y-6">
      <WardDashboardHeader ward={ward} onNewAdmission={handleNewAdmission} />

      <WardStatsGrid
        filters={filters}
        onFilterChange={handleFilterChange}
        stats={stats}
      />

      <WardSectionOverview sectionStats={sectionStats} />

      <WardFilterBar
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        onFilterChange={handleFilterChange}
        onViewModeChange={setViewMode}
        viewMode={viewMode}
      />

      <WardBedsContent
        admissions={admissions}
        beds={beds}
        filteredBeds={filteredBeds}
        hasActiveFilters={hasActiveFilters}
        onBedClick={handleBedClick}
        onClearFilters={clearFilters}
        viewMode={viewMode}
        wardId={ward.id}
      />

      {filteredBeds.length > 0 && (
        <div className="text-center">
          <p className="font-mono text-xs text-muted-foreground">
            Showing {filteredBeds.length} of {beds.length} beds
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
  const colorClasses = {
    primary: {
      bg: 'bg-primary/10',
      text: 'text-primary',
      icon: 'text-primary',
      active: 'ring-2 ring-primary'
    },
    emerald: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-600',
      icon: 'text-emerald-600',
      active: 'ring-2 ring-emerald-500'
    },
    rose: {
      bg: 'bg-rose-500/10',
      text: 'text-rose-600',
      icon: 'text-rose-600',
      active: 'ring-2 ring-rose-500'
    },
    amber: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-600',
      icon: 'text-amber-600',
      active: 'ring-2 ring-amber-500'
    },
    slate: {
      bg: 'bg-slate-500/10',
      text: 'text-slate-600',
      icon: 'text-slate-600',
      active: 'ring-2 ring-slate-500'
    },
  };

  const colors = colorClasses[color];

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
  // Get icon for accommodation tier
  const getTierIcon = (tier) => {
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

  // Get occupancy color
  const getOccupancyColor = (rate) => {
    if (rate >= 90) return 'text-rose-600';
    if (rate >= 70) return 'text-amber-600';
    return 'text-emerald-600';
  };

  return (
    <div className="rounded-xl p-4 border border-border/50 bg-card/50 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {getTierIcon(section.accommodation_tier)}
          <h4 className="font-semibold text-sm text-foreground truncate">
            {section.name}
          </h4>
        </div>
        <Badge
          variant="outline"
          className={cn('text-xs shrink-0', getTierColor(section.accommodation_tier))}
        >
          {section.accommodation_tier?.replace('_', ' ')}
        </Badge>
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
            getOccupancyColor(section.occupancyRate)
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
