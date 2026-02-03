import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetBody,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  LocationCard,
  LocationCardSkeleton,
  LocationRow,
  LocationRowSkeleton,
} from '@/components/inventory/LocationCard';
import { LocationForm } from '@/components/inventory';
import { useStorageLocations } from '@/hooks/useInventoryQueries';
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
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import X from 'lucide-react/dist/esm/icons/x.js';

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
      <div className="space-y-6">
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
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-2xl text-foreground">
            Error Loading Locations
          </h2>
          <p className="text-muted-foreground">{error.message}</p>
          <Button onClick={() => refetch()} className="font-mono text-xs">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">
            Storage Locations
          </h1>
          <p className="text-muted-foreground mt-1">
            {totalCount} location{totalCount !== 1 ? 's' : ''}
          </p>
        </div>
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
      </div>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {locations.map((location, index) => (
              <LocationCard
                key={location.id}
                location={location}
                index={index}
                onClick={() => handleLocationClick(location.id)}
                onViewStock={() => handleViewStock(location.id)}
                onEdit={() => handleEditLocation(location.id)}
                onTransfer={() => handleTransferTo(location.id)}
              />
            ))}
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden bg-card/30">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Location
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    Parent
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Items
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                    Value
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                    Temp Zone
                  </th>
                  <th className="w-10 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {locations.map((location, index) => (
                  <LocationRow
                    key={location.id}
                    location={location}
                    index={index}
                    onClick={() => handleLocationClick(location.id)}
                    onViewStock={() => handleViewStock(location.id)}
                    onEdit={() => handleEditLocation(location.id)}
                    onTransfer={() => handleTransferTo(location.id)}
                  />
                ))}
              </tbody>
            </table>
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
  );
}
