import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import VirtualizedGrid from '@/components/ui/VirtualizedGrid';
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
import {
  LocationCard,
  LocationCardSkeleton,
  getLocationConfig,
  getTempZoneConfig,
  formatCurrency,
  formatNumber,
} from '@/components/inventory/LocationCard';
import { LocationForm } from '@/components/inventory';
import { useStorageLocations } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import List from 'lucide-react/dist/esm/icons/list.js';
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

/**
 * LocationsPage - Storage locations management page
 */
export default function LocationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // View mode from localStorage
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('locations-view-mode') || 'grid';
  });

  // Filters from URL
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const locationType = searchParams.get('type') || '';
  const tempZone = searchParams.get('temp_zone') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Debounced search
  const debouncedSearch = useDebounce(search, 300);

  // Sheet state from URL
  const action = searchParams.get('action');
  const isCreateOpen = action === 'create';

  // Persist view mode to localStorage
  useEffect(() => {
    localStorage.setItem('locations-view-mode', viewMode);
  }, [viewMode]);

  // Build query params
  const queryParams = {
    page,
    page_size: 24,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(locationType && { location_type: locationType }),
    ...(tempZone && { temperature_zone: tempZone }),
  };

  // Fetch data
  const {
    data: locationsData,
    isLoading,
    error,
    refetch,
  } = useStorageLocations(queryParams);

  const locations = locationsData?.results || locationsData || [];
  const totalCount = locationsData?.count || locations.length;
  const totalPages = Math.ceil(totalCount / 24);

  // Handle search input
  const handleSearchChange = (e) => {
    setSearch(e.target.value);
  };

  // Update search params when debounced search changes
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

  // Handle filter changes
  const handleTypeChange = (value) => {
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
  };

  const handleTempZoneChange = (value) => {
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
  };

  const handlePageChange = (newPage) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('page', newPage.toString());
      return params;
    });
  };

  // Clear all filters
  const clearFilters = () => {
    setSearch('');
    setSearchParams({});
  };

  const hasActiveFilters = debouncedSearch || locationType || tempZone;

  // Navigate to location
  const handleLocationClick = (locationId) => {
    navigate(`/inventory/locations/${locationId}`);
  };

  const handleViewStock = (locationId) => {
    navigate(`/inventory/items?location=${locationId}`);
  };

  const handleEditLocation = (locationId) => {
    navigate(`/inventory/locations/${locationId}?action=edit`);
  };

  const handleTransferTo = (locationId) => {
    navigate(`/inventory/transfers?action=create&to=${locationId}`);
  };

  const handleCreateLocation = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('action', 'create');
      return params;
    });
  };

  const locationColumns = useMemo(() => ([
    {
      key: 'location',
      header: 'Location',
      width: '240px',
      render: (location) => {
        const config = getLocationConfig(location.location_type || location.type);
        const Icon = config.icon;

        return (
          <div className="flex items-center gap-3">
            <div className={cn('flex items-center justify-center w-8 h-8 rounded-lg', config.bgColor)}>
              <Icon className={cn('h-4 w-4', config.color)} />
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
      render: (location) => formatNumber(location.item_count || location.items_count || 0),
    },
    {
      key: 'value',
      header: 'Value',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right font-mono text-sm text-emerald-500',
      render: (location) => formatCurrency(location.stock_value || location.total_value || 0),
    },
    {
      key: 'temp',
      header: 'Temp Zone',
      width: '160px',
      render: (location) => {
        const tempZone = getTempZoneConfig(location.temperature_zone);
        const TempIcon = tempZone?.icon;
        return tempZone ? (
          <div className={cn('flex items-center gap-1 text-xs', tempZone.color)}>
            <TempIcon className="h-3 w-3" />
            <span>{tempZone.label}</span>
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
              className="h-8 w-8 p-0"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleViewStock(location.id); }}>
              <Eye className="h-4 w-4 mr-2" />
              View Stock
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleTransferTo(location.id); }}>
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Transfer To
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleEditLocation(location.id); }}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]), [
    handleEditLocation,
    handleTransferTo,
    handleViewStock,
  ]);

  const handleCloseSheet = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('action');
      return params;
    });
  };

  const handleCreateSuccess = () => {
    handleCloseSheet();
    refetch();
  };

  // Loading state (only show skeleton on initial load, not on refetches)
  if (isLoading && !locationsData) {
    return (
      <PageState variant="loading" fullHeight={false} className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-5 w-32 mt-2" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>

        {/* Filters skeleton */}
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1 max-w-md" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-40" />
        </div>

        {/* Grid skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <LocationCardSkeleton key={i} />
          ))}
        </div>
      </PageState>
    );
  }

  // Error state
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
      <PageHeader
        title="Storage Locations"
        description={`${totalCount} location${totalCount !== 1 ? 's' : ''}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={handleCreateLocation}>
              <Plus className="h-4 w-4 mr-2" />
              Add Location
            </Button>
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">

      {/* Filters Row */}
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or code..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9 font-mono text-sm"
          />
        </div>

        {/* Type Filter */}
        <Select value={locationType || 'all'} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
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

        {/* Temperature Zone Filter */}
        <Select value={tempZone || 'all'} onValueChange={handleTempZoneChange}>
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

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* View Toggle Row */}
      <div className="flex items-center justify-end">
        <div className="flex items-center border rounded-lg p-1 bg-muted/30">
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

      {/* Locations Display */}
      {locations.length > 0 ? (
        viewMode === 'grid' ? (
          <VirtualizedGrid
            items={locations}
            minItemWidth={260}
            rowHeight={260}
            gap={16}
            getItemKey={(location) => location.id}
            renderItem={(location, index) => (
              <LocationCard
                location={location}
                index={index}
                onClick={() => handleLocationClick(location.id)}
                onViewStock={() => handleViewStock(location.id)}
                onEdit={() => handleEditLocation(location.id)}
                onTransfer={() => handleTransferTo(location.id)}
              />
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <VirtualizedTable
              rows={locations}
              rowKey={(location) => location.id}
              rowHeight={64}
              columns={locationColumns}
              onRowClick={(location) => handleLocationClick(location.id)}
              rowClassName="hover:bg-muted/30"
              className="min-w-[980px]"
              headerClassName="bg-muted/50 border-b border-border"
            />
          </div>
        )
      ) : (
        <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <MapPin className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-display text-xl text-foreground mb-2">
            No Locations Found
          </h3>
          <p className="text-muted-foreground text-sm mb-4">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Add your first storage location to get started'}
          </p>
          {!hasActiveFilters && (
            <Button onClick={handleCreateLocation} className="font-mono text-xs">
              <Plus className="h-4 w-4 mr-2" />
              Add Location
            </Button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages} ({totalCount} locations)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="font-mono text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="font-mono text-xs"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Create Location Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={(open) => !open && handleCloseSheet()}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display text-2xl">Add Storage Location</SheetTitle>
            <SheetDescription>
              Create a new storage location for your inventory.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <LocationForm
              onSuccess={handleCreateSuccess}
              onCancel={handleCloseSheet}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
      </div>
    </PageShell>
  );
}
