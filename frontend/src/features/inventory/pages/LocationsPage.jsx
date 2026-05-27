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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetBody,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LocationCardSkeleton } from '@/components/inventory/LocationCard';
import {
  formatLocationCurrency,
  formatLocationNumber,
  getLocationConfig,
  getTempZoneConfig,
} from '@/components/inventory/location-card-utils';
import { LocationForm } from '@/components/inventory';
import { useStorageLocations } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js';
import Edit from 'lucide-react/dist/esm/icons/pencil.js';

const LOCATION_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'ward', label: 'Ward' },
  { value: 'department', label: 'Department' },
  { value: 'store', label: 'Store' },
];

const TEMP_ZONE_OPTIONS = [
  { value: 'all', label: 'All Zones' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'cold', label: 'Cold Storage' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'controlled', label: 'Controlled' },
];

function useStorageLocationFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const locationType = searchParams.get('type') || '';
  const tempZone = searchParams.get('temp_zone') || '';
  const action = searchParams.get('action');
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

  const handleTypeChange = useCallback((value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') {
        params.set('type', value);
      } else {
        params.delete('type');
      }
      params.set('page', '1');
      return params;
    });
  }, [setSearchParams]);

  const handleTempZoneChange = useCallback((value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') {
        params.set('temp_zone', value);
      } else {
        params.delete('temp_zone');
      }
      params.set('page', '1');
      return params;
    });
  }, [setSearchParams]);

  const handlePageChange = useCallback((newPage) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('page', newPage.toString());
      return params;
    });
  }, [setSearchParams]);

  const clearFilters = useCallback(() => {
    setSearch('');
    setSearchParams({});
  }, [setSearchParams]);

  const queryParams = useMemo(() => ({
    page,
    page_size: 24,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(locationType && { location_type: locationType }),
    ...(tempZone && { temperature_zone: tempZone }),
  }), [debouncedSearch, locationType, page, tempZone]);

  return {
    search,
    locationType,
    tempZone,
    action,
    page,
    queryParams,
    hasActiveFilters: Boolean(debouncedSearch || locationType || tempZone),
    handleSearchChange: (event) => setSearch(event.target.value),
    handleTypeChange,
    handleTempZoneChange,
    handlePageChange,
    clearFilters,
    setSearchParams,
  };
}

function createLocationColumns({
  locationMutationsAvailable,
  onViewStock,
  onTransferTo,
  onEditLocation,
}) {
  return [
    {
      key: 'location',
      header: 'Location',
      width: '240px',
      render: (location) => {
        const config = getLocationConfig(location.location_type || location.type);
        const Icon = config.icon;

        return (
          <div className="flex items-center gap-3">
            <div className={cn('flex items-center justify-center size-8 rounded-lg', config.bgColor)}>
              <Icon className={cn('size-4', config.color)} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{location.name}</p>
              {location.code && (
                <p className="text-xs text-muted-foreground font-mono">{location.code}</p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'type',
      header: 'Type',
      width: '140px',
      render: (location) => {
        const config = getLocationConfig(location.location_type || location.type);
        return (
          <Badge variant="outline" className="text-xs">
            {config.label}
          </Badge>
        );
      },
    },
    {
      key: 'parent',
      header: 'Parent',
      width: '200px',
      render: (location) => (
        <span className="text-sm text-muted-foreground">
          {location.parent_name || '-'}
        </span>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      width: '120px',
      headerClassName: 'text-right',
      cellClassName: 'text-right font-mono text-sm',
      render: (location) => formatLocationNumber(location.item_count || location.items_count || 0),
    },
    {
      key: 'value',
      header: 'Value',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right font-mono text-sm text-emerald-500',
      render: (location) => formatLocationCurrency(location.stock_value || location.total_value || 0),
    },
    {
      key: 'temp',
      header: 'Temp Zone',
      width: '160px',
      render: (location) => {
        const tempConfig = getTempZoneConfig(location.temperature_zone);
        const TempIcon = tempConfig?.icon;
        return tempConfig ? (
          <div className={cn('flex items-center gap-1 text-xs', tempConfig.color)}>
            <TempIcon className="size-3" />
            <span>{tempConfig.label}</span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      width: '64px',
      render: (location) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onViewStock(location.id); }}>
              <Eye className="size-4 mr-2" />
              View Stock
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onTransferTo(location.id); }}>
              <ArrowRightLeft className="size-4 mr-2" />
              Transfer To
            </DropdownMenuItem>
            {locationMutationsAvailable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onEditLocation(location.id); }}>
                  <Edit className="size-4 mr-2" />
                  Edit
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}

function LocationsLoadingState() {
  return (
    <PageState variant="loading" fullHeight={false} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-32 mt-2" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>

      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 max-w-md" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-40" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <LocationCardSkeleton key={i} />
        ))}
      </div>
    </PageState>
  );
}

function LocationsHeader({
  totalCount,
  isLoading,
  locationMutationsAvailable,
  onRefresh,
  onCreateLocation,
}) {
  return (
    <PageHeader
      title="Storage Locations"
      description={`${totalCount} location${totalCount !== 1 ? 's' : ''}`}
      actions={(
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onRefresh}>
            <RefreshCw className={cn('size-4 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          {locationMutationsAvailable && (
            <Button onClick={onCreateLocation}>
              <Plus className="size-4 mr-2" />
              Add Location
            </Button>
          )}
        </div>
      )}
    />
  );
}

function RustV2LocationMutationNotice({ locationMutationsAvailable }) {
  if (locationMutationsAvailable) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Storage location creation and editing is not available in Rust V2 mode yet. Existing
      location review, stock visibility, and transfer request workflows remain available.
    </div>
  );
}

function LocationsFilters({
  search,
  locationType,
  tempZone,
  hasActiveFilters,
  onSearchChange,
  onTypeChange,
  onTempZoneChange,
  onClearFilters,
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or code..."
          value={search}
          onChange={onSearchChange}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <Select value={locationType || 'all'} onValueChange={onTypeChange}>
        <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
          <Filter className="size-4 mr-2 text-muted-foreground" />
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          {LOCATION_TYPE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="font-mono text-sm">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={tempZone || 'all'} onValueChange={onTempZoneChange}>
        <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
          <SelectValue placeholder="Temp Zone" />
        </SelectTrigger>
        <SelectContent>
          {TEMP_ZONE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="font-mono text-sm">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="size-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

function LocationsTable({ locations, columns, onOpenLocation }) {
  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={locations}
        rowKey={(location) => location.id}
        rowHeight={64}
        columns={columns}
        onRowClick={(location) => onOpenLocation(location.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[980px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

function LocationsEmptyState({
  hasActiveFilters,
  locationMutationsAvailable,
  onCreateLocation,
}) {
  return (
    <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
      <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
        <MapPin className="size-8 text-muted-foreground" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">
        No Locations Found
      </h3>
      <p className="text-muted-foreground text-sm mb-4">
        {hasActiveFilters
          ? 'Try adjusting your filters'
          : 'Add your first storage location to get started'}
      </p>
      {!hasActiveFilters && locationMutationsAvailable && (
        <Button onClick={onCreateLocation} className="font-mono text-xs">
          <Plus className="size-4 mr-2" />
          Add Location
        </Button>
      )}
    </div>
  );
}

function LocationsDisplay({
  locations,
  columns,
  hasActiveFilters,
  locationMutationsAvailable,
  onOpenLocation,
  onCreateLocation,
}) {
  if (locations.length === 0) {
    return (
      <LocationsEmptyState
        hasActiveFilters={hasActiveFilters}
        locationMutationsAvailable={locationMutationsAvailable}
        onCreateLocation={onCreateLocation}
      />
    );
  }

  return (
    <LocationsTable
      locations={locations}
      columns={columns}
      onOpenLocation={onOpenLocation}
    />
  );
}

function LocationsPagination({ page, totalPages, totalCount, onPageChange }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between pt-4 border-t border-border">
      <p className="font-mono text-xs text-muted-foreground">
        Page {page} of {totalPages} ({totalCount} locations)
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="font-mono text-xs"
        >
          <ChevronLeft className="size-4 mr-1" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="font-mono text-xs"
        >
          Next
          <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function CreateLocationSheet({ isOpen, onClose, onCreateSuccess }) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Add Storage Location</SheetTitle>
          <SheetDescription>
            Create a new storage location for your inventory.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <LocationForm
            onSuccess={onCreateSuccess}
            onCancel={onClose}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/**
 * LocationsPage - Storage locations management page
 */
export default function LocationsPage() {
  const navigate = useNavigate();
  const locationMutationsAvailable = !isRustV2ApiMode();
  const {
    search,
    locationType,
    tempZone,
    action,
    page,
    queryParams,
    hasActiveFilters,
    handleSearchChange,
    handleTypeChange,
    handleTempZoneChange,
    handlePageChange,
    clearFilters,
    setSearchParams,
  } = useStorageLocationFilters();
  const isCreateOpen = locationMutationsAvailable && action === 'create';
  const { data: locationsData, isLoading, error, refetch } = useStorageLocations(queryParams);
  const locations = locationsData?.results || locationsData || [];
  const totalCount = locationsData?.count || locations.length;
  const totalPages = Math.ceil(totalCount / 24);

  const handleLocationClick = useCallback((locationId) => {
    navigate(`/inventory/locations/${locationId}`);
  }, [navigate]);
  const handleViewStock = useCallback((locationId) => {
    navigate(`/inventory/items?location=${locationId}`);
  }, [navigate]);
  const handleEditLocation = useCallback((locationId) => {
    if (locationMutationsAvailable) {
      navigate(`/inventory/locations/${locationId}?action=edit`);
    }
  }, [locationMutationsAvailable, navigate]);
  const handleTransferTo = useCallback((locationId) => {
    navigate(`/inventory/transfers?action=create&to=${locationId}`);
  }, [navigate]);
  const handleCreateLocation = useCallback(() => {
    if (!locationMutationsAvailable) {
      return;
    }
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('action', 'create');
      return params;
    });
  }, [locationMutationsAvailable, setSearchParams]);
  const handleCloseSheet = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('action');
      return params;
    });
  }, [setSearchParams]);
  const handleCreateSuccess = useCallback(() => {
    handleCloseSheet();
    refetch();
  }, [handleCloseSheet, refetch]);
  const locationColumns = useMemo(() => createLocationColumns({
    locationMutationsAvailable,
    onViewStock: handleViewStock,
    onTransferTo: handleTransferTo,
    onEditLocation: handleEditLocation,
  }), [handleEditLocation, handleTransferTo, handleViewStock, locationMutationsAvailable]);

  if (isLoading && !locationsData) {
    return <LocationsLoadingState />;
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Locations"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <LocationsHeader
        totalCount={totalCount}
        isLoading={isLoading}
        locationMutationsAvailable={locationMutationsAvailable}
        onRefresh={refetch}
        onCreateLocation={handleCreateLocation}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <RustV2LocationMutationNotice locationMutationsAvailable={locationMutationsAvailable} />

        <LocationsFilters
          search={search}
          locationType={locationType}
          tempZone={tempZone}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={handleSearchChange}
          onTypeChange={handleTypeChange}
          onTempZoneChange={handleTempZoneChange}
          onClearFilters={clearFilters}
        />

        <LocationsDisplay
          locations={locations}
          columns={locationColumns}
          hasActiveFilters={hasActiveFilters}
          locationMutationsAvailable={locationMutationsAvailable}
          onOpenLocation={handleLocationClick}
          onCreateLocation={handleCreateLocation}
        />

        <LocationsPagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          onPageChange={handlePageChange}
        />

        <CreateLocationSheet
          isOpen={isCreateOpen}
          onClose={handleCloseSheet}
          onCreateSuccess={handleCreateSuccess}
        />
      </div>
    </PageShell>
  );
}
