import { useState, useEffect } from 'react';
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
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useInvoices } from '@/hooks/useBillingQueries';
import { useDebounce } from '@/hooks/use-debounce';
import { format, parseISO } from 'date-fns';
import {
  FileText,
  Search,
  Plus,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  RefreshCw,
  Filter,
  Calendar,
  User,
  X,
} from 'lucide-react';
import { patientsApi } from '@/lib/api/patients';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters from URL
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const status = searchParams.get('status') || 'all';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const patientId = searchParams.get('patient') || '';

  // Patient info for display when filtering by patient
  const [patientName, setPatientName] = useState('');

  // Fetch patient name when filtering by patient
  useEffect(() => {
    if (patientId) {
      patientsApi.getPatient(patientId)
        .then((patient) => {
          const name = patient?.user_details
            ? `${patient.user_details.first_name || ''} ${patient.user_details.last_name || ''}`.trim()
            : patient?.name || 'Patient';
          setPatientName(name);
        })
        .catch(() => setPatientName('Patient'));
    } else {
      setPatientName('');
    }
  }, [patientId]);

  // Debounced search
  const debouncedSearch = useDebounce(search, 300);

  // Handle date range change - only called when both dates are selected or both cleared
  const handleDateRangeChange = ({ from, to }) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (from && to) {
        params.set('date_from', format(from, 'yyyy-MM-dd'));
        params.set('date_to', format(to, 'yyyy-MM-dd'));
      } else {
        params.delete('date_from');
        params.delete('date_to');
      }
      params.set('page', '1');
      return params;
    });
  };

  // Build query params
  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== 'all' && { status }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
    ...(patientId && { patient: patientId }),
  };

  const {
    data: invoicesData,
    isLoading,
    error,
    refetch,
  } = useInvoices(queryParams);

  const invoices = invoicesData?.results || [];
  const totalCount = invoicesData?.count || 0;
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


  const clearFilters = () => {
    setSearch('');
    setSearchParams({});
  };

  const clearPatientFilter = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('patient');
      params.set('page', '1');
      return params;
    });
  };

  const hasActiveFilters = status !== 'all' || dateFrom || dateTo || debouncedSearch || patientId;

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
          <h2 className="font-display text-2xl text-foreground">Error Loading Invoices</h2>
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
              Invoices
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <p className="text-muted-foreground">
                {totalCount} invoice{totalCount !== 1 ? 's' : ''} found
              </p>
              {patientId && patientName && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono">
                  <User className="h-3 w-3" />
                  {patientName}
                  <button
                    onClick={clearPatientFilter}
                    className="ml-0.5 hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                    title="Clear patient filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
          </div>
          <Button
            onClick={() => navigate('/billing/invoices/new')}
            className="font-mono text-xs w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        </div>
      </header>

      {/* Filters */}
      <div className="px-4 sm:px-6 py-4 bg-card/50 border-b border-border">
        <div className="flex flex-col gap-3">
          {/* First row: Search and Status */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by invoice number or patient..."
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

          {/* Second row: Date filters */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">Date Range:</span>
            <div className="flex flex-wrap items-center gap-2">
              <DateRangePicker
                from={dateFrom ? parseISO(dateFrom) : null}
                to={dateTo ? parseISO(dateTo) : null}
                onChange={handleDateRangeChange}
                pickerClassName="w-[140px] font-mono text-xs"
              />
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="font-mono text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Invoice List */}
      <main className="p-4 sm:p-6">
        {invoices.length > 0 ? (
          <div className="space-y-3">
            {invoices.map((invoice, index) => (
              <InvoiceCard
                key={invoice.id}
                invoice={invoice}
                index={index}
                onClick={() => navigate(`/billing/invoices/${invoice.id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-display text-xl text-foreground mb-2">No Invoices Found</h3>
            <p className="text-muted-foreground text-sm mb-4">
              {search || status !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first invoice to get started'}
            </p>
            {!search && status === 'all' && (
              <Button onClick={() => navigate('/billing/invoices/new')} className="font-mono text-xs">
                <Plus className="h-4 w-4 mr-2" />
                Create Invoice
              </Button>
            )}
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

function InvoiceCard({ invoice, index, onClick }) {
  const getStatusBadge = (status) => {
    const statusMap = {
      draft: { class: 'bg-muted text-muted-foreground', label: 'Draft' },
      pending: { class: 'badge-chronicle-amber', label: 'Pending' },
      partially_paid: { class: 'badge-chronicle-sky', label: 'Partially Paid' },
      paid: { class: 'badge-chronicle-emerald', label: 'Paid' },
      overdue: { class: 'badge-chronicle-rose', label: 'Overdue' },
      cancelled: { class: 'bg-muted text-muted-foreground line-through', label: 'Cancelled' },
    };
    return statusMap[status] || { class: 'bg-muted text-muted-foreground', label: status };
  };

  const badge = getStatusBadge(invoice.status);

  return (
    <article
      className={cn(
        "group relative bg-card border border-border rounded-xl p-4 sm:p-5",
        "hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]",
        "transition-all duration-300 cursor-pointer",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Invoice Header */}
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-sm text-primary font-medium">
              {invoice.invoice_number}
            </span>
            <span className={cn("text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded", badge.class)}>
              {badge.label}
            </span>
          </div>

          {/* Patient Name */}
          <h3 className="font-display text-lg sm:text-xl text-foreground truncate mb-2">
            {invoice.patient_name}
          </h3>

          {/* Meta Info */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <Calendar className="h-3 w-3" />
              {formatDate(invoice.created_at)}
            </span>
            {invoice.due_date && (
              <span className="flex items-center gap-1.5 font-mono text-xs">
                Due: {formatDate(invoice.due_date)}
              </span>
            )}
            <span className="font-mono text-xs">
              {invoice.items_count || 0} item{invoice.items_count !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Amount */}
        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 pt-3 sm:pt-0 border-t sm:border-t-0 border-border sm:pl-4">
          <div className="text-right">
            <p className="font-mono text-lg sm:text-xl text-foreground font-medium">
              {formatCurrency(invoice.total_amount)}
            </p>
            {invoice.balance_due > 0 && invoice.balance_due !== invoice.total_amount && (
              <p className="font-mono text-xs text-muted-foreground">
                Balance: {formatCurrency(invoice.balance_due)}
              </p>
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
