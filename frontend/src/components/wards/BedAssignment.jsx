import Info from 'lucide-react/dist/esm/icons/info.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchBar } from '@/components/ui/search-bar';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { wardsApi } from '@/features/wards/api';
import { useAvailableBeds } from '@/features/wards/hooks/useWardQueries';
import { SectionSelector } from './SectionSelector';
import { BedAmenityPicker } from './BedAmenityPicker';

export function BedAssignment({
  onBedSelect,
  selectedBedId = null,
  wardId = null,
  wardData = null, // Pre-fetched ward data to avoid duplicate API calls
  patientGender = null, // 'M' or 'F'
  showAdvancedFilters = false
}) {
  const contentKey = wardId || 'unscoped';

  return (
    <BedAssignmentContent
      key={contentKey}
      onBedSelect={onBedSelect}
      selectedBedId={selectedBedId}
      wardId={wardId}
      wardData={wardData}
      patientGender={patientGender}
      showAdvancedFilters={showAdvancedFilters}
    />
  );
}

const createInitialState = ({ wardId, wardData }) => ({
  wards: wardData ? [wardData] : [],
  selectedWard: wardId || null,
  loading: !wardId,
  searchLoading: false,
  error: null,
  selectedSection: null,
  selectedAmenities: [],
});

function bedAssignmentReducer(state, action) {
  switch (action.type) {
    case 'initial-load-start':
      return { ...state, loading: true, error: null };
    case 'initial-load-success':
      return {
        ...state,
        wards: action.wards,
        selectedWard: state.selectedWard || action.wards[0]?.id || null,
        loading: false,
        error: null,
      };
    case 'use-prefetched-ward':
      return {
        ...state,
        wards: action.ward ? [action.ward] : state.wards,
        loading: false,
        error: null,
      };
    case 'search-start':
      return { ...state, searchLoading: true, error: null };
    case 'search-success':
      return { ...state, wards: action.wards, searchLoading: false };
    case 'load-error':
      return {
        ...state,
        loading: false,
        searchLoading: false,
        error: 'Failed to load wards. Please try again.',
      };
    case 'select-ward':
      return { ...state, selectedWard: action.wardId };
    case 'select-section':
      return { ...state, selectedSection: action.sectionId };
    case 'set-amenities':
      return { ...state, selectedAmenities: action.amenities };
    case 'clear-filters':
      return { ...state, selectedSection: null, selectedAmenities: [] };
    default:
      return state;
  }
}

function BedAssignmentContent({
  onBedSelect,
  selectedBedId,
  wardId,
  wardData,
  patientGender,
  showAdvancedFilters,
}) {
  const [state, dispatch] = useReducer(
    bedAssignmentReducer,
    { wardId, wardData },
    createInitialState
  );
  const requestIdRef = useRef(0);
  const { wards, selectedWard, loading, searchLoading, error, selectedSection, selectedAmenities } = state;

  // Track if ward was pre-selected (to determine if we need ward search)
  const isWardPreSelected = !!wardId;

  // Build filter params for available beds query
  const filterParams = useMemo(() => {
    const params = {
      ward: selectedWard,
      gender: patientGender, // Auto-filters by gender compatibility
    };

    if (selectedSection) {
      params.section = selectedSection;
    }

    if (selectedAmenities.length > 0) {
      // Convert amenity IDs to codes if necessary
      params.amenities = selectedAmenities.join(',');
    }

    return params;
  }, [patientGender, selectedAmenities, selectedSection, selectedWard]);

  // Use the available beds hook with gender filtering
  const {
    data: availableBeds = [],
    isLoading: bedsLoading,
    error: bedsError
  } = useAvailableBeds(filterParams, {
    enabled: !!selectedWard,
  });

  const searchWards = useCallback((searchQuery) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    dispatch({ type: 'search-start' });

    wardsApi.getWards(searchQuery ? { search: searchQuery } : {})
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        const wardsArray = Array.isArray(data) ? data : [];
        dispatch({ type: 'search-success', wards: wardsArray });
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        dispatch({ type: 'load-error' });
      });
  }, []);

  useEffect(() => {
    if (isWardPreSelected) {
      dispatch({ type: 'use-prefetched-ward', ward: wardData });
      return undefined;
    }

    let isCancelled = false;
    dispatch({ type: 'initial-load-start' });

    wardsApi.getWards({})
      .then((data) => {
        if (isCancelled) return;
        const wardsArray = Array.isArray(data) ? data : [];
        dispatch({ type: 'initial-load-success', wards: wardsArray });
      })
      .catch(() => {
        if (isCancelled) return;
        dispatch({ type: 'load-error' });
      });

    return () => {
      isCancelled = true;
    };
  }, [isWardPreSelected, wardData]);

  // Get ward options for search bar
  const wardOptions = useMemo(() => wards.map(ward => ({
    label: `${ward.name} (${ward.available_beds_count} available) - ${ward.get_ward_type_display || ward.ward_type}`,
    value: ward.id
  })), [wards]);

  // Handle ward change
  const handleWardChange = (wardId) => {
    dispatch({ type: 'select-ward', wardId });
  };

  // Handle search input change
  const handleSearchInputChange = (value) => {
    searchWards(value);
  };

  // Get status color for a bed
  const getStatusColor = (status) => {
    switch (status) {
      case 'available':
        return 'bg-green-100 border-green-500 text-green-700';
      case 'occupied':
        return 'bg-red-100 border-red-500 text-red-700';
      case 'reserved':
        return 'bg-yellow-100 border-yellow-500 text-yellow-700';
      case 'maintenance':
        return 'bg-gray-100 border-gray-500 text-gray-700';
      default:
        return 'bg-gray-100 border-gray-500 text-gray-700';
    }
  };

  // Get gender display text
  const getGenderDisplay = () => {
    if (!patientGender) return null;
    return patientGender === 'M' ? 'Male' : 'Female';
  };

  if (loading || bedsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || bedsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-500">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{error || bedsError?.message || 'An error occurred'}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-4">
        <CardTitle className="font-display text-xl">Assign Bed</CardTitle>
        <CardDescription className="font-mono text-xs">
          {isWardPreSelected
            ? 'Select an available bed from the ward'
            : 'Select a ward and then choose an available bed'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Gender compatibility alert */}
        {patientGender && (
          <Alert>
            <Info className="size-4" aria-hidden="true" />
            <AlertDescription>
              Showing beds compatible with {getGenderDisplay()} patients. Gender-restricted sections are automatically filtered.
            </AlertDescription>
          </Alert>
        )}

        {/* Ward selection */}
        <div className="space-y-2">
          <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {isWardPreSelected ? 'Ward' : 'Search for a Ward'}
          </label>
          <SearchBar
            options={wardOptions}
            value={selectedWard}
            onChange={handleWardChange}
            onInputChange={handleSearchInputChange}
            placeholder="Search for a ward by name, type, or description..."
            emptyMessage="No wards found. Try a different search term."
            isLoading={searchLoading}
          />
        </div>

        {/* Advanced Filters */}
        {showAdvancedFilters && selectedWard && (
          <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
            <h4 className="text-sm font-semibold">Advanced Filters</h4>

            {/* Section filter */}
	            <div className="space-y-2">
	              <span className="block text-sm font-medium">Section</span>
              <SectionSelector
                wardId={selectedWard}
                value={selectedSection}
                onValueChange={(sectionId) => dispatch({ type: 'select-section', sectionId })}
                placeholder="All sections..."
              />
            </div>

            {/* Amenities filter */}
	            <div className="space-y-2">
	              <span className="block text-sm font-medium">Required Amenities</span>
              <BedAmenityPicker
                selectedAmenities={selectedAmenities}
                onSelectionChange={(amenities) => dispatch({ type: 'set-amenities', amenities })}
                mode="filter"
              />
            </div>

            {/* Clear filters */}
            {(selectedSection || selectedAmenities.length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dispatch({ type: 'clear-filters' })}
                className="w-full"
              >
                Clear Filters
              </Button>
            )}
          </div>
        )}

        {/* Bed selection */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
	            <span className="text-sm font-medium">Select Bed</span>
            <Badge variant="outline">
              {availableBeds.length} available beds
            </Badge>
          </div>

          {/* No compatible beds warning */}
          {patientGender && availableBeds.length === 0 && selectedWard && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>
                No beds available that are compatible with {getGenderDisplay()} patients in this ward.
                {selectedSection || selectedAmenities.length > 0
                  ? ' Try adjusting your filters.'
                  : ' Try selecting a different ward.'}
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-4">
            {availableBeds.length === 0 ? (
              <div className="text-center p-4 border rounded-md">
                <p className="text-muted-foreground">
                  {selectedWard
                    ? 'No available beds match your criteria'
                    : 'Select a ward to view available beds'}
                </p>
              </div>
            ) : (
              <div aria-label="Available beds" className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
                {availableBeds.map(bed => (
                  <button
                    type="button"
                    key={bed.id}
                    aria-pressed={selectedBedId === bed.id}
                    className={`h-24 border-2 rounded-md p-2 flex flex-col justify-between text-left cursor-pointer hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${getStatusColor(bed.status)} ${selectedBedId === bed.id ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => onBedSelect(bed)}
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-bold">{bed.bed_number}</span>
                      <Badge variant="outline" className="text-xs">
                        {bed.get_bed_type_display}
                      </Badge>
                    </div>
                    <div className="text-xs">
                      ${bed.total_rate}/night
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <div className="text-sm text-muted-foreground">
          {selectedBedId ? 'Bed selected' : 'No bed selected'}
        </div>
      </CardFooter>
    </Card>
  );
}
