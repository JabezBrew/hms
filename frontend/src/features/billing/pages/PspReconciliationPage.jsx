/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { VirtualizedTable } from '@/components/ui/VirtualizedTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { useUrlEnumParam } from '@/shared/hooks/useUrlEnumParam';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { BillingPagination } from '@/features/billing/components/BillingPagination';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  usePaymentIntents,
  useSettlementBatches,
  useImportSettlement,
  useSettlementLines,
} from '@/features/billing/hooks';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

function formatCurrency(amount) {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return GHS_CURRENCY_FORMATTER.format(Number.isFinite(n) ? n : 0);
}

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatMethod(method) {
  const map = {
    mobile_money: 'MoMo',
    credit_card: 'Credit',
    debit_card: 'Debit',
  };
  return map[method] || method || '—';
}

const SETTLEMENT_TEMPLATE_HEADERS = [
  'provider_reference',
  'client_reference',
  'amount_gross',
  'fee_amount',
  'amount_net',
  'paid_at',
  'status',
];

const PSP_TABS = ['intents', 'settlements'];

const PAYMENT_INTENT_STATUS_META = {
  pending: { cls: 'badge-chronicle-amber', label: 'Pending', icon: Clock },
  succeeded: { cls: 'badge-chronicle-emerald', label: 'Succeeded', icon: CheckCircle },
  failed: { cls: 'badge-chronicle-rose', label: 'Failed', icon: AlertTriangle },
  cancelled: { cls: 'bg-muted text-muted-foreground', label: 'Cancelled', icon: Clock },
  expired: { cls: 'bg-muted text-muted-foreground', label: 'Expired', icon: Clock },
};

const SETTLEMENT_STATUS_META = {
  pending: { cls: 'badge-chronicle-amber', label: 'Pending', icon: Clock },
  running: { cls: 'badge-chronicle-amber', label: 'Running', icon: Clock },
  ready: { cls: 'badge-chronicle-emerald', label: 'Ready', icon: CheckCircle },
  failed: { cls: 'badge-chronicle-rose', label: 'Failed', icon: AlertTriangle },
};

function StatusBadge({ status, metaMap }) {
  const meta = metaMap[status] || { cls: 'bg-muted text-muted-foreground', label: status, icon: Clock };
  const Icon = meta.icon;

  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-xs px-2 py-1 rounded', meta.cls)}>
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

const PAYMENT_INTENT_COLUMNS = [
  {
    key: 'created_at',
    header: 'Created',
    width: '180px',
    render: (row) => (
      <div>
        <p className="font-mono text-sm text-foreground">{formatDate(row.created_at)}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.provider || '—'}</p>
      </div>
    ),
  },
  {
    key: 'invoice_number',
    header: 'Invoice',
    width: '160px',
    render: (row) => (
      <span className="font-mono text-xs text-primary">
        {row.invoice_number || '—'}
      </span>
    ),
  },
  {
    key: 'amount',
    header: 'Amount',
    width: '140px',
    headerClassName: 'text-right',
    cellClassName: 'text-right',
    render: (row) => (
      <span className="font-mono text-sm text-foreground">
        {formatCurrency(row.amount)}
      </span>
    ),
  },
  {
    key: 'payment_method',
    header: 'Method',
    width: '110px',
    render: (row) => (
      <span className="font-mono text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
        {formatMethod(row.payment_method)}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: '120px',
    render: (row) => (
      <StatusBadge status={row.status} metaMap={PAYMENT_INTENT_STATUS_META} />
    ),
  },
  {
    key: 'provider_reference',
    header: 'Provider Ref',
    width: '220px',
    render: (row) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.provider_reference || '—'}
      </span>
    ),
  },
];

function createSettlementColumns(onViewLines) {
  return [
    {
      key: 'created_at',
      header: 'Uploaded',
      width: '200px',
      render: (row) => (
        <div>
          <p className="font-mono text-sm text-foreground">{formatDate(row.created_at)}</p>
          <p className="font-mono text-xs text-muted-foreground">
            Statement: {row.statement_date || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'file_name',
      header: 'File',
      width: '260px',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.file_name || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (row) => (
        <StatusBadge status={row.status} metaMap={SETTLEMENT_STATUS_META} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '160px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs"
          onClick={() => onViewLines(row)}
        >
          View Lines
        </Button>
      ),
    },
  ];
}

const SETTLEMENT_LINE_COLUMNS = [
  {
    key: 'provider_reference',
    header: 'Provider Ref',
    width: '220px',
    render: (row) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.provider_reference || '—'}
      </span>
    ),
  },
  {
    key: 'amount_gross',
    header: 'Gross',
    width: '140px',
    headerClassName: 'text-right',
    cellClassName: 'text-right',
    render: (row) => (
      <span className="font-mono text-sm text-foreground">
        {formatCurrency(row.amount_gross)}
      </span>
    ),
  },
  {
    key: 'fee_amount',
    header: 'Fee',
    width: '120px',
    headerClassName: 'text-right',
    cellClassName: 'text-right',
    render: (row) => (
      <span className="font-mono text-sm text-muted-foreground">
        {formatCurrency(row.fee_amount)}
      </span>
    ),
  },
  {
    key: 'match_status',
    header: 'Match',
    width: '140px',
    render: (row) => (
      <span className={cn(
        'inline-flex items-center gap-1 font-mono text-xs px-2 py-1 rounded',
        row.match_status === 'matched' ? 'badge-chronicle-emerald' : 'badge-chronicle-rose'
      )}>
        {row.match_status === 'matched' ? (
          <CheckCircle className="size-3" />
        ) : (
          <AlertTriangle className="size-3" />
        )}
        {row.match_status}
      </span>
    ),
  },
  {
    key: 'mismatch_reason',
    header: 'Notes',
    width: '240px',
    render: (row) => (
      <span className="text-xs text-muted-foreground">
        {row.mismatch_reason || row.status || '—'}
      </span>
    ),
  },
];

function PspCollectionsHeader({ onRefresh }) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <CreditCard className="size-7 text-[oklch(0.70_0.17_155)]" />
          PSP Collections
        </span>
      )}
      description="Payment intents, webhooks, and settlement reconciliation (Hubtel)."
      actions={(
        <Button
          variant="outline"
          className="font-mono text-xs"
          onClick={onRefresh}
        >
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      )}
    />
  );
}

function PaymentIntentsSection({
  canJumpToPage,
  intentsData,
  intents,
  intentsTotal,
  intentPage,
  onPageChange,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg text-foreground">Payment Intents</h2>
        <p className="font-mono text-xs text-muted-foreground">{intentsTotal} total</p>
      </div>

      {intents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment intents found.</p>
      ) : (
        <VirtualizedTable rows={intents} columns={PAYMENT_INTENT_COLUMNS} threshold={50} />
      )}

      <BillingPagination
        canJumpToPage={canJumpToPage}
        data={intentsData}
        itemLabel="payment intents"
        onPageChange={onPageChange}
        page={intentPage}
        pageSize={20}
      />
    </section>
  );
}

function SettlementImportPanel({
  statementDate,
  onStatementDateChange,
  onSettlementFileChange,
  onDownloadTemplate,
  onImport,
  isImporting,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <h2 className="font-display text-lg text-foreground mb-4">Import Settlement Statement</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider">Statement Date (Optional)</Label>
          <Input
            type="date"
            value={statementDate}
            onChange={(event) => onStatementDateChange(event.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label className="font-mono text-xs uppercase tracking-wider">File (CSV)</Label>
          <Input
            type="file"
            accept=".csv"
            onChange={(event) => onSettlementFileChange(event.target.files?.[0] || null)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Imports provider statement lines and matches them to intents/payments to flag mismatches.
          </p>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-border bg-muted/10 p-4">
        <div className="flex items-start justify-between gap-3 flex-col sm:flex-row">
          <div className="min-w-0">
            <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Template Headers
            </p>
            <p className="font-mono text-xs text-foreground break-all">
              {SETTLEMENT_TEMPLATE_HEADERS.join(',')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Minimum required: <span className="font-mono">provider_reference</span> (or <span className="font-mono">paylink_id</span>/<span className="font-mono">reference</span>) or <span className="font-mono">client_reference</span>.
              Aliases are supported for amounts and fees (e.g. <span className="font-mono">amount</span>, <span className="font-mono">fee</span>, <span className="font-mono">net_amount</span>).
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={onDownloadTemplate}
          >
            <Download className="size-4 mr-2" />
            Download Template
          </Button>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          className="font-mono text-xs"
          disabled={isImporting}
          onClick={onImport}
        >
          <Upload className="size-4 mr-2" />
          Import
        </Button>
      </div>
    </section>
  );
}

function SettlementImportsReadOnlyNotice() {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 text-[oklch(0.72_0.17_70)] mt-0.5" />
        <div>
          <h2 className="font-display text-lg text-foreground">Settlement Imports Deferred</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Settlement imports are not available in Rust V2 mode yet. Existing settlement
            batches remain read-only until the PSP provider import contract is implemented.
          </p>
        </div>
      </div>
    </section>
  );
}

function SettlementBatchesSection({
  canJumpToPage,
  settlementBatches,
  settlementsData,
  settlementsTotal,
  settlementPage,
  onPageChange,
  columns,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg text-foreground">Settlement Batches</h2>
        <p className="font-mono text-xs text-muted-foreground">{settlementsTotal} total</p>
      </div>

      {settlementBatches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No settlement batches found.</p>
      ) : (
        <VirtualizedTable rows={settlementBatches} columns={columns} threshold={50} />
      )}

      <BillingPagination
        canJumpToPage={canJumpToPage}
        data={settlementsData}
        itemLabel="settlement batches"
        onPageChange={onPageChange}
        page={settlementPage}
        pageSize={20}
      />
    </section>
  );
}

function SettlementLinesDialog({
  canJumpToPage,
  linesDialog,
  linesPage,
  linesQuery,
  onClose,
  onOpenChange,
  onPageChange,
}) {
  return (
    <Dialog
      open={linesDialog.open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Settlement Lines</DialogTitle>
          <DialogDescription>
            Review unmatched/mismatched lines for reconciliation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {linesQuery.isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : linesQuery.error ? (
            <p className="text-sm text-destructive">{linesQuery.error.message}</p>
          ) : (
            <>
              <VirtualizedTable
                rows={linesQuery.data?.results || []}
                threshold={50}
                columns={SETTLEMENT_LINE_COLUMNS}
              />
              <BillingPagination
                canJumpToPage={canJumpToPage}
                data={linesQuery.data}
                itemLabel="settlement lines"
                onPageChange={onPageChange}
                page={linesPage}
                pageSize={50}
              />
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="font-mono text-xs"
            onClick={onClose}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PspReconciliationPage() {
  const [tab, setTab] = useUrlEnumParam({
    param: 'tab',
    values: PSP_TABS,
    defaultValue: 'intents',
  });
  const rustV2Mode = isRustV2ApiMode();
  const settlementImportsAvailable = !rustV2Mode;

  // Intents
  const [intentPage, setIntentPage] = useState(1);
  const intentsQuery = usePaymentIntents({ page: intentPage, page_size: 20 });

  // Settlements
  const [settlementPage, setSettlementPage] = useState(1);
  const settlementsQuery = useSettlementBatches({ page: settlementPage, page_size: 20 });
  const importSettlementMutation = useImportSettlement();
  const [statementDate, setStatementDate] = useState('');
  const settlementFileRef = useRef(null);

  const downloadSettlementTemplate = () => {
    const csv = [
      SETTLEMENT_TEMPLATE_HEADERS.join(','),
      'HUBTEL_REF_123,HMS-CLIENT-REF-ABC,100.00,1.00,99.00,2026-02-07T10:30:00Z,succeeded',
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hubtel-settlement-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Lines dialog
  const [linesDialog, setLinesDialog] = useState({ open: false, batch: null });
  const [linesPage, setLinesPage] = useState(1);
  const linesQuery = useSettlementLines(
    linesDialog.batch?.id,
    { page: linesPage, page_size: 50 },
    { enabled: linesDialog.open }
  );

  const isLoading = intentsQuery.isLoading || settlementsQuery.isLoading;
  const error = intentsQuery.error || settlementsQuery.error;

  const intents = intentsQuery.data?.results || [];
  const intentsTotal = intentsQuery.data?.count || 0;

  const settlementBatches = settlementsQuery.data?.results || [];
  const settlementsTotal = settlementsQuery.data?.count || 0;

  const settlementColumns = useMemo(() => createSettlementColumns((row) => {
    setLinesPage(1);
    setLinesDialog({ open: true, batch: row });
  }), []);

  const handleSettlementImport = async () => {
    const settlementFile = settlementFileRef.current;
    if (!settlementFile) {
      toast.error('Select a CSV file');
      return;
    }

    try {
      await importSettlementMutation.mutateAsync({
        provider: 'hubtel',
        statement_date: statementDate || null,
        file: settlementFile,
      });
      toast.success('Settlement import started');
      settlementFileRef.current = null;
    } catch (err) {
      toast.error(err.message || 'Failed to import settlement');
    }
  };

  const handleRefresh = async () => {
    await Promise.allSettled([
      intentsQuery.refetch(),
      settlementsQuery.refetch(),
    ]);
    toast.success('Refreshed');
  };

  if (isLoading) {
    return (
      <PageState variant="loading">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </PageState>
    );
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading PSP"
        description={error.message}
        action={() => handleRefresh()}
      />
    );
  }

  return (
    <PageShell>
      <PspCollectionsHeader onRefresh={handleRefresh} />

      <main className="p-4 sm:p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-2 w-full sm:w-auto">
            <TabsTrigger value="intents" className="font-mono text-xs">Payment Intents</TabsTrigger>
            <TabsTrigger value="settlements" className="font-mono text-xs">Settlements</TabsTrigger>
          </TabsList>

          <TabsContent value="intents" className="mt-6 space-y-6">
            <PaymentIntentsSection
              canJumpToPage={!rustV2Mode}
              intentsData={intentsQuery.data}
              intents={intents}
              intentsTotal={intentsTotal}
              intentPage={intentPage}
              onPageChange={setIntentPage}
            />
          </TabsContent>

          <TabsContent value="settlements" className="mt-6 space-y-6">
            {settlementImportsAvailable ? (
              <SettlementImportPanel
                statementDate={statementDate}
                onStatementDateChange={setStatementDate}
                onSettlementFileChange={(file) => { settlementFileRef.current = file; }}
                onDownloadTemplate={downloadSettlementTemplate}
                onImport={handleSettlementImport}
                isImporting={importSettlementMutation.isPending}
              />
            ) : (
              <SettlementImportsReadOnlyNotice />
            )}

            <SettlementBatchesSection
              canJumpToPage={!rustV2Mode}
              settlementBatches={settlementBatches}
              settlementsData={settlementsQuery.data}
              settlementsTotal={settlementsTotal}
              settlementPage={settlementPage}
              onPageChange={setSettlementPage}
              columns={settlementColumns}
            />
          </TabsContent>
        </Tabs>
      </main>

      <SettlementLinesDialog
        canJumpToPage={!rustV2Mode}
        linesDialog={linesDialog}
        linesPage={linesPage}
        onOpenChange={(next) => setLinesDialog((prev) => ({ ...prev, open: next }))}
        linesQuery={linesQuery}
        onClose={() => setLinesDialog({ open: false, batch: null })}
        onPageChange={setLinesPage}
      />
    </PageShell>
  );
}
