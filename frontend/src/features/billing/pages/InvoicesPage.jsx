import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useState, useEffect } from 'react';
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
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useInvoices } from '@/features/billing/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';

import { patientsApi } from '@/features/patients/api';
import PatientContextPanel from '@/components/patients/PatientContextPanel';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

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
  const [contextOpen, setContextOpen] = useState(false);
  const [contextInvoice, setContextInvoice] = useState(null);

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

  const invoiceColumns = [
    {
      key: 'invoice',
      header: 'Invoice #',
      width: '180px',
      render: (invoice) => (
        <span className="font-mono text-sm font-medium text-primary">
          {invoice.invoice_number || invoice.number}
        </span>
      ),
    },
    {
      key: 'patient',
      header: 'Patient',
      width: '220px',
      render: (invoice) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{invoice.patient_name || 'Unknown Patient'}</p>
          <p className="truncate text-xs text-muted-foreground">{invoice.invoice_type_display || invoice.invoice_type || 'Invoice'}</p>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Issued',
      width: '160px',
      render: (invoice) => (
        <span className="font-mono text-sm text-muted-foreground">
          {formatDate(invoice.issued_at || invoice.created_at)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (invoice) => {
        const statusStyles = {
          draft: 'border-border bg-muted text-muted-foreground',
          pending: 'border-amber-200 bg-amber-50 text-amber-700',
          partially_paid: 'border-sky-200 bg-sky-50 text-sky-700',
          paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
          overdue: 'border-rose-200 bg-rose-50 text-rose-700',
          cancelled: 'border-border bg-muted text-muted-foreground',
        };
        return (
          <Badge variant="outline" className={cn('text-xs capitalize', statusStyles[invoice.status] || statusStyles.draft)}>
            {(invoice.status || 'draft').replaceAll('_', ' ')}
          </Badge>
        );
      },
    },
    {
      key: 'amounts',
      header: 'Amounts',
      width: '180px',
      render: (invoice) => (
        <div className="text-right">
          <p className="font-mono text-sm font-semibold text-foreground">
            {formatCurrency(invoice.total_amount || invoice.amount || 0)}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            Balance: {formatCurrency(invoice.balance_due || invoice.balance || 0)}
          </p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '160px',
      render: (invoice) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              handlePatientContext(invoice);
            }}
          >
            Patient
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/billing/invoices/${invoice.id}`);
            }}
          >
            View
          </Button>
        </div>
      ),
    },
  ];

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

  const handlePatientContext = (invoice) => {
    setContextInvoice(invoice);
    setContextOpen(true);
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
        title="Error Loading Invoices"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Invoices"
        description={(
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground">
              {totalCount} invoice{totalCount !== 1 ? 's' : ''} found
            </p>
            {patientId && patientName && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono">
                <User className="size-3" />
                {patientName}
                <button
                  type="button"
                  onClick={clearPatientFilter}
                  className="ml-0.5 hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                  title="Clear patient filter"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
          </div>
        )}
        actions={(
          <Button
            onClick={() => navigate('/billing/invoices/new')}
            className="font-mono text-xs w-full sm:w-auto"
          >
            <Plus className="size-4 mr-2" />
            New Invoice
          </Button>
        )}
      />

      {/* Filters */}
      <div className="p-4 sm:px-6 bg-card/50 border-b border-border">
        <div className="flex flex-col gap-3">
          {/* First row: Search and Status */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by invoice number or patient..."
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
          <div className="overflow-x-auto">
            <VirtualizedTable
              rows={invoices}
              rowKey={(invoice) => invoice.id}
              rowHeight={68}
              columns={invoiceColumns}
              onRowClick={(invoice) => navigate(`/billing/invoices/${invoice.id}`)}
              rowClassName="hover:bg-muted/30"
              className="min-w-[1120px]"
              headerClassName="bg-muted/50 border-b border-border"
            />
          </div>
        ) : (
          <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
            <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <FileText className="size-8 text-muted-foreground" />
            </div>
            <h3 className="font-display text-xl text-foreground mb-2">No Invoices Found</h3>
            <p className="text-muted-foreground text-sm mb-4">
              {search || status !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first invoice to get started'}
            </p>
            {!search && status === 'all' && (
              <Button onClick={() => navigate('/billing/invoices/new')} className="font-mono text-xs">
                <Plus className="size-4 mr-2" />
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
                <ChevronLeft className="size-4 mr-1" />
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
                <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </main>

      <PatientContextPanel
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        mode="billing"
        patientId={contextInvoice?.patient}
        patientName={contextInvoice?.patient_name}
        patientMrn={contextInvoice?.patient_mrn}
      />
    </PageShell>
  );
}

function InvoiceCard({ invoice, index, onClick, onPatientContext }) {
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
  const handleCardKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick();
  };

  return (
    <div
      className={cn(
        "group relative bg-card border border-border rounded-xl p-4 sm:p-5",
        "hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]",
        "transition-all duration-300 cursor-pointer",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`View invoice ${invoice.invoice_number}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Invoice Header */}
          <div className="flex items-center gap-2 mb-2">
            <FileText className="size-4 text-muted-foreground flex-shrink-0" />
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
              <Calendar className="size-3" />
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
            <Button
              variant="ghost"
              size="sm"
              className="font-mono text-xs"
              onClick={(event) => {
                event.stopPropagation();
                onPatientContext?.(invoice);
              }}
            >
              Patient
            </Button>
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
          <ChevronRight className="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block" />
        </div>
      </div>
    </div>
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
