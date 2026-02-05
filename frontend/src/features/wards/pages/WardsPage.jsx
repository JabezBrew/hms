import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { getAuthJSON } from '@/lib/auth-storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import VirtualizedGrid from '@/components/ui/VirtualizedGrid';

import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useWards } from '@/features/wards/hooks/useWardQueries';
import { useListFilters } from '@/shared/hooks/useListFilters';

/**
 * WardsPage - Chronicle-style ward management dashboard
 *
 * Features:
 * - Hero section with aggregate statistics
 * - Visual ward cards with occupancy indicators
 * - Quick actions and search
 */
export default function WardsPage() {
  const navigate = useNavigate();
  const { search, updateSearch } = useListFilters();
  const [isAdmin, setIsAdmin] = useState(false);

  const {
    data: wards = [],
    isLoading,
    isError,
    error,
    refetch
  } = useWards();

  const pageMeta = usePageMeta({
    title: 'Wards | Hospital Management System',
    breadcrumbs: [{ label: 'Wards', path: '/wards' }],
  });

  useEffect(() => {
    const user = getAuthJSON('user');
    setIsAdmin(user?.role === 'admin');
  }, []);

  // Calculate aggregate statistics
  const stats = useMemo(() => {
    if (!wards.length) return { total: 0, totalBeds: 0, occupied: 0, available: 0, avgOccupancy: 0 };

    const totalBeds = wards.reduce((sum, w) => sum + (w.total_beds || 0), 0);
    const availableBeds = wards.reduce((sum, w) => sum + (w.available_beds_count || 0), 0);
    const occupiedBeds = totalBeds - availableBeds;
    const avgOccupancy = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

    return {
      total: wards.length,
      totalBeds,
      occupied: occupiedBeds,
      available: availableBeds,
      avgOccupancy: avgOccupancy.toFixed(1)
    };
  }, [wards]);

  // Filter wards
  const filteredWards = useMemo(() => {
    if (!search) return wards;
    const term = search.toLowerCase();
    return wards.filter(ward =>
      ward.name.toLowerCase().includes(term) ||
      ward.description?.toLowerCase().includes(term) ||
      ward.ward_type?.toLowerCase().includes(term)
    );
  }, [wards, search]);

  // Ward type display names
  const wardTypeLabels = {
    'general': 'General',
    'private': 'Private',
    'icu': 'ICU',
    'emergency': 'Emergency',
    'maternity': 'Maternity',
    'pediatric': 'Pediatric',
    'psychiatric': 'Psychiatric',
    'isolation': 'Isolation',
  };

  // Occupancy color based on rate
  const getOccupancyStyle = (rate) => {
    if (rate < 60) return { color: 'text-emerald-600', bg: 'bg-emerald-500', label: 'Low' };
    if (rate < 85) return { color: 'text-amber-600', bg: 'bg-amber-500', label: 'Moderate' };
    return { color: 'text-rose-600', bg: 'bg-rose-500', label: 'High' };
  };

  // Loading state
  if (isLoading) {
    return (
      <PageState variant="loading">
        {pageMeta}
        <div className="bg-card border-b border-border px-6 py-8">
          <Skeleton className="h-8 w-48 mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48" />)}
          </div>
        </div>
      </PageState>
    );
  }

  // Error state
  if (isError) {
    return (
      <PageState
        variant="error"
        title="Unable to load wards"
        description={error?.message || 'Please try again'}
        action={() => refetch()}
        icon={Building2}
      />
    );
  }

  return (
    <PageShell>
      {pageMeta}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <PageHeader
            title="Ward Management"
            description="Monitor bed availability and patient flow across all wards"
            wrap={false}
            className="border-none bg-transparent p-0"
            titleClassName="text-3xl"
            actions={(
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => refetch()}
                  title="Refresh wards"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => navigate('/wards/reports')}>
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Reports
                </Button>
                {isAdmin && (
                  <Button onClick={() => navigate('/wards/new')}>
                    <Plus className="h-4 w-4 mr-2" />
                    New Ward
                  </Button>
                )}
              </div>
            )}
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-mono text-2xl font-bold text-foreground">{stats.total}</p>
                  <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Wards</p>
                </div>
              </div>
            </div>

            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-sky-500/10">
                  <Bed className="h-5 w-5 text-sky-600" />
                </div>
                <div>
                  <p className="font-mono text-2xl font-bold text-foreground">{stats.totalBeds}</p>
                  <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Total Beds</p>
                </div>
              </div>
            </div>

            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <Activity className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-mono text-2xl font-bold text-emerald-600">{stats.available}</p>
                  <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Available</p>
                </div>
              </div>
            </div>

            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-rose-500/10">
                  <Users className="h-5 w-5 text-rose-600" />
                </div>
                <div>
                  <p className="font-mono text-2xl font-bold text-foreground">{stats.avgOccupancy}%</p>
                  <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Occupancy</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search wards..."
              className="pl-10 font-mono text-sm"
              value={search}
              onChange={(e) => updateSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Wards Grid */}
        {filteredWards.length === 0 ? (
          <div className="text-center py-16">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground">
              {wards.length > 0 ? 'No wards match your search' : 'No wards yet'}
            </h3>
            <p className="text-muted-foreground text-sm mt-1">
              {wards.length > 0 ? 'Try adjusting your search term' : 'Create your first ward to get started'}
            </p>
            {wards.length === 0 && isAdmin && (
              <Button className="mt-4" onClick={() => navigate('/wards/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Create Ward
              </Button>
            )}
          </div>
        ) : (
          <VirtualizedGrid
            items={filteredWards}
            minItemWidth={280}
            rowHeight={280}
            gap={24}
            getItemKey={(ward) => ward.id}
            renderItem={(ward) => {
              const occupancyStyle = getOccupancyStyle(ward.occupancy_rate);
              const availableBeds = ward.available_beds_count || 0;
              const occupiedBeds = (ward.total_beds || 0) - availableBeds;

              return (
                <article
                  onClick={() => navigate(`/wards/${ward.id}`)}
                  className={cn(
                    "group relative bg-card rounded-xl border border-border/50 p-6",
                    "hover:border-border hover:shadow-lg transition-all duration-200 cursor-pointer"
                  )}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                        {ward.name}
                      </h3>
                      <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
                        {wardTypeLabels[ward.ward_type] || ward.ward_type}
                      </p>
                    </div>
                    <div className={cn(
                      "px-2 py-1 rounded-full text-xs font-mono",
                      ward.is_active
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {ward.is_active ? 'Active' : 'Inactive'}
                    </div>
                  </div>

                  {ward.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                      {ward.description}
                    </p>
                  )}

                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">Occupancy</span>
                      <span className={cn("font-mono font-medium", occupancyStyle.color)}>
                        {ward.occupancy_rate?.toFixed(0) || 0}%
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", occupancyStyle.bg)}
                        style={{ width: `${Math.min(ward.occupancy_rate || 0, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-border/50">
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <p className="font-mono text-lg font-bold text-foreground">{ward.total_beds || 0}</p>
                        <p className="text-xs text-muted-foreground">Total</p>
                      </div>
                      <div className="text-center">
                        <p className="font-mono text-lg font-bold text-emerald-600">{availableBeds}</p>
                        <p className="text-xs text-muted-foreground">Available</p>
                      </div>
                      <div className="text-center">
                        <p className="font-mono text-lg font-bold text-rose-600">{occupiedBeds}</p>
                        <p className="text-xs text-muted-foreground">Occupied</p>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </article>
              );
            }}
          />
        )}
      </div>
    </PageShell>
  );
}
