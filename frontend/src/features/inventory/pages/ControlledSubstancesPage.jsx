import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import AlertOctagon from 'lucide-react/dist/esm/icons/alert-octagon.js';

const VIEW_TABS = [
  { value: 'all', label: 'All Registers' },
  { value: 'discrepancies', label: 'Discrepancies' },
  { value: 'audit_due', label: 'Audit Due' },
];

/**
 * ControlledRegisterCard - Card display for controlled substance registers
 */
function ControlledRegisterCard({
  register,
  index = 0,
  onClick,
  onDispense,
  onCount,
  onWastage,
}) {
  const hasDiscrepancy = register.has_discrepancy || register.discrepancy_count > 0;
  const lastAuditDays = register.last_audit_date
    ? differenceInDays(new Date(), parseISO(register.last_audit_date))
    : null;
  const auditDue = lastAuditDays !== null && lastAuditDays > 30;

  return (
    <Card
      className={cn(
        'group relative bg-card/30 border-border/50',
        'hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]',
        'transition-all duration-300 cursor-pointer',
        'animate-chronicle-enter',
        hasDiscrepancy && 'border-rose-500/30'
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      {/* Discrepancy indicator */}
      {hasDiscrepancy && (
        <div className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-bl-lg rounded-tr-lg" />
      )}

      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-rose-500" />
            <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-500 border-rose-500/30">
              Controlled
            </Badge>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
                <Eye className="h-4 w-4 mr-2" />
                View Register
              </DropdownMenuItem>
              {onDispense && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDispense(); }}>
                  <Pill className="h-4 w-4 mr-2" />
                  Dispense
                </DropdownMenuItem>
              )}
              {onCount && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCount(); }}>
                  <ClipboardCheck className="h-4 w-4 mr-2" />
                  Physical Count
                </DropdownMenuItem>
              )}
              {onWastage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onWastage(); }}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Record Wastage
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Item name */}
        <h3 className="font-display text-lg text-foreground mb-2 truncate">
          {register.item_name || register.name}
        </h3>

        {/* Location */}
        {register.location_name && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <MapPin className="h-3 w-3" />
            <span>{register.location_name}</span>
          </div>
        )}

        {/* Alerts */}
        <div className="space-y-1 mb-3">
          {hasDiscrepancy && (
            <div className="flex items-center gap-2 text-xs text-rose-500">
              <AlertOctagon className="h-3 w-3" />
              <span>Unresolved discrepancy</span>
            </div>
          )}
          {auditDue && (
            <div className="flex items-center gap-2 text-xs text-amber-500">
              <AlertTriangle className="h-3 w-3" />
              <span>Audit overdue ({lastAuditDays} days)</span>
            </div>
          )}
        </div>

        {/* Balance and audit info */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div>
            <p className="text-xs text-muted-foreground">Balance</p>
            <p className="font-mono text-xl font-semibold">
              {register.current_balance || 0}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Last Audit</p>
            {register.last_audit_date ? (
              <p className="font-mono text-sm">
                {format(parseISO(register.last_audit_date), 'MMM d, yyyy')}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Never</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * ControlledSubstancesPage - Controlled substance registers page
 */
export default function ControlledSubstancesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const tab = searchParams.get('tab') || 'all';
  const location = searchParams.get('location') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const debouncedSearch = useDebounce(search, 300);

  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(tab === 'discrepancies' && { has_discrepancy: true }),
    ...(tab === 'audit_due' && { audit_due: true }),
    ...(location && { location }),
  };

  const { data: registersData, isLoading, error, refetch } = useControlledRegisters(queryParams);
  const { data: locationsData } = useStorageLocations();

  const registers = registersData?.results || [];
  const totalCount = registersData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);
  const locations = locationsData?.results || locationsData || [];

  const handleSearchChange = (e) => setSearch(e.target.value);

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

  const hasActiveFilters = debouncedSearch || tab !== 'all' || location;

  const handleClick = (id) => navigate(`/inventory/controlled/${id}`);
  const handleDispense = (id) => navigate(`/inventory/controlled/${id}?action=dispense`);
  const handleCount = (id) => navigate(`/inventory/controlled/${id}?action=count`);
  const handleWastage = (id) => navigate(`/inventory/controlled/${id}?action=wastage`);

  if (isLoading) {
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
            <Card key={i} className="bg-card/30 border-border/50">
              <CardContent className="p-4">
                <Skeleton className="h-5 w-20 mb-3" />
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2 mb-3" />
                <div className="flex justify-between pt-3 border-t">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-6 w-24" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageState>
    );
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
      <PageHeader
        title="Controlled Substances"
        description={`${totalCount} register${totalCount !== 1 ? 's' : ''}`}
        actions={(
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </Button>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          {VIEW_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="font-mono text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by substance name..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9 font-mono text-sm"
          />
        </div>

        <Select value={location || 'all'} onValueChange={handleLocationChange}>
          <SelectTrigger className="w-full lg:w-[200px] font-mono text-sm">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
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
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {registers.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {registers.map((register, index) => (
            <ControlledRegisterCard
              key={register.id}
              register={register}
              index={index}
              onClick={() => handleClick(register.id)}
              onDispense={() => handleDispense(register.id)}
              onCount={() => handleCount(register.id)}
              onWastage={() => handleWastage(register.id)}
            />
          ))}
        </div>
      ) : (
        <div className="bg-card/50 border rounded-2xl p-12 text-center">
          <Shield className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <h3 className="font-display text-xl mb-2">No Registers Found</h3>
          <p className="text-muted-foreground text-sm">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'No controlled substance registers available'}
          </p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
      </div>
    </PageShell>
  );
}
