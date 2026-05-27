import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { getAuthJSON } from '@/lib/auth-storage';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import VirtualizedTable from '@/components/ui/VirtualizedTable';

import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useWards } from '@/features/wards/hooks/useWardQueries';
import { useListFilters } from '@/shared/hooks/useListFilters';

const WARD_TYPE_LABELS = {
  general: 'General',
  private: 'Private',
  icu: 'ICU',
  emergency: 'Emergency',
  maternity: 'Maternity',
  pediatric: 'Pediatric',
  psychiatric: 'Psychiatric',
  isolation: 'Isolation',
};

const EMPTY_WARD_STATS = {
  total: 0,
  totalBeds: 0,
  occupied: 0,
  available: 0,
  avgOccupancy: '0.0',
};

function getOccupancyStyle(rate) {
  if (rate < 60) return { color: 'text-emerald-600', bg: 'bg-emerald-500', label: 'Low' };
  if (rate < 85) return { color: 'text-amber-600', bg: 'bg-amber-500', label: 'Moderate' };
  return { color: 'text-rose-600', bg: 'bg-rose-500', label: 'High' };
}

function calculateWardStats(wards) {
  if (!wards.length) return EMPTY_WARD_STATS;

  const totals = wards.reduce((acc, ward) => {
    const totalBeds = ward.total_beds || 0;
    const availableBeds = ward.available_beds_count || 0;

    acc.totalBeds += totalBeds;
    acc.available += availableBeds;
    return acc;
  }, { totalBeds: 0, available: 0 });

  const occupied = totals.totalBeds - totals.available;
  const avgOccupancy = totals.totalBeds > 0 ? (occupied / totals.totalBeds) * 100 : 0;

  return {
    total: wards.length,
    totalBeds: totals.totalBeds,
    occupied,
    available: totals.available,
    avgOccupancy: avgOccupancy.toFixed(1),
  };
}

function filterWardsBySearch(wards, search) {
  if (!search) return wards;

  const term = search.toLowerCase();
  return wards.filter(ward =>
    ward.name.toLowerCase().includes(term) ||
    ward.description?.toLowerCase().includes(term) ||
    ward.ward_type?.toLowerCase().includes(term)
  );
}

const WARD_COLUMNS = [
  {
    key: 'ward',
    header: 'Ward',
    width: '260px',
    render: (ward) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{ward.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {ward.description || 'No description'}
        </p>
      </div>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    width: '140px',
    render: (ward) => (
      <Badge variant="outline" className="text-xs">
        {WARD_TYPE_LABELS[ward.ward_type] || ward.ward_type || 'Ward'}
      </Badge>
    ),
  },
  {
    key: 'beds',
    header: 'Beds',
    width: '100px',
    headerClassName: 'text-center',
    cellClassName: 'text-center font-mono text-sm',
    render: (ward) => ward.total_beds || 0,
  },
  {
    key: 'available',
    header: 'Available',
    width: '120px',
    headerClassName: 'text-center',
    cellClassName: 'text-center font-mono text-sm text-emerald-600',
    render: (ward) => ward.available_beds_count || 0,
  },
  {
    key: 'occupied',
    header: 'Occupied',
    width: '120px',
    headerClassName: 'text-center',
    cellClassName: 'text-center font-mono text-sm text-rose-600',
    render: (ward) => (ward.total_beds || 0) - (ward.available_beds_count || 0),
  },
  {
    key: 'occupancy',
    header: 'Occupancy',
    width: '160px',
    render: (ward) => {
      const occupancyStyle = getOccupancyStyle(ward.occupancy_rate || 0);
      return (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className={cn('font-mono', occupancyStyle.color)}>
              {(ward.occupancy_rate || 0).toFixed(0)}%
            </span>
            <span className="text-muted-foreground">{occupancyStyle.label}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className={cn('h-2 rounded-full', occupancyStyle.bg)}
              style={{ width: `${Math.min(ward.occupancy_rate || 0, 100)}%` }}
            />
          </div>
        </div>
      );
    },
  },
  {
    key: 'status',
    header: 'Status',
    width: '120px',
    render: (ward) => (
      <Badge
        variant="outline"
        className={cn(
          'text-xs',
          ward.is_active
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-border text-muted-foreground'
        )}
      >
        {ward.is_active ? 'Active' : 'Inactive'}
      </Badge>
    ),
  },
];

function WardsLoadingState({ pageMeta }) {
  return (
    <PageState variant="loading">
      {pageMeta}
      <div className="bg-card border-b border-border px-6 py-8">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {[1, 2, 3, 4].map((key) => <Skeleton key={key} className="h-24" />)}
        </div>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((key) => <Skeleton key={key} className="h-48" />)}
        </div>
      </div>
    </PageState>
  );
}

function WardsPageActions({ isAdmin, onRefresh, onOpenReports, onCreateWard }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={onRefresh}
        title="Refresh wards"
      >
        <RefreshCw className="size-4" />
      </Button>
      <Button variant="outline" onClick={onOpenReports}>
        <BarChart3 className="size-4 mr-2" />
        Reports
      </Button>
      {isAdmin && (
        <Button onClick={onCreateWard}>
          <Plus className="size-4 mr-2" />
          New Ward
        </Button>
      )}
    </div>
  );
}

function WardStatCard({ icon: Icon, value, label, iconClassName, valueClassName }) {
  return (
    <div className="bg-background/50 rounded-xl p-4 border border-border/50">
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', iconClassName)}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className={cn('font-mono text-2xl font-bold text-foreground', valueClassName)}>
            {value}
          </p>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        </div>
      </div>
    </div>
  );
}

function WardStatsGrid({ stats }) {
  return (
    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
      <WardStatCard
        icon={Building2}
        value={stats.total}
        label="Wards"
        iconClassName="bg-primary/10 text-primary"
      />
      <WardStatCard
        icon={Bed}
        value={stats.totalBeds}
        label="Total Beds"
        iconClassName="bg-sky-500/10 text-sky-600"
      />
      <WardStatCard
        icon={Activity}
        value={stats.available}
        label="Available"
        iconClassName="bg-emerald-500/10 text-emerald-600"
        valueClassName="text-emerald-600"
      />
      <WardStatCard
        icon={Users}
        value={`${stats.avgOccupancy}%`}
        label="Occupancy"
        iconClassName="bg-rose-500/10 text-rose-600"
      />
    </div>
  );
}

function WardsHero({ stats, isAdmin, onRefresh, onOpenReports, onCreateWard }) {
  return (
    <div className="bg-card border-b border-border">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <PageHeader
          title="Ward Management"
          description="Monitor bed availability and patient flow across all wards"
          wrap={false}
          className="border-none bg-transparent p-0"
          titleClassName="text-3xl"
          actions={(
            <WardsPageActions
              isAdmin={isAdmin}
              onRefresh={onRefresh}
              onOpenReports={onOpenReports}
              onCreateWard={onCreateWard}
            />
          )}
        />
        <WardStatsGrid stats={stats} />
      </div>
    </div>
  );
}

function WardsSearch({ search, onSearchChange }) {
  return (
    <div className="mb-6">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search wards..."
          className="pl-10 font-mono text-sm"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
    </div>
  );
}

function EmptyWardsState({ hasWards, isAdmin, onCreateWard }) {
  return (
    <div className="text-center py-16">
      <Building2 className="size-12 text-muted-foreground mx-auto mb-4" />
      <h3 className="text-lg font-medium text-foreground">
        {hasWards ? 'No wards match your search' : 'No wards yet'}
      </h3>
      <p className="text-muted-foreground text-sm mt-1">
        {hasWards ? 'Try adjusting your search term' : 'Create your first ward to get started'}
      </p>
      {!hasWards && isAdmin && (
        <Button className="mt-4" onClick={onCreateWard}>
          <Plus className="size-4 mr-2" />
          Create Ward
        </Button>
      )}
    </div>
  );
}

function WardsTable({ wards, onOpenWard }) {
  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={wards}
        rowKey={(ward) => ward.id}
        rowHeight={72}
        columns={WARD_COLUMNS}
        onRowClick={onOpenWard}
        rowClassName="hover:bg-muted/30"
        className="min-w-[1120px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

function WardsContent({ search, onSearchChange, wards, filteredWards, isAdmin, onCreateWard, onOpenWard }) {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <WardsSearch search={search} onSearchChange={onSearchChange} />

      {filteredWards.length === 0 ? (
        <EmptyWardsState
          hasWards={wards.length > 0}
          isAdmin={isAdmin}
          onCreateWard={onCreateWard}
        />
      ) : (
        <WardsTable wards={filteredWards} onOpenWard={onOpenWard} />
      )}
    </div>
  );
}

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
  const [isAdmin] = useState(() => getAuthJSON('user')?.role === 'admin');

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

  const stats = useMemo(() => calculateWardStats(wards), [wards]);
  const filteredWards = useMemo(() => filterWardsBySearch(wards, search), [wards, search]);

  const handleRefresh = () => refetch();
  const handleOpenReports = () => navigate('/wards/reports');
  const handleCreateWard = () => navigate('/wards/new');
  const handleOpenWard = (ward) => navigate(`/wards/${ward.id}`);

  if (isLoading) {
    return <WardsLoadingState pageMeta={pageMeta} />;
  }

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
      <WardsHero
        stats={stats}
        isAdmin={isAdmin}
        onRefresh={handleRefresh}
        onOpenReports={handleOpenReports}
        onCreateWard={handleCreateWard}
      />
      <WardsContent
        search={search}
        onSearchChange={updateSearch}
        wards={wards}
        filteredWards={filteredWards}
        isAdmin={isAdmin}
        onCreateWard={handleCreateWard}
        onOpenWard={handleOpenWard}
      />
    </PageShell>
  );
}
