import { useState } from 'react';
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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useClaims } from '@/hooks/useBillingQueries';
import { useDebounce } from '@/hooks/use-debounce';
import {
  FileSpreadsheet,
  Search,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  RefreshCw,
  Filter,
  Calendar,
  Building,
  Clock,
  CheckCircle,
  XCircle,
  Send,
} from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'partially_approved', label: 'Partially Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'paid', label: 'Paid' },
];

export default function ClaimsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters from URL
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const status = searchParams.get('status') || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Debounced search
  const debouncedSearch = useDebounce(search, 300);

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

  const claims = claimsData?.results || [];
  const totalCount = claimsData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);

  // Update search input
  const handleSearchChange = (e) => {
    setSearch(e.target.value);
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
      <div className="min-h-screen bg-background p-4 sm:p-6 space-y-6">
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
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-2xl text-foreground">Error Loading Claims</h2>
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
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl text-foreground tracking-tight">
              Insurance Claims
            </h1>
            <p className="text-muted-foreground mt-1">
              {totalCount} claim{totalCount !== 1 ? 's' : ''} found
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => refetch()}
            className="font-mono text-xs w-full sm:w-auto"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      {/* Filters */}
      <div className="px-4 sm:px-6 py-4 bg-card/50 border-b border-border">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by claim number or patient..."
              value={search}
              onChange={handleSearchChange}
              className="pl-9 font-mono text-sm"
            />
          </div>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-full sm:w-[180px] font-mono text-sm">
              <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
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
          <div className="space-y-3">
            {claims.map((claim, index) => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                index={index}
                onClick={() => navigate(`/billing/claims/${claim.id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-display text-xl text-foreground mb-2">No Claims Found</h3>
            <p className="text-muted-foreground text-sm">
              {search || status !== 'all'
                ? 'Try adjusting your filters'
                : 'Claims are generated from invoices with insurance coverage'}
            </p>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-6 border-t border-border">
            <p className="font-mono text-xs text-muted-foreground">
              Page {page} of {totalPages}
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
      </main>
    </div>
  );
}

function ClaimCard({ claim, index, onClick }) {
  const getStatusBadge = (status) => {
    const statusMap = {
      draft: { class: 'bg-muted text-muted-foreground', label: 'Draft', icon: Clock },
      submitted: { class: 'badge-chronicle-sky', label: 'Submitted', icon: Send },
      pending: { class: 'badge-chronicle-amber', label: 'Pending', icon: Clock },
      approved: { class: 'badge-chronicle-emerald', label: 'Approved', icon: CheckCircle },
      partially_approved: { class: 'badge-chronicle-sky', label: 'Partial', icon: CheckCircle },
      rejected: { class: 'badge-chronicle-rose', label: 'Rejected', icon: XCircle },
      paid: { class: 'badge-chronicle-emerald', label: 'Paid', icon: CheckCircle },
    };
    return statusMap[status] || { class: 'bg-muted text-muted-foreground', label: status, icon: Clock };
  };

  const badge = getStatusBadge(claim.status);
  const StatusIcon = badge.icon;

  return (
    <article
      className={cn(
        'group relative bg-card border border-border rounded-xl p-4 sm:p-5',
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
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-sm text-primary font-medium">
              {claim.claim_number}
            </span>
            <span className={cn('text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded flex items-center gap-1', badge.class)}>
              <StatusIcon className="h-3 w-3" />
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
                <Building className="h-3 w-3" />
                {claim.insurance_provider}
              </span>
            )}
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <Calendar className="h-3 w-3" />
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
          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block" />
        </div>
      </div>
    </article>
  );
}

// Utility functions
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

function formatDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
