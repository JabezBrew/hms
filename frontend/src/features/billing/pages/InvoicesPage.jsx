import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import X from 'lucide-react/dist/esm/icons/x.js';
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
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BillingPagination } from '@/features/billing/components/BillingPagination';
import { useInvoices } from '@/features/billing/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useRouteTableState } from '@/shared/hooks/useRouteTableState';
import { createReturnToLocation } from '@/shared/lib/returnTo';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';

import { usePatient } from '@/features/patients/hooks/usePatientQueries';
import PatientContextPanel from '@/components/patients/PatientContextPanel';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

const LEGACY_STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

const RUST_V2_STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'issued', label: 'Issued' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

const STATUS_STYLES = {
  issued: 'border-amber-200 bg-amber-50 text-amber-700',
  draft: 'border-border bg-muted text-muted-foreground',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  partially_paid: 'border-sky-200 bg-sky-50 text-sky-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-700',
  cancelled: 'border-border bg-muted text-muted-foreground',
  void: 'border-border bg-muted text-muted-foreground',
};

function useInvoiceFilters({ statusOptions }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const urlSearch = searchParams.get('search') || '';
  const urlPatientId = searchParams.get('patient') || '';
  const [privateFilters, setPrivateFilters] = useRouteTableState('billing:invoicesPrivateFilters', {
    search: urlSearch,
    patientId: urlPatientId,
  });
  const [search, setSearch] = useState(privateFilters.search || urlSearch);

  const rawStatus = searchParams.get('status') || 'all';
  const status = statusOptions.some((option) => option.value === rawStatus) ? rawStatus : 'all';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const patientId = privateFilters.patientId || '';
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    if (!urlSearch && !urlPatientId) return;
    const nextPrivateFilters = {
      ...privateFilters,
      search: privateFilters.search || urlSearch,
      patientId: privateFilters.patientId || urlPatientId,
    };
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete('search');
    nextParams.delete('patient');
    const nextSearch = nextParams.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`, {
      replace: true,
      state: {
        ...(location.state || {}),
        'billing:invoicesPrivateFilters': nextPrivateFilters,
      },
      preventScrollReset: true,
    });
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    privateFilters,
    urlPatientId,
    urlSearch,
  ]);

  useEffect(() => {
    if (rawStatus === status) return;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('status');
      params.set('page', '1');
      return params;
    });
  }, [rawStatus, setSearchParams, status]);

  const handleDateRangeChange = ({ from, to }) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('search');
      params.delete('patient');
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

  const handleStatusChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('search');
      params.delete('patient');
      if (value !== 'all') {
        params.set('status', value);
      } else {
        params.delete('status');
      }
      params.set('page', '1');
      return params;
    });
  };

  const handleSearchChange = (value) => {
    setSearch(value);
    setPrivateFilters({ search: value });
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('search');
      params.delete('patient');
      params.set('page', '1');
      return params;
    });
  };

  const handlePageChange = (newPage) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('search');
      params.delete('patient');
      params.set('page', newPage.toString());
      return params;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setPrivateFilters({ search: '', patientId: '' });
    setSearchParams({});
  };

  const clearPatientFilter = () => {
    setPrivateFilters({ patientId: '' });
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('search');
      params.delete('patient');
      params.set('page', '1');
      return params;
    });
  };

  return {
    search,
    status,
    dateFrom,
    dateTo,
    page,
    patientId,
    queryParams: {
      page,
      page_size: 20,
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(status !== 'all' && { status }),
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
      ...(patientId && { patient: patientId }),
    },
    hasActiveFilters: Boolean(patientId || status !== 'all' || dateFrom || dateTo || debouncedSearch),
    handleSearchChange,
    handleDateRangeChange,
    handleStatusChange,
    handlePageChange,
    clearFilters,
    clearPatientFilter,
  };
}

function useFilteredPatientName(patientId) {
  const { data: patient, isError } = usePatient(patientId, { enabled: !!patientId });

  if (!patientId) {
    return '';
  }
  if (isError) {
    return 'Patient';
  }
  if (!patient) {
    return '';
  }

  return patient?.user_details
    ? `${patient.user_details.first_name || ''} ${patient.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';
}

function InvoicesLoadingState() {
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

function InvoicesHeader({
  totalCount,
  patientId,
  patientName,
  onClearPatientFilter,
  onCreateInvoice,
}) {
  return (
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
                onClick={onClearPatientFilter}
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
          onClick={onCreateInvoice}
          className="font-mono text-xs w-full sm:w-auto"
        >
          <Plus className="size-4 mr-2" />
          New Invoice
        </Button>
      )}
    />
  );
}

function InvoiceFilters({
  search,
  status,
  statusOptions,
  dateFrom,
  dateTo,
  hasActiveFilters,
  onSearchChange,
  onStatusChange,
  onDateRangeChange,
  onClearFilters,
}) {
  return (
    <div className="p-4 sm:px-6 bg-card/50 border-b border-border">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by invoice number or patient..."
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="pl-9 font-mono text-sm"
            />
          </div>
          <Select value={status} onValueChange={onStatusChange}>
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

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">Date Range:</span>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              from={dateFrom ? parseISO(dateFrom) : null}
              to={dateTo ? parseISO(dateTo) : null}
              onChange={onDateRangeChange}
              pickerClassName="w-[140px] font-mono text-xs"
            />
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearFilters}
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function createInvoiceColumns({ onOpenInvoice, onPatientContext }) {
  return [
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
      render: (invoice) => (
        <Badge variant="outline" className={cn('text-xs capitalize', STATUS_STYLES[invoice.status] || STATUS_STYLES.draft)}>
          {(invoice.status || 'draft').replaceAll('_', ' ')}
        </Badge>
      ),
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
              onPatientContext(invoice);
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
              onOpenInvoice(invoice.id);
            }}
          >
            View
          </Button>
        </div>
      ),
    },
  ];
}

function InvoicesTable({ invoices, columns, hasActiveFilters, onOpenInvoice, onCreateInvoice }) {
  if (invoices.length === 0) {
    return (
      <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <FileText className="size-8 text-muted-foreground" />
        </div>
        <h3 className="font-display text-xl text-foreground mb-2">No Invoices Found</h3>
        <p className="text-muted-foreground text-sm mb-4">
          {hasActiveFilters
            ? 'Try adjusting your filters'
            : 'Create your first invoice to get started'}
        </p>
        {!hasActiveFilters && (
          <Button onClick={onCreateInvoice} className="font-mono text-xs">
            <Plus className="size-4 mr-2" />
            Create Invoice
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={invoices}
        rowKey={(invoice) => invoice.id}
        rowHeight={68}
        columns={columns}
        onRowClick={(invoice) => onOpenInvoice(invoice.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[1120px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

export default function InvoicesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const rustV2Mode = isRustV2ApiMode();
  const statusOptions = rustV2Mode ? RUST_V2_STATUS_OPTIONS : LEGACY_STATUS_OPTIONS;
  const [contextOpen, setContextOpen] = useState(false);
  const [contextInvoice, setContextInvoice] = useState(null);
  const {
    search,
    status,
    dateFrom,
    dateTo,
    page,
    patientId,
    queryParams,
    hasActiveFilters,
    handleSearchChange,
    handleDateRangeChange,
    handleStatusChange,
    handlePageChange,
    clearFilters,
    clearPatientFilter,
  } = useInvoiceFilters({ statusOptions });
  const patientName = useFilteredPatientName(patientId);

  const {
    data: invoicesData,
    isLoading,
    error,
    refetch,
  } = useInvoices(queryParams);

  const invoices = invoicesData?.results || [];
  const totalCount = invoicesData?.count || 0;

  const handlePatientContext = (invoice) => {
    setContextInvoice(invoice);
    setContextOpen(true);
  };
  const handleOpenInvoice = (invoiceId) => navigate(`/billing/invoices/${invoiceId}`, {
    state: {
      returnTo: createReturnToLocation(location),
    },
  });
  const handleCreateInvoice = () => navigate('/billing/invoices/new');
  const invoiceColumns = createInvoiceColumns({
    onOpenInvoice: handleOpenInvoice,
    onPatientContext: handlePatientContext,
  });

  // Loading state
  if (isLoading) {
    return <InvoicesLoadingState />;
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
      <InvoicesHeader
        totalCount={totalCount}
        patientId={patientId}
        patientName={patientName}
        onClearPatientFilter={clearPatientFilter}
        onCreateInvoice={handleCreateInvoice}
      />

      <InvoiceFilters
        search={search}
        status={status}
        statusOptions={statusOptions}
        dateFrom={dateFrom}
        dateTo={dateTo}
        hasActiveFilters={hasActiveFilters}
        onSearchChange={handleSearchChange}
        onStatusChange={handleStatusChange}
        onDateRangeChange={handleDateRangeChange}
        onClearFilters={clearFilters}
      />

      {/* Invoice List */}
      <main className="p-4 sm:p-6">
        <InvoicesTable
          invoices={invoices}
          columns={invoiceColumns}
          hasActiveFilters={hasActiveFilters}
          onOpenInvoice={handleOpenInvoice}
          onCreateInvoice={handleCreateInvoice}
        />

        <BillingPagination
          canJumpToPage={!rustV2Mode}
          data={invoicesData}
          itemLabel="invoices"
          page={page}
          pageSize={20}
          onPageChange={handlePageChange}
        />
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
