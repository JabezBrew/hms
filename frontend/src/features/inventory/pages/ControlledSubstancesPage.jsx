import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useControlledRegisters, useStorageLocations } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { format, parseISO, differenceInDays } from 'date-fns';
import Search from 'lucide-react/dist/esm/icons/search.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';

const VIEW_TABS = [
  { value: 'all', label: 'All Registers' },
  { value: 'discrepancies', label: 'Discrepancies' },
  { value: 'audit_due', label: 'Audit Due' },
];

function useControlledSubstanceFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const tab = searchParams.get('tab') || 'all';
  const location = searchParams.get('location') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      } else {
        params.delete('search');
      }
      params.set('page', '1');
      return params;
    });
  }, [debouncedSearch, setSearchParams]);

  const handleTabChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value !== 'all') params.set('tab', value);
      else params.delete('tab');
      params.set('page', '1');
      return params;
    });
  };

  const handleLocationChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') params.set('location', value);
      else params.delete('location');
      params.set('page', '1');
      return params;
    });
  };

  const handlePageChange = (newPage) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('page', newPage.toString());
      return params;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setSearchParams({});
  };

  const queryParams = useMemo(() => ({
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(tab === 'discrepancies' && { has_discrepancy: true }),
    ...(tab === 'audit_due' && { audit_due: true }),
    ...(location && { location }),
  }), [debouncedSearch, location, page, tab]);

  return {
    search,
    tab,
    location,
    page,
    queryParams,
    hasActiveFilters: Boolean(debouncedSearch || tab !== 'all' || location),
    handleSearchChange: (event) => setSearch(event.target.value),
    handleTabChange,
    handleLocationChange,
    handlePageChange,
    clearFilters,
  };
}

function ControlledSubstancesLoadingState() {
  return (
    <PageState variant="loading" fullHeight={false} className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 max-w-md" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-card/30 border border-border/50 rounded-lg p-4">
            <Skeleton className="h-5 w-20 mb-3" />
            <Skeleton className="h-6 w-3/4 mb-2" />
            <Skeleton className="h-4 w-1/2 mb-3" />
            <div className="flex justify-between pt-3 border-t">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          </div>
        ))}
      </div>
    </PageState>
  );
}

function ControlledSubstancesHeader({ totalCount, isLoading, onRefresh }) {
  return (
    <PageHeader
      title="Controlled Substances"
      description={`${totalCount} register${totalCount !== 1 ? 's' : ''}`}
      actions={(
        <Button variant="outline" onClick={onRefresh}>
          <RefreshCw className={cn('size-4 mr-2', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      )}
    />
  );
}

function ControlledSubstancesTabs({ tab, onTabChange }) {
  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList className="w-full sm:w-auto">
        {VIEW_TABS.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="font-mono text-xs">
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function ControlledSubstancesFilters({
  search,
  location,
  locations,
  hasActiveFilters,
  onSearchChange,
  onLocationChange,
  onClearFilters,
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by substance name..."
          value={search}
          onChange={onSearchChange}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <Select value={location || 'all'} onValueChange={onLocationChange}>
        <SelectTrigger className="w-full lg:w-[200px] font-mono text-sm">
          <Filter className="size-4 mr-2 text-muted-foreground" />
          <SelectValue placeholder="Location" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Locations</SelectItem>
          {locations.map((loc) => (
            <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-muted-foreground">
          <X className="size-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

function createRegisterColumns({ onDispense, onCount, onWastage }) {
  return [
    {
      key: 'item',
      header: 'Substance',
      width: '260px',
      render: (register) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{register.item_name || register.name}</p>
          <p className="truncate text-xs text-muted-foreground">{register.location_name || 'No location'}</p>
        </div>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      width: '120px',
      render: (register) => (
        <span className="font-mono text-sm text-foreground">{register.current_balance || 0}</span>
      ),
    },
    {
      key: 'audit',
      header: 'Last Audit',
      width: '160px',
      render: (register) => (
        <span className="font-mono text-sm text-muted-foreground">
          {register.last_audit_date ? format(parseISO(register.last_audit_date), 'MMM d, yyyy') : 'Never'}
        </span>
      ),
    },
    {
      key: 'alerts',
      header: 'Alerts',
      width: '180px',
      render: (register) => {
        const hasDiscrepancy = register.has_discrepancy || register.discrepancy_count > 0;
        const lastAuditDays = register.last_audit_date
          ? differenceInDays(new Date(), parseISO(register.last_audit_date))
          : null;
        const auditDue = lastAuditDays !== null && lastAuditDays > 30;
        return (
          <div className="flex flex-wrap gap-1">
            {hasDiscrepancy && (
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700 text-xs">
                Discrepancy
              </Badge>
            )}
            {auditDue && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs">
                Audit Due
              </Badge>
            )}
            {!hasDiscrepancy && !auditDue && (
              <span className="text-sm text-muted-foreground">None</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      width: '220px',
      render: (register) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={(event) => { event.stopPropagation(); onDispense(register.id); }}>
            Dispense
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={(event) => { event.stopPropagation(); onCount(register.id); }}>
            Count
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-destructive" onClick={(event) => { event.stopPropagation(); onWastage(register.id); }}>
            Wastage
          </Button>
        </div>
      ),
    },
  ];
}

function ControlledSubstancesTable({
  registers,
  columns,
  hasActiveFilters,
  onOpenRegister,
}) {
  if (registers.length === 0) {
    return (
      <div className="bg-card/50 border rounded-2xl p-12 text-center">
        <Shield className="size-10 text-muted-foreground/50 mx-auto mb-3" />
        <h3 className="font-display text-xl mb-2">No Registers Found</h3>
        <p className="text-muted-foreground text-sm">
          {hasActiveFilters
            ? 'Try adjusting your filters'
            : 'No controlled substance registers available'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={registers}
        rowKey={(register) => register.id}
        rowHeight={68}
        columns={columns}
        onRowClick={(register) => onOpenRegister(register.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[1080px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

function ControlledSubstancesPagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between pt-4 border-t">
      <p className="font-mono text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="size-4 mr-1" />
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
          <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

/**
 * ControlledSubstancesPage - Controlled substance registers page
 */
export default function ControlledSubstancesPage() {
  const navigate = useNavigate();
  const {
    search,
    tab,
    location,
    page,
    queryParams,
    hasActiveFilters,
    handleSearchChange,
    handleTabChange,
    handleLocationChange,
    handlePageChange,
    clearFilters,
  } = useControlledSubstanceFilters();

  const { data: registersData, isLoading, error, refetch } = useControlledRegisters(queryParams);
  const { data: locationsData } = useStorageLocations();

  const registers = registersData?.results || [];
  const totalCount = registersData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);
  const locations = locationsData?.results || locationsData || [];

  const handleClick = useCallback((id) => {
    navigate(`/inventory/controlled/${id}`);
  }, [navigate]);
  const handleDispense = useCallback((id) => {
    navigate(`/inventory/controlled/${id}?action=dispense`);
  }, [navigate]);
  const handleCount = useCallback((id) => {
    navigate(`/inventory/controlled/${id}?action=count`);
  }, [navigate]);
  const handleWastage = useCallback((id) => {
    navigate(`/inventory/controlled/${id}?action=wastage`);
  }, [navigate]);
  const registerColumns = useMemo(() => createRegisterColumns({
    onDispense: handleDispense,
    onCount: handleCount,
    onWastage: handleWastage,
  }), [handleCount, handleDispense, handleWastage]);

  if (isLoading) {
    return <ControlledSubstancesLoadingState />;
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Registers"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <ControlledSubstancesHeader totalCount={totalCount} isLoading={isLoading} onRefresh={refetch} />

      <div className="p-4 sm:p-6 space-y-6">
        <ControlledSubstancesTabs tab={tab} onTabChange={handleTabChange} />

        <ControlledSubstancesFilters
          search={search}
          location={location}
          locations={locations}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={handleSearchChange}
          onLocationChange={handleLocationChange}
          onClearFilters={clearFilters}
        />

        <ControlledSubstancesTable
          registers={registers}
          columns={registerColumns}
          hasActiveFilters={hasActiveFilters}
          onOpenRegister={handleClick}
        />

        <ControlledSubstancesPagination
          page={page}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      </div>
    </PageShell>
  );
}
