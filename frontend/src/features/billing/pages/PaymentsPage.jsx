import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { VirtualizedTable } from '@/components/ui/VirtualizedTable';
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
import { BillingPagination } from '@/features/billing/components/BillingPagination';
import { usePayments } from '@/features/billing/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { useReceiptPrint } from '@/hooks/useReceiptPrint';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useRouteTableState } from '@/shared/hooks/useRouteTableState';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

const LEGACY_PAYMENT_METHODS = [
  { value: 'all', label: 'All Methods' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'insurance', label: 'Insurance' },
];

const RUST_V2_PAYMENT_METHODS = [
  { value: 'all', label: 'All Methods' },
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
];

const PAYMENTS_PAGE_SIZE = 20;

function getPaymentColumns({ navigate, printReceipt, printingId }) {
  return [
    {
      key: 'date',
      header: 'Date',
      width: '160px',
      render: (payment) => (
        <div>
          <p className="font-mono text-sm text-foreground">
            {formatDate(payment.payment_date)}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {formatTime(payment.created_at)}
          </p>
        </div>
      ),
    },
    {
      key: 'patient',
      header: 'Patient',
      width: '200px',
      render: (payment) => (
        <button
          type="button"
          onClick={() => navigate(`/patients/${payment.patient_id}`)}
          className="text-left hover:text-primary transition-colors"
        >
          <p className="text-sm text-foreground">{payment.patient_name}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {payment.patient_mrn}
          </p>
        </button>
      ),
    },
    {
      key: 'invoice',
      header: 'Invoice',
      width: '160px',
      render: (payment) => (
        <button
          type="button"
          onClick={() => navigate(`/billing/invoices/${payment.invoice}`)}
          className="font-mono text-xs text-primary hover:underline"
        >
          {payment.invoice_number}
        </button>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      width: '120px',
      render: (payment) => (
        <span className="font-mono text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
          {formatPaymentMethod(payment.payment_method)}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (payment) => (
        <span className="font-mono text-sm text-[oklch(0.70_0.17_155)]">
          +{formatCurrency(payment.amount)}
        </span>
      ),
    },
    {
      key: 'receipt',
      header: 'Receipt',
      width: '140px',
      render: (payment) => (
        payment.receipt_number ? (
          <div className="flex items-center gap-1">
            <FileText className="size-3 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">
              {payment.receipt_number}
            </span>
          </div>
        ) : (
          <span className="font-mono text-xs text-muted-foreground/50">-</span>
        )
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (payment) => (
        payment.receipt_number ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => printReceipt(payment)}
            disabled={printingId === payment.id}
            className="font-mono text-xs h-8 px-2"
          >
            {printingId === payment.id ? (
              <>
                <LoadingSpinner className="size-3 mr-1" />
                Loading…
              </>
            ) : (
              <>
                <Printer className="size-3 mr-1" />
                Print
              </>
            )}
          </Button>
        ) : null
      ),
    },
  ];
}

export default function PaymentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rustV2Mode = isRustV2ApiMode();
  const paymentMethodOptions = rustV2Mode ? RUST_V2_PAYMENT_METHODS : LEGACY_PAYMENT_METHODS;

  // Get filter values from URL
  const currentPage = parseInt(searchParams.get('page') || '1', 10);
  const rawPaymentMethod = searchParams.get('payment_method') || 'all';
  const paymentMethod = paymentMethodOptions.some((option) => option.value === rawPaymentMethod)
    ? rawPaymentMethod
    : 'all';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  // Local state for search input
  const urlSearch = searchParams.get('search') || '';
  const [privateFilters, setPrivateFilters] = useRouteTableState('billing:paymentsPrivateFilters', {
    search: '',
  });
  const [search, setSearch] = useState(privateFilters.search || urlSearch);

  // Debounce search value
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
    if (rawPaymentMethod === paymentMethod) return;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('payment_method');
      params.set('page', '1');
      return params;
    });
  }, [paymentMethod, rawPaymentMethod, setSearchParams]);

  // Build filters object for API
  const filters = useMemo(() => {
    const params = { page: currentPage, page_size: PAYMENTS_PAGE_SIZE };
    if (debouncedSearch) params.search = debouncedSearch;
    if (paymentMethod && paymentMethod !== 'all') params.payment_method = paymentMethod;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  }, [currentPage, debouncedSearch, paymentMethod, dateFrom, dateTo]);

  const {
    data: paymentsData,
    isLoading,
    error,
    refetch,
  } = usePayments(filters);

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);
    setPrivateFilters({ search: value });
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      newParams.delete('search');
      newParams.set('page', '1');
      return newParams;
    });
  };

  const handleFilterChange = useCallback((key, value) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      if (value) {
        newParams.set(key, value);
      } else {
        newParams.delete(key);
      }
      newParams.set('page', '1'); // Reset to first page on filter change
      return newParams;
    });
  }, [setSearchParams]);

  const handlePageChange = useCallback((newPage) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      newParams.set('page', newPage.toString());
      return newParams;
    });
  }, [setSearchParams]);

  // Receipt printing hook
  const { printReceipt, printingId } = useReceiptPrint();

  const columns = useMemo(
    () => getPaymentColumns({ navigate, printReceipt, printingId }),
    [navigate, printReceipt, printingId]
  );

  // Pagination calculations
  const payments = paymentsData?.results || [];
  const totalCount = paymentsData?.count || 0;
  const hasActiveFilters = Boolean(debouncedSearch || (paymentMethod && paymentMethod !== 'all') || dateFrom || dateTo);

  const handleClearFilters = () => {
    setSearch('');
    setPrivateFilters({ search: '' });
    setSearchParams({});
  };

  if (isLoading && !paymentsData) {
    return <PaymentsLoadingState />;
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Payments"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <PaymentsPageHeader
        totalCount={totalCount}
        onBack={() => navigate('/billing')}
        onRefresh={refetch}
      />

      <main className="p-4 sm:p-6 space-y-6">
        <PaymentsFilters
          search={search}
          paymentMethod={paymentMethod}
          paymentMethodOptions={paymentMethodOptions}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onSearchChange={handleSearchChange}
          onFilterChange={handleFilterChange}
        />
        <PaymentsTableSection
          payments={payments}
          paymentsData={paymentsData}
          canJumpToPage={!rustV2Mode}
          columns={columns}
          currentPage={currentPage}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={handleClearFilters}
          onPageChange={handlePageChange}
        />
      </main>
    </PageShell>
  );
}

function PaymentsLoadingState() {
  return (
    <PageState variant="loading">
      <Skeleton className="h-12 w-64" />
      <div className="flex gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="space-y-2">
        {[...Array(10)].map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </PageState>
  );
}

function PaymentsPageHeader({ totalCount, onBack, onRefresh }) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <CreditCard className="size-8 text-primary" />
          Payment History
        </span>
      )}
      description={`${totalCount} payment${totalCount !== 1 ? 's' : ''} found`}
      actions={(
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          className="font-mono text-xs"
        >
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      )}
    >
      <div className="mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="font-mono text-xs w-fit -ml-2"
        >
          <ArrowLeft className="size-4 mr-2" />
          Back to Billing
        </Button>
      </div>
    </PageHeader>
  );
}

function PaymentsFilters({
  search,
  paymentMethod,
  paymentMethodOptions,
  dateFrom,
  dateTo,
  onSearchChange,
  onFilterChange,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Filter className="size-5 text-muted-foreground" />
        <h2 className="font-display text-lg text-foreground">Filters</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by patient, invoice, receipt..."
            value={search}
            onChange={onSearchChange}
            className="pl-10 font-mono text-sm"
          />
        </div>

        <Select
          value={paymentMethod}
          onValueChange={(value) => onFilterChange('payment_method', value)}
        >
          <SelectTrigger className="font-mono text-sm">
            <SelectValue placeholder="Payment Method" />
          </SelectTrigger>
          <SelectContent>
            {paymentMethodOptions.map((method) => (
              <SelectItem key={method.value} value={method.value}>
                {method.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            type="date"
            placeholder="From Date"
            value={dateFrom}
            onChange={(e) => onFilterChange('date_from', e.target.value)}
            className="pl-10 font-mono text-sm"
          />
        </div>

        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            type="date"
            placeholder="To Date"
            value={dateTo}
            onChange={(e) => onFilterChange('date_to', e.target.value)}
            className="pl-10 font-mono text-sm"
          />
        </div>
      </div>
    </section>
  );
}

function PaymentsTableSection({
  payments,
  paymentsData,
  canJumpToPage,
  columns,
  currentPage,
  hasActiveFilters,
  onClearFilters,
  onPageChange,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      {payments.length === 0 ? (
        <PaymentsEmptyState
          hasActiveFilters={hasActiveFilters}
          onClearFilters={onClearFilters}
        />
      ) : (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={payments}
            rowKey={(payment) => payment.id}
            rowHeight={72}
            columns={columns}
            className="min-w-[920px]"
            headerClassName="font-mono text-xs uppercase tracking-wider text-muted-foreground"
            rowClassName="hover:bg-muted/20 transition-colors"
          />
        </div>
      )}

      <div className="px-4 sm:px-6">
        <BillingPagination
          canJumpToPage={canJumpToPage}
          data={paymentsData}
          itemLabel="payments"
          page={currentPage}
          pageSize={PAYMENTS_PAGE_SIZE}
          onPageChange={onPageChange}
        />
      </div>
    </section>
  );
}

function PaymentsEmptyState({ hasActiveFilters, onClearFilters }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="flex flex-col items-center">
        <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <CreditCard className="size-6 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">No payments found</p>
        {hasActiveFilters && (
          <Button
            variant="link"
            onClick={onClearFilters}
            className="font-mono text-xs mt-2"
          >
            Clear filters
          </Button>
        )}
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

function formatTime(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPaymentMethod(method) {
  const methods = {
    cash: 'Cash',
    credit_card: 'Card',
    debit_card: 'Debit',
    bank_transfer: 'Bank',
    mobile_money: 'MoMo',
    insurance: 'Insurance',
    other: 'Other',
  };
  return methods[method] || method;
}
