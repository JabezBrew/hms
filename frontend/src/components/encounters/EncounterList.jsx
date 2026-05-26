import PlusCircle from 'lucide-react/dist/esm/icons/circle-plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronsLeft from 'lucide-react/dist/esm/icons/chevrons-left.js';
import ChevronsRight from 'lucide-react/dist/esm/icons/chevrons-right.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { DatePicker } from '@/components/ui/date-picker';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import isValid from 'date-fns/isValid';
import { useEncounters } from '@/features/encounters/hooks/useEncounterQueries';

const PAGE_SIZE = 20;

export function EncounterList() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter state
  const [filters, setFilters] = useState({
    patient: '',
    practitioner: '',
    date: null,
    status: 'all',
    type: 'all'
  });

  // Build query parameters based on active tab and filters
  const queryParams = {
    page: currentPage,
    page_size: PAGE_SIZE,
  };

  if (activeTab === 'inpatient') {
    queryParams.encounter_type = 'inpatient';
  } else if (activeTab === 'outpatient') {
    queryParams.encounter_type = 'outpatient';
  } else if (activeTab === 'emergency') {
    queryParams.encounter_type = 'emergency';
  }

  if (filters.patient) {
    queryParams.patient_id = filters.patient;
  }

  if (filters.practitioner) {
    queryParams.practitioner_id = filters.practitioner;
  }

  if (filters.date) {
    queryParams.date = format(filters.date, 'yyyy-MM-dd');
  }

  if (filters.status && filters.status !== 'all') {
    queryParams.status = filters.status;
  }

  if (filters.type && filters.type !== 'all' && activeTab === 'all') {
    queryParams.encounter_type = filters.type;
  }

  // Use React Query to fetch encounters
  const {
    data: encountersData,
    isLoading,
    isError,
    error,
    refetch
  } = useEncounters(queryParams);

  // Handle filter changes - reset to page 1 when filters change
  const handleFilterChange = (name, value) => {
    setFilters(prev => ({ ...prev, [name]: value }));
    setCurrentPage(1);
  };

  // Handle tab change - reset to page 1
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  // Reset filters
  const resetFilters = () => {
    setFilters({
      patient: '',
      practitioner: '',
      date: null,
      status: 'all',
      type: 'all'
    });
    setCurrentPage(1);
  };

  // Check if any filters are active
  const hasActiveFilters = filters.patient || filters.practitioner || filters.date ||
    filters.status !== 'all' || (filters.type !== 'all' && activeTab === 'all');

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = parseISO(dateString);
      return isValid(date) ? format(date, 'MMM d, yyyy h:mm a') : 'Invalid date';
    } catch {
      return 'Invalid date';
    }
  };

  const getStatusConfig = (status) => {
    switch (status) {
      case 'planned':
        return { className: 'border-sky-200 bg-sky-50 text-sky-700', label: 'Planned' };
      case 'in-progress':
        return { className: 'border-amber-200 bg-amber-50 text-amber-700', label: 'In Progress' };
      case 'finished':
        return { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', label: 'Finished' };
      case 'cancelled':
        return { className: 'border-rose-200 bg-rose-50 text-rose-700', label: 'Cancelled' };
      default:
        return { className: 'border-border bg-muted text-muted-foreground', label: status || 'Unknown' };
    }
  };

  const getTypeConfig = (type) => {
    switch (type) {
      case 'inpatient':
        return { label: 'Inpatient' };
      case 'outpatient':
        return { label: 'Outpatient' };
      case 'emergency':
        return { label: 'Emergency' };
      default:
        return { label: type || 'Encounter' };
    }
  };

  const encounterColumns = [
    {
      key: 'patient',
      header: 'Patient',
      width: '240px',
      render: (encounter) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{encounter.patient_name || 'Unknown Patient'}</p>
          <p className="truncate text-xs text-muted-foreground">{encounter.id || 'Encounter'}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '140px',
      render: (encounter) => (
        <Badge variant="outline" className="text-xs">
          {getTypeConfig(encounter.encounter_type).label}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (encounter) => {
        const statusConfig = getStatusConfig(encounter.status);
        return (
          <Badge variant="outline" className={cn('text-xs', statusConfig.className)}>
            {statusConfig.label}
          </Badge>
        );
      },
    },
    {
      key: 'practitioner',
      header: 'Practitioner',
      width: '220px',
      render: (encounter) => (
        <span className="truncate text-sm text-muted-foreground">
          {encounter.practitioner_name || 'Unassigned'}
        </span>
      ),
    },
    {
      key: 'start_time',
      header: 'Scheduled',
      width: '180px',
      render: (encounter) => (
        <span className="font-mono text-sm text-muted-foreground">
          {formatDate(encounter.start_time)}
        </span>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      width: '180px',
      render: (encounter) => (
        <span className="truncate text-sm text-muted-foreground">
          {encounter.location || '—'}
        </span>
      ),
    },
  ];

  // Prepare encounters data from paginated response
  const encounters = encountersData?.results || [];
  const totalCount = encountersData?.count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNextPage = !!encountersData?.next;
  const hasPrevPage = !!encountersData?.previous;

  // Pagination helpers
  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Handle error state
  if (isError) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-2xl text-foreground">Error Loading Encounters</h2>
          <p className="text-muted-foreground">{error?.message || 'Failed to load encounters.'}</p>
          <Button onClick={() => refetch()} className="font-mono text-xs">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-2">
              Clinical Documentation
            </p>
            <h1 className="font-display text-4xl text-foreground tracking-tight">
              Encounters
            </h1>
            <p className="text-muted-foreground mt-2">
              {totalCount} encounter{totalCount !== 1 ? 's' : ''} found
              {totalPages > 1 && (
                <span className="font-mono text-xs ml-2">
                  (Page {currentPage} of {totalPages})
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={cn("font-mono text-xs", hasActiveFilters && "border-primary text-primary")}
            >
              <Filter className="h-4 w-4 mr-2" />
              Filters
              {hasActiveFilters && (
                <span className="ml-2 w-2 h-2 rounded-full bg-primary" />
              )}
            </Button>
            <Button onClick={() => navigate('/encounters/new')} className="font-mono text-xs">
              <PlusCircle className="h-4 w-4 mr-2" />
              New Encounter
            </Button>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        {/* Filters Panel */}
        {showFilters && (
          <div className={cn(
            "bg-card border border-border rounded-2xl p-6",
            "animate-chronicle-enter"
          )}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-foreground">Filter Encounters</h3>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="font-mono text-xs text-muted-foreground"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear All
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Patient
                </Label>
                <Input
                  placeholder="Name or MRN..."
                  value={filters.patient}
                  onChange={(e) => handleFilterChange('patient', e.target.value)}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Practitioner
                </Label>
                <Input
                  placeholder="Name or employee ID..."
                  value={filters.practitioner}
                  onChange={(e) => handleFilterChange('practitioner', e.target.value)}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Date
                </Label>
                <DatePicker
                  date={filters.date}
                  setDate={(date) => handleFilterChange('date', date)}
                  placeholder="Select date"
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Status
                </Label>
                <Select
                  value={filters.status}
                  onValueChange={(value) => handleFilterChange('status', value)}
                >
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="finished">Finished</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {activeTab === 'all' && (
                <div className="space-y-2">
                  <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    Type
                  </Label>
                  <Select
                    value={filters.type}
                    onValueChange={(value) => handleFilterChange('type', value)}
                  >
                    <SelectTrigger className="font-mono text-sm">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="inpatient">Inpatient</SelectItem>
                      <SelectItem value="outpatient">Outpatient</SelectItem>
                      <SelectItem value="emergency">Emergency</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="all" value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="bg-card border border-border rounded-xl p-1 h-auto">
            <TabsTrigger
              value="all"
              className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-4 py-2"
            >
              All Encounters
            </TabsTrigger>
            <TabsTrigger
              value="inpatient"
              className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-4 py-2"
            >
              Inpatient
            </TabsTrigger>
            <TabsTrigger
              value="outpatient"
              className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-4 py-2"
            >
              Outpatient
            </TabsTrigger>
            <TabsTrigger
              value="emergency"
              className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-4 py-2"
            >
              Emergency
            </TabsTrigger>
          </TabsList>

          {/* Tab Content */}
          {['all', 'inpatient', 'outpatient', 'emergency'].map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-6">
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-xl" />
                  ))}
                </div>
              ) : encounters.length === 0 ? (
                <div className={cn(
                  "bg-card/50 border border-border rounded-2xl p-12 text-center",
                  "animate-chronicle-enter"
                )}>
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="font-display text-xl text-foreground mb-2">No Encounters Found</h3>
                  <p className="text-muted-foreground text-sm mb-6">
                    No encounters match your current filters.
                  </p>
                  <Button onClick={() => navigate('/encounters/new')} className="font-mono text-xs">
                    <PlusCircle className="h-4 w-4 mr-2" />
                    Create New Encounter
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <VirtualizedTable
                    rows={encounters}
                    rowKey={(encounter) => encounter.id}
                    rowHeight={68}
                    columns={encounterColumns}
                    onRowClick={(encounter) => navigate(`/encounters/${encounter.id}`)}
                    rowClassName="hover:bg-muted/30"
                    className="min-w-[1100px]"
                    headerClassName="bg-muted/50 border-b border-border"
                  />
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {/* Pagination Controls */}
        {totalPages > 1 && !isLoading && (
          <div className="flex items-center justify-between border-t border-border pt-6 mt-6">
            <div className="text-sm text-muted-foreground font-mono">
              Showing {((currentPage - 1) * PAGE_SIZE) + 1} to {Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount} encounters
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(1)}
                disabled={!hasPrevPage}
                className="font-mono text-xs"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(currentPage - 1)}
                disabled={!hasPrevPage}
                className="font-mono text-xs"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <div className="flex items-center gap-1 mx-2">
                {/* Show page numbers */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "outline"}
                      size="sm"
                      onClick={() => goToPage(pageNum)}
                      className={cn(
                        "font-mono text-xs w-8 h-8 p-0",
                        currentPage === pageNum && "pointer-events-none"
                      )}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(currentPage + 1)}
                disabled={!hasNextPage}
                className="font-mono text-xs"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(totalPages)}
                disabled={!hasNextPage}
                className="font-mono text-xs"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * EncounterGrid - Chronicle-style encounter cards
 */
function EncounterGrid({ encounters, loading, formatDate, navigate }) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (encounters.length === 0) {
    return (
      <div className={cn(
        "bg-card/50 border border-border rounded-2xl p-12 text-center",
        "animate-chronicle-enter"
      )}>
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-display text-xl text-foreground mb-2">No Encounters Found</h3>
        <p className="text-muted-foreground text-sm mb-6">
          No encounters match your current filters.
        </p>
        <Button onClick={() => navigate('/encounters/new')} className="font-mono text-xs">
          <PlusCircle className="h-4 w-4 mr-2" />
          Create New Encounter
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {encounters.map((encounter, index) => (
        <EncounterCard
          key={encounter.id}
          encounter={encounter}
          index={index}
          formatDate={formatDate}
          onClick={() => navigate(`/encounters/${encounter.id}`)}
        />
      ))}
    </div>
  );
}

/**
 * EncounterCard - Individual encounter card in Chronicle style
 */
function EncounterCard({ encounter, index, formatDate, onClick }) {
  const getStatusConfig = (status) => {
    switch (status) {
      case 'planned':
        return { badge: 'badge-chronicle-sky', label: 'Planned' };
      case 'in-progress':
        return { badge: 'badge-chronicle-amber', label: 'In Progress', ribbon: 'status-ribbon-warning' };
      case 'finished':
        return { badge: 'badge-chronicle-emerald', label: 'Finished' };
      case 'cancelled':
        return { badge: 'badge-chronicle-rose', label: 'Cancelled' };
      default:
        return { badge: 'font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground', label: status };
    }
  };

  const getTypeConfig = (type) => {
    switch (type) {
      case 'inpatient':
        return { icon: Building2, color: 'text-[oklch(0.70_0.15_230)]', label: 'Inpatient' };
      case 'outpatient':
        return { icon: Stethoscope, color: 'text-[oklch(0.70_0.17_155)]', label: 'Outpatient' };
      case 'emergency':
        return { icon: AlertTriangle, color: 'text-[oklch(0.65_0.22_15)]', label: 'Emergency' };
      default:
        return { icon: Activity, color: 'text-muted-foreground', label: type };
    }
  };

  const statusConfig = getStatusConfig(encounter.status);
  const typeConfig = getTypeConfig(encounter.encounter_type);
  const TypeIcon = typeConfig.icon;

  return (
    <article
      className={cn(
        "group relative bg-card/50 border border-border rounded-xl p-5",
        "hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]",
        "transition-all duration-300 cursor-pointer",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      {statusConfig.ribbon && <div className={cn("status-ribbon", statusConfig.ribbon)} />}

      <div className="flex items-center gap-4">
        {/* Type Icon */}
        <div className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center",
          "bg-card border border-border"
        )}>
          <TypeIcon className={cn("h-5 w-5", typeConfig.color)} />
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-display text-xl text-foreground truncate">
              {encounter.patient_name || 'Unknown Patient'}
            </h3>
            <span className={statusConfig.badge}>{statusConfig.label}</span>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {typeConfig.label}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <Calendar className="h-3 w-3" />
              {formatDate(encounter.start_time)}
            </span>
            {encounter.practitioner_name && (
              <span className="flex items-center gap-1.5">
                <User className="h-3 w-3" />
                {encounter.practitioner_name}
              </span>
            )}
            {encounter.location && (
              <span className="flex items-center gap-1.5">
                <Building2 className="h-3 w-3" />
                {encounter.location}
              </span>
            )}
          </div>
        </div>

        {/* Hover Action */}
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        >
          View
          <ChevronRight className="h-3 w-3 ml-1" />
        </Button>
      </div>
    </article>
  );
}
