import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Building from 'lucide-react/dist/esm/icons/building.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useClaim, useClaims } from '@/features/billing/hooks';
import { BillingPagination } from '@/features/billing/components/BillingPagination';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useRouteTableState } from '@/shared/hooks/useRouteTableState';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

const LEGACY_STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'partially_approved', label: 'Partially Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'paid', label: 'Paid' },
];

const RUST_V2_STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'remitted', label: 'Remitted' },
  { value: 'rejected', label: 'Rejected' },
];

const CLAIM_STATUS_BADGES = {
  draft: { class: 'bg-muted text-muted-foreground', label: 'Draft', icon: Clock },
  submitted: { class: 'badge-chronicle-sky', label: 'Submitted', icon: Send },
  pending: { class: 'badge-chronicle-amber', label: 'Pending', icon: Clock },
  approved: { class: 'badge-chronicle-emerald', label: 'Approved', icon: CheckCircle },
  partially_approved: { class: 'badge-chronicle-sky', label: 'Partial', icon: CheckCircle },
  rejected: { class: 'badge-chronicle-rose', label: 'Rejected', icon: XCircle },
  paid: { class: 'badge-chronicle-emerald', label: 'Paid', icon: CheckCircle },
};

function getClaimStatusBadge(status) {
  return CLAIM_STATUS_BADGES[status] || { class: 'bg-muted text-muted-foreground', label: status, icon: Clock };
}

export default function ClaimsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rustV2Mode = isRustV2ApiMode();
  const statusOptions = rustV2Mode ? RUST_V2_STATUS_OPTIONS : LEGACY_STATUS_OPTIONS;
  const targetClaimId = searchParams.get('claim') || null;

  // Filters from URL
  const urlSearch = searchParams.get('search') || '';
  const [privateFilters, setPrivateFilters] = useRouteTableState('billing:claimsPrivateFilters', {
    search: '',
  });
  const [search, setSearch] = useState(privateFilters.search || urlSearch);
  const rawStatus = searchParams.get('status') || 'all';
  const status = statusOptions.some((option) => option.value === rawStatus) ? rawStatus : 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Debounced search
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    if (!urlSearch) return;
    setPrivateFilters((current) => ({
      ...current,
      search: current.search || urlSearch,
    }));
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('search');
      return params;
    }, { replace: true });
  }, [setPrivateFilters, setSearchParams, urlSearch]);

  useEffect(() => {
    if (rawStatus === status) return;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('status');
      params.set('page', '1');
      return params;
    });
  }, [rawStatus, setSearchParams, status]);

  // Build query params using debounced search
  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== 'all' && { status }),
  };

  const {
    data: claimsData,
    isLoading,
    error,
    refetch,
  } = useClaims(queryParams);
  const {
    data: targetClaim,
    isLoading: targetClaimLoading,
    error: targetClaimError,
  } = useClaim(targetClaimId);

  const claims = claimsData?.results || [];
  const totalCount = claimsData?.count || 0;

  const claimColumns = [
    {
      key: 'claim_number',
      header: 'Claim #',
      width: '180px',
      render: (claim) => (
        <span className="font-mono text-sm font-medium text-primary">
          {claim.claim_number}
        </span>
      ),
    },
    {
      key: 'patient',
      header: 'Patient',
      width: '220px',
      render: (claim) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{claim.patient_name}</p>
          <p className="truncate text-xs text-muted-foreground">{claim.invoice_number || 'No invoice linked'}</p>
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Insurer',
      width: '180px',
      render: (claim) => (
        <span className="truncate text-sm text-muted-foreground">
          {claim.insurance_provider || '—'}
        </span>
      ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      width: '160px',
      render: (claim) => (
        <span className="font-mono text-sm text-muted-foreground">
          {formatDate(claim.submitted_at || claim.created_at)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '160px',
      render: (claim) => {
        const statusMap = {
          draft: 'border-border bg-muted text-muted-foreground',
          submitted: 'border-sky-200 bg-sky-50 text-sky-700',
          pending: 'border-amber-200 bg-amber-50 text-amber-700',
          approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
          partially_approved: 'border-sky-200 bg-sky-50 text-sky-700',
          rejected: 'border-rose-200 bg-rose-50 text-rose-700',
          paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        };
        return (
          <Badge variant="outline" className={cn('text-xs capitalize', statusMap[claim.status] || statusMap.draft)}>
            {(claim.status || 'draft').replaceAll('_', ' ')}
          </Badge>
        );
      },
    },
    {
      key: 'amounts',
      header: 'Amounts',
      width: '180px',
      render: (claim) => (
        <div className="text-right">
          <p className="font-mono text-sm font-semibold text-foreground">
            {formatCurrency(claim.claimed_amount)}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            Approved: {formatCurrency(claim.approved_amount || 0)}
          </p>
        </div>
      ),
    },
  ];

  // Update search input
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);
    setPrivateFilters({ search: value });
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('search');
      params.set('page', '1');
      return params;
    });
  };

  const handleStatusChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value !== 'all') {
        params.set('status', value);
      } else {
        params.delete('status');
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

  // Loading state
  if (isLoading) {
    return (
      <PageState variant="loading">
        <Skeleton className="h-12 w-64" />
        <div className="flex gap-4">
          <Skeleton className="h-10 flex-1 max-w-md" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
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
        title="Error Loading Claims"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Insurance Claims"
        description={`${totalCount} claim${totalCount !== 1 ? 's' : ''} found`}
        actions={(
          <Button
            variant="outline"
            onClick={() => refetch()}
            className="font-mono text-xs w-full sm:w-auto"
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </Button>
        )}
      />

      <div className="p-4 sm:px-6 bg-card/50 border-b border-border">
        <TargetClaimPanel
          claim={targetClaim}
          error={targetClaimError}
          isLoading={targetClaimLoading}
          targetClaimId={targetClaimId}
        />
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by claim number or patient..."
              value={search}
              onChange={handleSearchChange}
              className="pl-9 font-mono text-sm"
            />
          </div>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-full sm:w-[180px] font-mono text-sm">
              <Filter className="size-4 mr-2 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className="font-mono text-sm">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Claims List */}
      <main className="p-4 sm:p-6">
        {claims.length > 0 ? (
          <div className="overflow-x-auto">
            <VirtualizedTable
              rows={claims}
              rowKey={(claim) => claim.id}
              rowHeight={68}
              columns={claimColumns}
              getRowClassName={(claim) => (
                claim.id === targetClaimId ? 'ring-2 ring-primary/50 bg-primary/5' : undefined
              )}
              onRowClick={(claim) => navigate(`/billing/claims?claim=${claim.id}`)}
              rowClassName="hover:bg-muted/30"
              className="min-w-[1080px]"
              headerClassName="bg-muted/50 border-b border-border"
            />
          </div>
        ) : (
          <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
            <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <FileSpreadsheet className="size-8 text-muted-foreground" />
            </div>
            <h3 className="font-display text-xl text-foreground mb-2">No Claims Found</h3>
            <p className="text-muted-foreground text-sm">
              {search || status !== 'all'
                ? 'Try adjusting your filters'
                : 'Claims are generated from invoices with insurance coverage'}
            </p>
          </div>
        )}

        <BillingPagination
          canJumpToPage={!rustV2Mode}
          data={claimsData}
          itemLabel="claims"
          onPageChange={handlePageChange}
          page={page}
          pageSize={20}
        />
      </main>
    </PageShell>
  );
}

function TargetClaimPanel({ claim, error, isLoading, targetClaimId }) {
  if (!targetClaimId) return null;

  if (isLoading) {
    return (
      <section className="mb-4 rounded-xl border border-border bg-card px-4 py-3" data-omni-target="true">
        <Skeleton className="h-5 w-48" />
      </section>
    );
  }

  if (error || !claim) {
    return (
      <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200" data-omni-target="true">
        Claim unavailable.
      </section>
    );
  }

  const badge = getClaimStatusBadge(claim.status);
  return (
    <section className="mb-4 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3" data-omni-target="true">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Target Claim</p>
          <p className="truncate font-medium text-foreground">{claim.claim_number || targetClaimId}</p>
          <p className="truncate text-sm text-muted-foreground">{claim.patient_name || claim.patient_mrn || 'Patient claim'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('text-xs capitalize', badge.class)}>
            {(claim.status || 'draft').replaceAll('_', ' ')}
          </Badge>
          <span className="font-mono text-sm text-foreground">{formatCurrency(claim.claimed_amount)}</span>
        </div>
      </div>
    </section>
  );
}

function ClaimCard({ claim, index, onClick }) {
  const badge = getClaimStatusBadge(claim.status);
  const StatusIcon = badge.icon;
  return (
    <button
      type="button"
      className={cn(
        'group relative w-full text-left bg-card border border-border rounded-xl p-4 sm:p-5',
        'hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]',
        'transition-all duration-300 cursor-pointer',
        'animate-chronicle-enter'
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Claim Header */}
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="size-4 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-sm text-primary font-medium">
              {claim.claim_number}
            </span>
            <span className={cn('text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded flex items-center gap-1', badge.class)}>
              <StatusIcon className="size-3" />
              {badge.label}
            </span>
          </div>

          {/* Patient & Insurance */}
          <h3 className="font-display text-lg sm:text-xl text-foreground truncate mb-2">
            {claim.patient_name}
          </h3>

          {/* Meta Info */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {claim.insurance_provider && (
              <span className="flex items-center gap-1.5">
                <Building className="size-3" />
                {claim.insurance_provider}
              </span>
            )}
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <Calendar className="size-3" />
              {formatDate(claim.submitted_at || claim.created_at)}
            </span>
            {claim.invoice_number && (
              <span className="font-mono text-xs text-muted-foreground">
                Invoice: {claim.invoice_number}
              </span>
            )}
          </div>
        </div>

        {/* Amount */}
        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 pt-3 sm:pt-0 border-t sm:border-t-0 border-border sm:pl-4">
          <div className="text-right">
            <p className="font-mono text-xs text-muted-foreground mb-1">Claimed</p>
            <p className="font-mono text-lg sm:text-xl text-foreground font-medium">
              {formatCurrency(claim.claimed_amount)}
            </p>
            {claim.approved_amount !== null && claim.approved_amount !== undefined && (
              <div className="mt-1">
                <p className="font-mono text-xs text-muted-foreground">Approved</p>
                <p className="font-mono text-sm text-[oklch(0.70_0.17_155)]">
                  {formatCurrency(claim.approved_amount)}
                </p>
              </div>
            )}
          </div>
          <ChevronRight className="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block" />
        </div>
      </div>
    </button>
  );
}

// Utility functions
function formatCurrency(amount) {
  return GHS_CURRENCY_FORMATTER.format(amount || 0);
}

function formatDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
