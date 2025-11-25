import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Bed,
  Users,
  Activity,
  UserPlus,
  Filter,
  LayoutGrid,
  List,
  RefreshCw,
  Building2
} from 'lucide-react';
import { useWard, useWardBeds, useAdmissions } from '@/hooks/useWardQueries';
import { WardBedLayout } from './WardBedLayout';

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
  const [filters, setFilters] = useState({
    status: 'all',
    bedType: 'all',
    searchTerm: '',
  });

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
  } = useAdmissions({ ward: wardId });

  const isLoading = isWardLoading || isBedsLoading || isAdmissionsLoading;

  // Filter beds
  const filteredBeds = useMemo(() => {
    return beds.filter(bed => {
      if (filters.status !== 'all' && bed.status !== filters.status) return false;
      if (filters.bedType !== 'all' && bed.bed_type !== filters.bedType) return false;
      if (filters.searchTerm && !bed.bed_number.toLowerCase().includes(filters.searchTerm.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [beds, filters]);

  // Calculate quick stats
  const stats = useMemo(() => {
    const total = beds.length;
    const available = beds.filter(b => b.status === 'available').length;
    const occupied = beds.filter(b => b.status === 'occupied').length;
    const reserved = beds.filter(b => b.status === 'reserved').length;
    const maintenance = beds.filter(b => b.status === 'maintenance').length;

    return { total, available, occupied, reserved, maintenance };
  }, [beds]);

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  // Handle bed click
  const handleBedClick = (bedId) => {
    const activeAdmission = admissions.find(
      admission => admission.bed?.id === bedId && admission.status === 'admitted'
    );

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
    setFilters({ status: 'all', bedType: 'all', searchTerm: '' });
  };

  const hasActiveFilters = filters.status !== 'all' || filters.bedType !== 'all' || filters.searchTerm;

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  // Error state
  if (isWardError || isBedsError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-display text-foreground mb-2">Unable to load ward</h2>
        <p className="text-muted-foreground text-sm mb-4">
          {wardError?.message || 'Please try again'}
        </p>
        <Button onClick={handleRefresh} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  if (!ward) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-display text-foreground">Ward not found</h2>
        <p className="text-muted-foreground text-sm mt-1">
          The requested ward could not be found
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/wards')}>
          Back to Wards
        </Button>
      </div>
    );
  }

  // Ward type labels
  const wardTypeLabels = {
    'general': 'General Ward',
    'private': 'Private Ward',
    'icu': 'Intensive Care Unit',
    'emergency': 'Emergency Ward',
    'maternity': 'Maternity Ward',
    'pediatric': 'Pediatric Ward',
    'psychiatric': 'Psychiatric Ward',
    'isolation': 'Isolation Ward',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
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
            {wardTypeLabels[ward.ward_type] || ward.ward_type}
            {ward.description && ` — ${ward.description}`}
          </p>
        </div>
        <Button onClick={handleNewAdmission} className="shrink-0">
          <UserPlus className="h-4 w-4 mr-2" />
          New Admission
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          icon={Bed}
          label="Total Beds"
          value={stats.total}
          color="primary"
        />
        <StatCard
          icon={Activity}
          label="Available"
          value={stats.available}
          color="emerald"
          onClick={() => handleFilterChange('status', stats.available > 0 ? 'available' : 'all')}
          active={filters.status === 'available'}
        />
        <StatCard
          icon={Users}
          label="Occupied"
          value={stats.occupied}
          color="rose"
          onClick={() => handleFilterChange('status', stats.occupied > 0 ? 'occupied' : 'all')}
          active={filters.status === 'occupied'}
        />
        <StatCard
          label="Reserved"
          value={stats.reserved}
          color="amber"
          onClick={() => handleFilterChange('status', stats.reserved > 0 ? 'reserved' : 'all')}
          active={filters.status === 'reserved'}
        />
        <StatCard
          label="Maintenance"
          value={stats.maintenance}
          color="slate"
          onClick={() => handleFilterChange('status', stats.maintenance > 0 ? 'maintenance' : 'all')}
          active={filters.status === 'maintenance'}
        />
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between bg-card/50 rounded-xl p-4 border border-border/50">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          {/* Search */}
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search beds..."
              className="pl-10 font-mono text-sm w-full sm:w-48"
              value={filters.searchTerm}
              onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
            />
          </div>

          {/* Bed Type Filter */}
          <Select
            value={filters.bedType}
            onValueChange={(value) => handleFilterChange('bedType', value)}
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

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground"
            >
              <Filter className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg">
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            className="h-8 w-8 p-0"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            className="h-8 w-8 p-0"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Beds Display */}
      {filteredBeds.length === 0 ? (
        <div className="text-center py-12">
          <Bed className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground">
            {beds.length > 0 ? 'No beds match your filters' : 'No beds configured'}
          </h3>
          <p className="text-muted-foreground text-sm mt-1">
            {beds.length > 0 ? 'Try adjusting your filters' : 'Add beds to this ward to get started'}
          </p>
          {hasActiveFilters && (
            <Button variant="outline" className="mt-4" onClick={clearFilters}>
              Clear Filters
            </Button>
          )}
        </div>
      ) : (
        <WardBedLayout
          beds={filteredBeds}
          admissions={admissions}
          onBedClick={handleBedClick}
          wardId={ward.id}
          viewMode={viewMode}
        />
      )}

      {/* Results count */}
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

  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl p-4 border border-border/50 transition-all",
        onClick && "cursor-pointer hover:border-border hover:shadow-sm",
        active && colors.active
      )}
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={cn("p-2 rounded-lg", colors.bg)}>
            <Icon className={cn("h-4 w-4", colors.icon)} />
          </div>
        )}
        <div>
          <p className={cn("font-mono text-xl font-bold", colors.text)}>{value}</p>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}
