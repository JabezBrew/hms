/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { billingApi } from '@/features/billing/api';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
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
import { BillingPagination } from '@/features/billing/components/BillingPagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  useNhisClaimBatches,
  useCreateNhisClaimBatch,
  useLintNhisClaimBatch,
  useExportNhisClaimBatch,
  useNhisExportJobs,
  useInsuranceProviders,
  useRemittanceImportJobs,
  useImportRemittance,
  useRemittanceLines,
  useInsuranceAging,
  useInsuranceDSO,
  useRemittanceQueue,
} from '@/features/billing/hooks';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

const NHIS_TABS = ['batches', 'exports', 'remittances', 'ar'];

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

function BatchStatusBadge({ status }) {
  const meta = {
    draft: { label: 'Draft', cls: 'bg-muted text-muted-foreground', icon: Clock },
    exported: { label: 'Exported', cls: 'badge-chronicle-sky', icon: FileSpreadsheet },
    submitted: { label: 'Submitted', cls: 'badge-chronicle-amber', icon: Clock },
    closed: { label: 'Closed', cls: 'badge-chronicle-emerald', icon: CheckCircle },
  }[status] || { label: status, cls: 'bg-muted text-muted-foreground', icon: Clock };
  const Icon = meta.icon;

  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-xs px-2 py-1 rounded', meta.cls)}>
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

function ExportStatusBadge({ status }) {
  const meta = {
    pending: { cls: 'badge-chronicle-amber', label: 'Pending', icon: Clock },
    ready: { cls: 'badge-chronicle-emerald', label: 'Ready', icon: CheckCircle },
    delivered: { cls: 'bg-muted text-muted-foreground', label: 'Delivered', icon: CheckCircle },
    failed: { cls: 'badge-chronicle-rose', label: 'Failed', icon: AlertTriangle },
  }[status] || { cls: 'bg-muted text-muted-foreground', label: status, icon: Clock };
  const Icon = meta.icon;

  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-xs px-2 py-1 rounded', meta.cls)}>
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

function RemittanceStatusBadge({ status }) {
  const meta = {
    pending: { cls: 'badge-chronicle-amber', label: 'Pending', icon: Clock },
    running: { cls: 'badge-chronicle-amber', label: 'Running', icon: Clock },
    ready: { cls: 'badge-chronicle-emerald', label: 'Ready', icon: CheckCircle },
    failed: { cls: 'badge-chronicle-rose', label: 'Failed', icon: AlertTriangle },
  }[status] || { cls: 'bg-muted text-muted-foreground', label: status, icon: Clock };
  const Icon = meta.icon;

  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-xs px-2 py-1 rounded', meta.cls)}>
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

function createBatchColumns({
  lintBatchMutation,
  exportBatchMutation,
  setTab,
  setForceExportDialog,
}) {
  return [
    {
      key: 'period',
      header: 'Period',
      width: '260px',
      render: (row) => (
        <div>
          <p className="font-mono text-sm text-foreground">
            {formatDate(row.period_start)} to {formatDate(row.period_end)}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            Created {formatDate(row.created_at)}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (row) => <BatchStatusBadge status={row.status} />,
    },
    {
      key: 'claim_count',
      header: 'Claims',
      width: '110px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <span className="font-mono text-sm text-foreground">
          {row.claim_count ?? 0}
        </span>
      ),
    },
    {
      key: 'total_claimed_amount',
      header: 'Total Claimed',
      width: '160px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <span className="font-mono text-sm text-foreground">
          {formatCurrency(row.total_claimed_amount)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '240px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <BatchActions
          row={row}
          lintBatchMutation={lintBatchMutation}
          exportBatchMutation={exportBatchMutation}
          setTab={setTab}
          setForceExportDialog={setForceExportDialog}
        />
      ),
    },
  ];
}

function BatchActions({ row, lintBatchMutation, exportBatchMutation, setTab, setForceExportDialog }) {
  const lintBatch = async () => {
    try {
      const res = await lintBatchMutation.mutateAsync(row.id);
      const summary = res?.summary || [];
      const errCount = summary.find((s) => s.severity === 'error')?.count || 0;
      const warnCount = summary.find((s) => s.severity === 'warning')?.count || 0;
      if (errCount > 0) {
        toast.error(`Lint found ${errCount} error(s) and ${warnCount} warning(s)`);
      } else if (warnCount > 0) {
        toast.message(`Lint found ${warnCount} warning(s)`);
      } else {
        toast.success('Lint passed');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to lint batch');
    }
  };

  const exportBatch = async () => {
    try {
      await exportBatchMutation.mutateAsync({ batchId: row.id, data: {} });
      toast.success('Export job created');
      setTab('exports');
    } catch (err) {
      const msg = err.message || 'Failed to export batch';
      if (msg.toLowerCase().includes('fix claim lint errors')) {
        setForceExportDialog({ open: true, batchId: row.id });
      } else {
        toast.error(msg);
      }
    }
  };

  return (
    <div className="flex justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        className="font-mono text-xs"
        disabled={lintBatchMutation.isPending}
        onClick={lintBatch}
      >
        Lint
      </Button>
      <Button
        size="sm"
        className="font-mono text-xs"
        disabled={exportBatchMutation.isPending}
        onClick={exportBatch}
      >
        Export
      </Button>
    </div>
  );
}

function createExportColumns({ exportDownloadsAvailable, exportsQuery }) {
  return [
    {
      key: 'created_at',
      header: 'Created',
      width: '200px',
      render: (row) => (
        <div>
          <p className="font-mono text-sm text-foreground">{formatDate(row.created_at)}</p>
          <p className="font-mono text-xs text-muted-foreground">
            Expires {formatDate(row.expires_at)}
          </p>
        </div>
      ),
    },
    {
      key: 'batch',
      header: 'Batch',
      width: '220px',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.batch}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (row) => <ExportStatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '220px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        exportDownloadsAvailable ? (
          <ExportDownloadButton row={row} exportsQuery={exportsQuery} />
        ) : null
      ),
    },
  ];
}

function ExportDownloadButton({ row, exportsQuery }) {
  const downloadExport = async () => {
    try {
      const blob = await billingApi.downloadNhisExportJob(row.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nhis-claim-it-${row.batch}-${row.id}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Download started');
      exportsQuery.refetch();
    } catch (err) {
      toast.error(err.message || 'Failed to download export');
    }
  };

  return (
    <Button
      size="sm"
      className="font-mono text-xs"
      disabled={row.status !== 'ready' && row.status !== 'delivered'}
      onClick={downloadExport}
    >
      <Download className="size-4 mr-2" />
      Download ZIP
    </Button>
  );
}

function createRemittanceColumns({ setLinesPage, setLinesDialog }) {
  return [
    {
      key: 'created_at',
      header: 'Created',
      width: '200px',
      render: (row) => (
        <div>
          <p className="font-mono text-sm text-foreground">{formatDate(row.created_at)}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {row.payer_name || '—'}
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
      render: (row) => <RemittanceStatusBadge status={row.status} />,
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
          onClick={() => {
            setLinesPage(1);
            setLinesDialog({ open: true, job: row });
          }}
        >
          View Lines
        </Button>
      ),
    },
  ];
}

function createRemittanceLineColumns() {
  return [
    {
      key: 'claim_number',
      header: 'Claim #',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.claim_number || '—'}
        </span>
      ),
    },
    {
      key: 'invoice_number',
      header: 'Invoice #',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.invoice_number || '—'}
        </span>
      ),
    },
    {
      key: 'paid_amount',
      header: 'Paid',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <span className="font-mono text-sm text-foreground">
          {formatCurrency(row.paid_amount)}
        </span>
      ),
    },
    {
      key: 'paid_date',
      header: 'Paid Date',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.paid_date || '—'}
        </span>
      ),
    },
    {
      key: 'match_status',
      header: 'Match',
      width: '140px',
      render: (row) => <RemittanceMatchStatusBadge status={row.match_status} />,
    },
  ];
}

function RemittanceMatchStatusBadge({ status }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 font-mono text-xs px-2 py-1 rounded',
      status === 'matched' ? 'badge-chronicle-emerald' : 'badge-chronicle-rose'
    )}>
      {status === 'matched' ? (
        <CheckCircle className="size-3" />
      ) : (
        <AlertTriangle className="size-3" />
      )}
      {status}
    </span>
  );
}

export default function NhisClaimsArPage() {
  const [tab, setTab] = useUrlEnumParam({
    param: 'tab',
    values: NHIS_TABS,
    defaultValue: 'batches',
  });
  const rustV2Mode = isRustV2ApiMode();
  const periodBatchCreationAvailable = !rustV2Mode;
  const exportDownloadsAvailable = !rustV2Mode;
  const remittanceFileImportAvailable = !rustV2Mode;

  // Batches
  const [batchPage, setBatchPage] = useState(1);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [forceExportDialog, setForceExportDialog] = useState({ open: false, batchId: null });

  const batchesQuery = useNhisClaimBatches({ page: batchPage, page_size: 20 });
  const createBatchMutation = useCreateNhisClaimBatch();
  const lintBatchMutation = useLintNhisClaimBatch();
  const exportBatchMutation = useExportNhisClaimBatch();

  // Exports
  const [exportPage, setExportPage] = useState(1);
  const exportsQuery = useNhisExportJobs({ page: exportPage, page_size: 20 });

  // Remittances
  const [remittancePage, setRemittancePage] = useState(1);
  const [selectedPayer, setSelectedPayer] = useState('');
  const remittanceFileRef = useRef(null);
  const remittancesQuery = useRemittanceImportJobs({ page: remittancePage, page_size: 20 });
  const importRemittanceMutation = useImportRemittance();
  const providersQuery = useInsuranceProviders({ page_size: 200 });

  const nhisProviders = useMemo(() => {
    const results = providersQuery.data?.results || providersQuery.data || [];
    return (Array.isArray(results) ? results : []).filter((p) => p?.payer_type === 'nhis');
  }, [providersQuery.data]);

  // Remittance lines dialog
  const [linesDialog, setLinesDialog] = useState({ open: false, job: null });
  const [linesPage, setLinesPage] = useState(1);
  const linesQuery = useRemittanceLines(linesDialog.job?.id, { page: linesPage, page_size: 50 }, { enabled: linesDialog.open });

  // AR
  const [arBasis, setArBasis] = useState('invoice_date');
  const agingQuery = useInsuranceAging({ basis: arBasis });
  const dsoQuery = useInsuranceDSO({ basis: arBasis });
  const queueQuery = useRemittanceQueue();

  const handleRefresh = async () => {
    await Promise.allSettled([
      batchesQuery.refetch(),
      exportsQuery.refetch(),
      remittancesQuery.refetch(),
      agingQuery.refetch(),
      dsoQuery.refetch(),
      queueQuery.refetch(),
      providersQuery.refetch(),
    ]);
    toast.success('Refreshed');
  };

  const isLoading = batchesQuery.isLoading || exportsQuery.isLoading || remittancesQuery.isLoading;
  const error = batchesQuery.error || exportsQuery.error || remittancesQuery.error;

  const batches = batchesQuery.data?.results || [];
  const batchesTotal = batchesQuery.data?.count || 0;

  const exportJobs = exportsQuery.data?.results || [];
  const exportsTotal = exportsQuery.data?.count || 0;

  const remittanceJobs = remittancesQuery.data?.results || [];
  const remittancesTotal = remittancesQuery.data?.count || 0;

  const batchColumns = useMemo(
    () => createBatchColumns({
      lintBatchMutation,
      exportBatchMutation,
      setTab,
      setForceExportDialog,
    }),
    [exportBatchMutation, lintBatchMutation, setTab]
  );

  const exportColumns = useMemo(
    () => createExportColumns({ exportDownloadsAvailable, exportsQuery }),
    [exportDownloadsAvailable, exportsQuery]
  );

  const remittanceColumns = useMemo(
    () => createRemittanceColumns({ setLinesPage, setLinesDialog }),
    []
  );
  const remittanceLineColumns = useMemo(() => createRemittanceLineColumns(), []);

  const aging = agingQuery.data || {};
  const dso = dsoQuery.data || {};
  const queue = queueQuery.data || {};

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
        title="Error Loading NHIS"
        description={error.message}
        action={() => handleRefresh()}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={(
          <span className="flex items-center gap-3">
            <FileSpreadsheet className="size-7 text-[oklch(0.70_0.15_230)]" />
            NHIS Claims + AR
          </span>
        )}
        description="Claim batching, export, remittance posting, and insurance receivables."
        actions={(
          <Button
            variant="outline"
            className="font-mono text-xs"
            onClick={() => handleRefresh()}
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </Button>
        )}
      />

      <main className="p-4 sm:p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full sm:w-auto">
            <TabsTrigger value="batches" className="font-mono text-xs">Batches</TabsTrigger>
            <TabsTrigger value="exports" className="font-mono text-xs">Exports</TabsTrigger>
            <TabsTrigger value="remittances" className="font-mono text-xs">Remittances</TabsTrigger>
            <TabsTrigger value="ar" className="font-mono text-xs">AR</TabsTrigger>
          </TabsList>

          <BatchesTab
            periodBatchCreationAvailable={periodBatchCreationAvailable}
            periodStart={periodStart}
            periodEnd={periodEnd}
            batchNotes={batchNotes}
            setPeriodStart={setPeriodStart}
            setPeriodEnd={setPeriodEnd}
            setBatchNotes={setBatchNotes}
            createBatchMutation={createBatchMutation}
            batches={batches}
            batchesData={batchesQuery.data}
            batchesTotal={batchesTotal}
            batchPage={batchPage}
            setBatchPage={setBatchPage}
            batchColumns={batchColumns}
            canJumpToPage={!rustV2Mode}
          />

          <ExportsTab
            exportDownloadsAvailable={exportDownloadsAvailable}
            exportJobs={exportJobs}
            exportColumns={exportColumns}
            exportsData={exportsQuery.data}
            exportsTotal={exportsTotal}
            exportPage={exportPage}
            setExportPage={setExportPage}
            canJumpToPage={!rustV2Mode}
          />

          <RemittancesTab
            remittanceFileImportAvailable={remittanceFileImportAvailable}
            selectedPayer={selectedPayer}
            setSelectedPayer={setSelectedPayer}
            remittanceFileRef={remittanceFileRef}
            nhisProviders={nhisProviders}
            importRemittanceMutation={importRemittanceMutation}
            remittanceJobs={remittanceJobs}
            remittanceColumns={remittanceColumns}
            remittancesData={remittancesQuery.data}
            remittancesTotal={remittancesTotal}
            remittancePage={remittancePage}
            setRemittancePage={setRemittancePage}
            canJumpToPage={!rustV2Mode}
          />

          <ArTab
            arBasis={arBasis}
            setArBasis={setArBasis}
            aging={aging}
            dso={dso}
            queue={queue}
          />
        </Tabs>
      </main>

      <ForceExportDialog
        forceExportDialog={forceExportDialog}
        setForceExportDialog={setForceExportDialog}
        exportBatchMutation={exportBatchMutation}
        setTab={setTab}
      />
      <RemittanceLinesDialog
        linesDialog={linesDialog}
        setLinesDialog={setLinesDialog}
        linesQuery={linesQuery}
        linesPage={linesPage}
        setLinesPage={setLinesPage}
        remittanceLineColumns={remittanceLineColumns}
        canJumpToPage={!rustV2Mode}
      />
    </PageShell>
  );
}

function BatchesTab({
  periodBatchCreationAvailable,
  periodStart,
  periodEnd,
  batchNotes,
  setPeriodStart,
  setPeriodEnd,
  setBatchNotes,
  createBatchMutation,
  batches,
  batchesData,
  batchesTotal,
  batchPage,
  setBatchPage,
  batchColumns,
  canJumpToPage,
}) {
  return (
    <TabsContent value="batches" className="mt-6 space-y-6">
      {periodBatchCreationAvailable ? (
        <CreateBatchSection
          periodStart={periodStart}
          periodEnd={periodEnd}
          batchNotes={batchNotes}
          setPeriodStart={setPeriodStart}
          setPeriodEnd={setPeriodEnd}
          setBatchNotes={setBatchNotes}
          createBatchMutation={createBatchMutation}
        />
      ) : (
        <UnavailableNotice
          label="Rust V2 batch creation"
          description="Period-based NHIS batch creation is not available in Rust V2 mode yet. Existing batches can still be reviewed, linted, and exported through supported Rust V2 contracts."
        />
      )}

      <PaginatedTableSection
        title="Batches"
        total={batchesTotal}
        emptyText="No batches found."
        rows={batches}
        columns={batchColumns}
        page={batchPage}
        data={batchesData}
        pageSize={20}
        setPage={setBatchPage}
        canJumpToPage={canJumpToPage}
      />
    </TabsContent>
  );
}

function CreateBatchSection({
  periodStart,
  periodEnd,
  batchNotes,
  setPeriodStart,
  setPeriodEnd,
  setBatchNotes,
  createBatchMutation,
}) {
  const createBatch = async () => {
    if (!periodStart || !periodEnd) {
      toast.error('Period start and end are required');
      return;
    }
    try {
      await createBatchMutation.mutateAsync({
        period_start: periodStart,
        period_end: periodEnd,
        notes: batchNotes || null,
      });
      toast.success('Batch created');
      setBatchNotes('');
    } catch (err) {
      toast.error(err.message || 'Failed to create batch');
    }
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <h2 className="font-display text-lg text-foreground mb-4">Create Batch</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider">Period Start</Label>
          <Input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider">Period End</Label>
          <Input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label className="font-mono text-xs uppercase tracking-wider">Notes (Optional)</Label>
          <Input
            value={batchNotes}
            onChange={(e) => setBatchNotes(e.target.value)}
            placeholder="e.g., Ashanti OPD week 1"
            className="font-mono"
          />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Batches attach eligible NHIS invoices in the selected date range.
        </p>
        <Button
          className="font-mono text-xs"
          disabled={createBatchMutation.isPending}
          onClick={createBatch}
        >
          {createBatchMutation.isPending ? 'Creating...' : 'Create Batch'}
        </Button>
      </div>
    </section>
  );
}

function ExportsTab({
  exportDownloadsAvailable,
  exportJobs,
  exportColumns,
  exportsData,
  exportsTotal,
  exportPage,
  setExportPage,
  canJumpToPage,
}) {
  return (
    <TabsContent value="exports" className="mt-6 space-y-6">
      {!exportDownloadsAvailable && (
        <UnavailableNotice
          label="Rust V2 export downloads"
          description="NHIS export ZIP downloads are not available in Rust V2 mode yet. Export job history remains visible when returned by the backend."
        />
      )}
      <PaginatedTableSection
        title="Export Jobs"
        total={exportsTotal}
        emptyText="No export jobs found."
        rows={exportJobs}
        columns={exportColumns}
        page={exportPage}
        data={exportsData}
        pageSize={20}
        setPage={setExportPage}
        canJumpToPage={canJumpToPage}
      />
    </TabsContent>
  );
}

function RemittancesTab({
  remittanceFileImportAvailable,
  selectedPayer,
  setSelectedPayer,
  remittanceFileRef,
  nhisProviders,
  importRemittanceMutation,
  remittanceJobs,
  remittanceColumns,
  remittancesData,
  remittancesTotal,
  remittancePage,
  setRemittancePage,
  canJumpToPage,
}) {
  return (
    <TabsContent value="remittances" className="mt-6 space-y-6">
      {remittanceFileImportAvailable ? (
        <ImportRemittanceSection
          selectedPayer={selectedPayer}
          setSelectedPayer={setSelectedPayer}
          remittanceFileRef={remittanceFileRef}
          nhisProviders={nhisProviders}
          importRemittanceMutation={importRemittanceMutation}
        />
      ) : (
        <UnavailableNotice
          label="Rust V2 remittance import"
          description="Remittance file import is not available in Rust V2 mode yet. Imported remittance history remains visible for reconciliation review."
        />
      )}
      <PaginatedTableSection
        title="Remittance Imports"
        total={remittancesTotal}
        emptyText="No remittance imports found."
        rows={remittanceJobs}
        columns={remittanceColumns}
        page={remittancePage}
        data={remittancesData}
        pageSize={20}
        setPage={setRemittancePage}
        canJumpToPage={canJumpToPage}
      />
    </TabsContent>
  );
}

function ImportRemittanceSection({
  selectedPayer,
  setSelectedPayer,
  remittanceFileRef,
  nhisProviders,
  importRemittanceMutation,
}) {
  const importRemittance = async () => {
    if (!selectedPayer) {
      toast.error('Select a payer');
      return;
    }
    const remittanceFile = remittanceFileRef.current;
    if (!remittanceFile) {
      toast.error('Select a file');
      return;
    }
    try {
      await importRemittanceMutation.mutateAsync({ payerId: selectedPayer, file: remittanceFile });
      toast.success('Remittance import started');
      remittanceFileRef.current = null;
    } catch (err) {
      toast.error(err.message || 'Failed to import remittance');
    }
  };

  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <h2 className="font-display text-lg text-foreground mb-4">Import Remittance</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider">Payer</Label>
          <Select value={selectedPayer} onValueChange={setSelectedPayer}>
            <SelectTrigger className="font-mono">
              <SelectValue placeholder="Select NHIS payer" />
            </SelectTrigger>
            <SelectContent>
              {nhisProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id} className="font-mono text-sm">
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {nhisProviders.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No NHIS providers found. Configure an insurance provider with `payer_type=nhis`.
            </p>
          )}
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label className="font-mono text-xs uppercase tracking-wider">File (CSV/XLSX)</Label>
          <Input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => { remittanceFileRef.current = e.target.files?.[0] || null; }}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Upload the remittance file; matched lines will auto-post insurance payments.
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          className="font-mono text-xs"
          disabled={importRemittanceMutation.isPending}
          onClick={importRemittance}
        >
          <Upload className="size-4 mr-2" />
          Import
        </Button>
      </div>
    </section>
  );
}

function PaginatedTableSection({
  title,
  total,
  emptyText,
  rows,
  columns,
  page,
  data,
  pageSize,
  setPage,
  canJumpToPage,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg text-foreground">{title}</h2>
        <p className="font-mono text-xs text-muted-foreground">{total} total</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <VirtualizedTable rows={rows} columns={columns} threshold={50} />
      )}

      <BillingPagination
        canJumpToPage={canJumpToPage}
        data={data}
        itemLabel={title.toLowerCase()}
        onPageChange={setPage}
        page={page}
        pageSize={pageSize}
      />
    </section>
  );
}

function UnavailableNotice({ label, description }) {
  return (
    <section className="rounded-2xl border border-border bg-muted/30 p-5 sm:p-6">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </section>
  );
}

function ArTab({ arBasis, setArBasis, aging, dso, queue }) {
  return (
    <TabsContent value="ar" className="mt-6 space-y-6">
      <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 flex-col sm:flex-row">
          <div>
            <h2 className="font-display text-lg text-foreground">Insurance AR Snapshot</h2>
            <p className="text-sm text-muted-foreground">
              Aging buckets and weighted DSO for outstanding insurance balances.
            </p>
          </div>
          <ArBasisSelect arBasis={arBasis} setArBasis={setArBasis} />
        </div>
        <ArAgingBuckets aging={aging} />
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <DsoCard dso={dso} />
          <RemittanceQueueSummary queue={queue} />
        </div>
      </section>
    </TabsContent>
  );
}

function ArBasisSelect({ arBasis, setArBasis }) {
  return (
    <div className="w-full sm:w-[260px]">
      <Select value={arBasis} onValueChange={setArBasis}>
        <SelectTrigger className="font-mono">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="invoice_date" className="font-mono text-sm">
            Basis: Invoice Date
          </SelectItem>
          <SelectItem value="claim_submission_date" className="font-mono text-sm">
            Basis: Claim Submission
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ArAgingBuckets({ aging }) {
  return (
    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      <ArBucketCard label="0-30" value={aging.bucket_0_30} />
      <ArBucketCard label="31-60" value={aging.bucket_31_60} />
      <ArBucketCard label="61-90" value={aging.bucket_61_90} />
      <ArBucketCard label="90+" value={aging.bucket_90_plus} variant="danger" />
      <ArBucketCard label="Total" value={aging.total} variant="total" />
    </div>
  );
}

function DsoCard({ dso }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/10 p-5">
      <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">DSO</p>
      <p className="font-display text-3xl text-foreground">
        {Number.isFinite(dso.dso_days) ? dso.dso_days.toFixed(1) : '—'} days
      </p>
      <p className="font-mono text-xs text-muted-foreground mt-1">
        Total outstanding: {formatCurrency(dso.total_balance)}
      </p>
    </div>
  );
}

function RemittanceQueueSummary({ queue }) {
  const summary = queue.summary || [];

  return (
    <div className="rounded-2xl border border-border bg-muted/10 p-5 lg:col-span-2">
      <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
        Remittance Queue
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {summary.length > 0 ? (
          summary.map((row) => (
            <div key={row.match_status} className="rounded-xl bg-card border border-border p-4">
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                {row.match_status}
              </p>
              <p className="font-display text-xl text-foreground mt-1">
                {row.count || 0}
              </p>
              <p className="font-mono text-xs text-muted-foreground mt-1">
                Paid: {formatCurrency(row.total_paid)}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-xl bg-card border border-border p-4 sm:col-span-3">
            <p className="text-sm text-muted-foreground">No queue items yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ForceExportDialog({
  forceExportDialog,
  setForceExportDialog,
  exportBatchMutation,
  setTab,
}) {
  const exportAnyway = async () => {
    const batchId = forceExportDialog.batchId;
    if (!batchId) return;
    try {
      await exportBatchMutation.mutateAsync({ batchId, data: { allow_errors: true } });
      toast.success('Export job created (forced)');
      setForceExportDialog({ open: false, batchId: null });
      setTab('exports');
    } catch (err) {
      toast.error(err.message || 'Failed to export batch');
    }
  };

  return (
    <Dialog
      open={forceExportDialog.open}
      onOpenChange={(next) => setForceExportDialog((prev) => ({ ...prev, open: next }))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Export With Lint Errors?
          </DialogTitle>
          <DialogDescription>
            Lint errors can increase NHIS rejections. You can export anyway, but it’s recommended to fix errors first.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="outline"
            className="font-mono text-xs"
            onClick={() => setForceExportDialog({ open: false, batchId: null })}
          >
            Cancel
          </Button>
          <Button
            className="font-mono text-xs"
            disabled={exportBatchMutation.isPending}
            onClick={exportAnyway}
          >
            Export Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemittanceLinesDialog({
  linesDialog,
  setLinesDialog,
  linesQuery,
  linesPage,
  setLinesPage,
  remittanceLineColumns,
  canJumpToPage,
}) {
  return (
    <Dialog
      open={linesDialog.open}
      onOpenChange={(next) => setLinesDialog((prev) => ({ ...prev, open: next }))}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Remittance Lines</DialogTitle>
          <DialogDescription>
            Matched lines auto-post insurance payments; unmatched lines need review.
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
                columns={remittanceLineColumns}
              />
              <BillingPagination
                canJumpToPage={canJumpToPage}
                data={linesQuery.data}
                itemLabel="remittance lines"
                onPageChange={setLinesPage}
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
            onClick={() => setLinesDialog({ open: false, job: null })}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArBucketCard({ label, value, variant = 'default' }) {
  const cls = {
    default: 'bg-muted/10 border-border',
    danger: 'bg-rose-500/10 border-rose-500/30',
    total: 'bg-[oklch(0.70_0.15_230_/_0.08)] border-[oklch(0.70_0.15_230_/_0.35)]',
  }[variant] || 'bg-muted/10 border-border';

  return (
    <div className={cn('rounded-2xl border p-5', cls)}>
      <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="font-display text-2xl text-foreground mt-1">{formatCurrency(value)}</p>
    </div>
  );
}
