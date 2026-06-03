/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import Link2 from 'lucide-react/dist/esm/icons/link-2.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Pencil from 'lucide-react/dist/esm/icons/square-pen.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { useRouteTableState } from '@/shared/hooks/useRouteTableState';
import { VirtualizedTable } from '@/components/ui/VirtualizedTable';
import { TablePagination } from '@/components/ui/table-pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  useInsuranceProviders,
  useServices,
  usePayerServiceCodes,
  useCreatePayerServiceCode,
  useUpdatePayerServiceCode,
  useCreateNhisMappingImportJob,
  useApplyNhisMappingImportJob,
  useNhisMappingImportJob,
} from '@/features/billing/hooks';

function normalizeResults(data) {
  if (!data) return { results: [], count: 0 };
  if (Array.isArray(data)) return { results: data, count: data.length };
  return { results: data.results || [], count: data.count || (data.results ? data.results.length : 0) };
}

const TEMPLATE_HEADERS = [
  'service_code',
  'external_code',
  'effective_from',
  'effective_until',
];

function MappingStatusBadge({ isActive }) {
  return (
    <span className={cn(
      'font-mono text-xs px-2 py-1 rounded',
      isActive ? 'badge-chronicle-emerald' : 'bg-muted text-muted-foreground'
    )}>
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

function createMappingColumns({ mappingMutationsAvailable, onEditMapping }) {
  return [
    {
      key: 'service',
      header: 'Service',
      width: '420px',
      render: (row) => (
        <div>
          <p className="text-foreground font-medium">
            {row.service_name || '—'}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {row.service_code || '—'} → {row.external_code || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'effective',
      header: 'Effective',
      width: '220px',
      render: (row) => (
        <div>
          <p className="font-mono text-xs text-foreground">
            From {row.effective_from}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            Until {row.effective_until || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (row) => <MappingStatusBadge isActive={row.is_active} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        mappingMutationsAvailable ? (
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={() => onEditMapping(row)}
          >
            <Pencil className="size-3 mr-2" />
            Edit
          </Button>
        ) : null
      ),
    },
  ];
}

function NhisMappingsHeader({
  mappingMutationsAvailable,
  onDownloadTemplate,
  onNewMapping,
  onRefresh,
  payerId,
}) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <span className="p-3 rounded-xl bg-primary/10">
            <Link2 className="size-6 text-primary" />
          </span>
          NHIS Service Mappings
        </span>
      )}
      description="Map internal billable services to NHIS codes (effective-dated)"
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={onDownloadTemplate}
          >
            <Download className="size-4 mr-2" />
            CSV Template
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={onRefresh}
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </Button>
          {mappingMutationsAvailable && (
            <Button
              size="sm"
              className="font-mono text-xs"
              disabled={!payerId}
              onClick={onNewMapping}
            >
              <Plus className="size-4 mr-2" />
              New Mapping
            </Button>
          )}
        </div>
      )}
    />
  );
}

function NhisMappingsReadOnlyNotice({ mappingMutationsAvailable }) {
  if (mappingMutationsAvailable) {
    return null;
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      NHIS mapping editing and import are not available in Rust V2 mode yet. Existing
      mapping views remain read-only until mapping mutation and import contracts are implemented.
    </section>
  );
}

function NhisImportJobSummary({ importJob, importSummary }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Current Job</p>
      {!importJob && (
        <p className="mt-2 text-sm text-muted-foreground">No import job started yet.</p>
      )}
      {importJob && (
        <div className="mt-2 space-y-1">
          <p className="font-mono text-xs text-foreground">Status: {importJob.status}</p>
          <p className="font-mono text-xs text-muted-foreground">File: {importJob.file_name || '—'}</p>
          <p className="font-mono text-xs text-muted-foreground">
            Rows: {importSummary.rows_total ?? '—'} | Valid: {importSummary.rows_valid ?? '—'}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            Would create: {importSummary.would_create_mappings ?? '—'} | Would update: {importSummary.would_update_mappings ?? '—'}
          </p>
          <p className={cn(
            'font-mono text-xs',
            Number(importSummary.errors || 0) > 0 ? 'text-rose-600' : 'text-muted-foreground'
          )}>
            Errors: {importSummary.errors ?? 0} | Warnings: {importSummary.warnings ?? 0}
          </p>
        </div>
      )}
    </div>
  );
}

function NhisImportIssues({ importIssues }) {
  if (!importIssues.length) {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg border bg-background p-3">
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Preview Issues (first 20)</p>
      <div className="mt-2 space-y-1">
        {importIssues.slice(0, 20).map((issue) => (
          <div key={`${issue.row || 'row'}-${issue.field || 'field'}-${issue.message}`} className="flex items-start gap-2">
            <span className={cn(
              'mt-0.5 inline-flex rounded px-1.5 py-0.5 font-mono text-[10px]',
              issue.severity === 'error' ? 'badge-chronicle-rose' : 'badge-chronicle-amber'
            )}>
              {issue.severity}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {issue.row ? `Row ${issue.row}: ` : ''}
              {issue.field ? `${issue.field}: ` : ''}
              {issue.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NhisBulkImportPanel({
  activeImportJobId,
  applyImportJobMutation,
  createImportJobMutation,
  importJob,
  importJobQuery,
  importIssues,
  importSummary,
  mappingMutationsAvailable,
  onApplyImport,
  onFileChange,
  onStartImportPreview,
  seedServices,
  servicesQuery,
  codesQuery,
  setSeedServices,
}) {
  if (!mappingMutationsAvailable) {
    return null;
  }

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-heading text-sm text-foreground">Bulk Import (Preview then Apply)</p>
          <p className="text-xs text-muted-foreground">
            Upload a CSV or XLSX to upsert NHIS mappings by internal <span className="font-mono">service_code</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Switch checked={seedServices} onCheckedChange={setSeedServices} />
            <span className="font-mono text-xs text-muted-foreground">Seed missing services</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={() => {
              importJobQuery.refetch();
              codesQuery.refetch();
              servicesQuery.refetch();
            }}
            disabled={!activeImportJobId}
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh Job
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider">File (CSV/XLSX)</Label>
          <Input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="font-mono text-sm"
            onChange={onFileChange}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={onStartImportPreview}
              disabled={createImportJobMutation.isPending}
            >
              <Upload className="size-4 mr-2" />
              Preview Import
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="font-mono text-xs"
              onClick={onApplyImport}
              disabled={
                !importJob ||
                importJob.status !== 'preview_ready' ||
                Number(importSummary.errors || 0) > 0 ||
                applyImportJobMutation.isPending
              }
            >
              Apply Import
            </Button>
            {importJob?.status === 'preview_ready' && Number(importSummary.errors || 0) > 0 && (
              <span className="font-mono text-xs text-rose-600">
                Fix preview errors before applying.
              </span>
            )}
          </div>
        </div>

        <NhisImportJobSummary importJob={importJob} importSummary={importSummary} />
      </div>

      <NhisImportIssues importIssues={importIssues} />
    </section>
  );
}

function NhisMappingFilters({
  nhisProviders,
  payerId,
  search,
  selectedServiceName,
  setSearch,
  setSelectedPayer,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider">NHIS Payer</Label>
        <Select
          value={payerId}
          onValueChange={(value) => setSelectedPayer(value)}
        >
          <SelectTrigger className="font-mono text-sm">
            <SelectValue placeholder="Select NHIS payer" />
          </SelectTrigger>
          <SelectContent>
            {nhisProviders.map((provider) => (
              <SelectItem key={provider.id} value={provider.id} className="font-mono text-sm">
                {provider.name} ({provider.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!nhisProviders.length ? (
          <p className="text-xs text-muted-foreground">
            Create an insurance provider with `payer_type=nhis` first.
          </p>
        ) : null}
      </div>

      <div className="lg:col-span-2">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search mappings (service name/code, external code)"
            className="pl-9 font-mono text-sm"
          />
        </div>
        {selectedServiceName ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Selected: {selectedServiceName}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function NhisMappingDialog({
  createMutation,
  dialog,
  form,
  onDialogChange,
  onSaveMapping,
  services,
  serviceById,
  setForm,
  updateMutation,
}) {
  return (
    <Dialog open={dialog.open} onOpenChange={onDialogChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {dialog.mode === 'create' ? 'New NHIS Mapping' : 'Edit NHIS Mapping'}
          </DialogTitle>
          <DialogDescription>
            Effective dates are required. Use future dates for planned tariff revisions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Service</Label>
            <Select value={form.service} onValueChange={(value) => setForm((prev) => ({ ...prev, service: value }))}>
              <SelectTrigger className="font-mono text-sm">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id} className="font-mono text-sm">
                    {service.code} · {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.service && serviceById.get(form.service) ? (
              <p className="text-xs text-muted-foreground">
                Selected: {serviceById.get(form.service).name}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">NHIS External Code</Label>
            <Input
              value={form.external_code}
              onChange={(event) => setForm((prev) => ({ ...prev, external_code: event.target.value }))}
              className="font-mono"
              placeholder="e.g. NHIS12345"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Effective From</Label>
              <Input
                type="date"
                value={form.effective_from}
                onChange={(event) => setForm((prev) => ({ ...prev, effective_from: event.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Effective Until (optional)</Label>
              <Input
                type="date"
                value={form.effective_until}
                onChange={(event) => setForm((prev) => ({ ...prev, effective_until: event.target.value }))}
                className="font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
            <div>
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Status</p>
              <p className="text-sm text-foreground">{form.is_active ? 'Active' : 'Inactive'}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="font-mono text-xs"
              onClick={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
            >
              Toggle
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="font-mono text-xs"
            onClick={() => onDialogChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="font-mono text-xs"
            disabled={createMutation.isPending || updateMutation.isPending}
            onClick={onSaveMapping}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NhisServiceMappingsPage() {
  const [tableState, setTableState] = useRouteTableState('nhisServiceMappings', {
    search: '',
    selectedPayer: '',
    page: 1,
  });
  const { search, selectedPayer, page } = tableState;
  const mappingMutationsAvailable = !isRustV2ApiMode();
  const debouncedSearch = useDebounce(search, 250);

  const providersQuery = useInsuranceProviders({ page_size: 200 });
  const allProviders = normalizeResults(providersQuery.data).results;
  const nhisProviders = useMemo(
    () => allProviders.filter((provider) => provider?.payer_type === 'nhis'),
    [allProviders]
  );

  const payerId = selectedPayer || nhisProviders?.[0]?.id || '';

  const servicesQuery = useServices({ page_size: 500, is_active: true });
  const services = normalizeResults(servicesQuery.data).results;

  const codesQuery = usePayerServiceCodes({
    page,
    page_size: 25,
    ...(payerId ? { payer: payerId } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  }, { enabled: !!payerId });
  const codes = normalizeResults(codesQuery.data).results;

  const createMutation = useCreatePayerServiceCode();
  const updateMutation = useUpdatePayerServiceCode();

  const createImportJobMutation = useCreateNhisMappingImportJob();
  const applyImportJobMutation = useApplyNhisMappingImportJob();

  const isLoading = providersQuery.isLoading || servicesQuery.isLoading || codesQuery.isLoading;
  const error = providersQuery.error || servicesQuery.error || codesQuery.error;

  const importFileRef = useRef(null);
  const [seedServices, setSeedServices] = useState(false);
  const [activeImportJobId, setActiveImportJobId] = useState('');

  const importJobQuery = useNhisMappingImportJob(
    activeImportJobId,
    {
      enabled: !!activeImportJobId,
      refetchInterval: (data) => {
        const status = data?.status;
        if (!status) return 2000;
        if (['pending', 'running', 'applying'].includes(status)) return 2000;
        return false;
      },
    }
  );
  const importJob = importJobQuery.data;
  const importSummary = importJob?.summary || {};
  const importIssues = importJob?.issues || [];

  const [dialog, setDialog] = useState({ open: false, mode: 'create', row: null });
  const [form, setForm] = useState({
    service: '',
    external_code: '',
    effective_from: '',
    effective_until: '',
    is_active: true,
  });

  const handleRefresh = async () => {
    await Promise.allSettled([
      providersQuery.refetch(),
      servicesQuery.refetch(),
      codesQuery.refetch(),
    ]);
    toast.success('Refreshed');
  };

  const setSearch = (nextSearch) => {
    setTableState({ search: nextSearch, page: 1 });
  };

  const setSelectedPayer = (nextPayer) => {
    setTableState({ selectedPayer: nextPayer, page: 1 });
  };

  const setPage = (nextPage) => {
    setTableState({ page: nextPage });
  };

  const downloadTemplate = () => {
    const csv = [
      TEMPLATE_HEADERS.join(','),
      'LAB-FBC,NHIS_CODE_123,2026-01-01,',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'nhis-service-mapping-template.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const serviceById = useMemo(() => {
    const map = new Map();
    for (const service of services) map.set(service.id, service);
    return map;
  }, [services]);

  const startImportPreview = async () => {
    if (!payerId) {
      toast.error('Select an NHIS payer');
      return;
    }
    const importFile = importFileRef.current;
    if (!importFile) {
      toast.error('Select a CSV or XLSX file');
      return;
    }
    try {
      const job = await createImportJobMutation.mutateAsync({
        payer: payerId,
        seed_services: seedServices,
        file: importFile,
      });
      setActiveImportJobId(job.id);
      toast.success('Import preview started');
    } catch (error) {
      toast.error(error.message || 'Failed to start import preview');
    }
  };

  const applyImport = async () => {
    if (!importJob?.id) return;
    try {
      await applyImportJobMutation.mutateAsync({ id: importJob.id, data: { force: false } });
      toast.success('Apply started');
    } catch (error) {
      toast.error(error.message || 'Failed to apply import');
    }
  };

  const openNewMappingDialog = () => {
    setForm({
      service: '',
      external_code: '',
      effective_from: '',
      effective_until: '',
      is_active: true,
    });
    setDialog({ open: true, mode: 'create', row: null });
  };

  const openEditMappingDialog = (row) => {
    setForm({
      service: row.service || '',
      external_code: row.external_code || '',
      effective_from: row.effective_from || '',
      effective_until: row.effective_until || '',
      is_active: !!row.is_active,
    });
    setDialog({ open: true, mode: 'edit', row });
  };

  const handleDialogChange = (open) => {
    setDialog((prev) => ({ ...prev, open }));
  };

  const saveMapping = async () => {
    if (!payerId) {
      toast.error('Select an NHIS payer first');
      return;
    }
    if (!form.service) {
      toast.error('Service is required');
      return;
    }
    if (!form.external_code.trim()) {
      toast.error('External code is required');
      return;
    }
    if (!form.effective_from) {
      toast.error('Effective from date is required');
      return;
    }
    try {
      const payload = {
        payer: payerId,
        service: form.service,
        external_code: form.external_code.trim(),
        effective_from: form.effective_from,
        effective_until: form.effective_until || null,
        is_active: form.is_active,
      };
      if (dialog.mode === 'create') {
        await createMutation.mutateAsync(payload);
        toast.success('Mapping created');
      } else {
        await updateMutation.mutateAsync({ id: dialog.row.id, data: payload });
        toast.success('Mapping updated');
      }
      setDialog({ open: false, mode: 'create', row: null });
    } catch (error) {
      toast.error(error.message || 'Failed to save mapping');
    }
  };

  const columns = useMemo(() => createMappingColumns({
    mappingMutationsAvailable,
    onEditMapping: openEditMappingDialog,
  }), [mappingMutationsAvailable]);

  if (isLoading && !providersQuery.data && !servicesQuery.data && !codesQuery.data) {
    return <PageState variant="loading" />;
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading NHIS Mappings"
        description={error.message}
        action={() => handleRefresh()}
      />
    );
  }

  return (
    <PageShell>
      <NhisMappingsHeader
        mappingMutationsAvailable={mappingMutationsAvailable}
        onDownloadTemplate={downloadTemplate}
        onNewMapping={openNewMappingDialog}
        onRefresh={handleRefresh}
        payerId={payerId}
      />

      <main className="p-4 sm:p-6 space-y-3">
        <NhisMappingsReadOnlyNotice mappingMutationsAvailable={mappingMutationsAvailable} />

        <NhisBulkImportPanel
          activeImportJobId={activeImportJobId}
          applyImportJobMutation={applyImportJobMutation}
          codesQuery={codesQuery}
          createImportJobMutation={createImportJobMutation}
          importIssues={importIssues}
          importJob={importJob}
          importJobQuery={importJobQuery}
          importSummary={importSummary}
          mappingMutationsAvailable={mappingMutationsAvailable}
          onApplyImport={applyImport}
          onFileChange={(event) => { importFileRef.current = event.target.files?.[0] || null; }}
          onStartImportPreview={startImportPreview}
          seedServices={seedServices}
          servicesQuery={servicesQuery}
          setSeedServices={setSeedServices}
        />

        <NhisMappingFilters
          nhisProviders={nhisProviders}
          payerId={payerId}
          search={search}
          selectedServiceName=""
          setSearch={setSearch}
          setSelectedPayer={setSelectedPayer}
        />

        <VirtualizedTable
          columns={columns}
          rows={codes}
          threshold={50}
          className="rounded-2xl border border-border bg-card"
        />

        <TablePagination
          currentPage={codesQuery.data?.page || page}
          totalCount={codesQuery.data?.count ?? codes.length}
          pageSize={codesQuery.data?.page_size || 25}
          countExact={codesQuery.data?.count_exact !== false && codesQuery.data?.total_is_lower_bound !== true}
          totalPages={codesQuery.data?.total_pages}
          hasNextPage={Boolean(codesQuery.data?.next)}
          hasPrevPage={(codesQuery.data?.page || page) > 1}
          canJumpToPage={false}
          onPageChange={setPage}
          itemLabel="mappings"
        />
      </main>

      <NhisMappingDialog
        createMutation={createMutation}
        dialog={dialog}
        form={form}
        onDialogChange={handleDialogChange}
        onSaveMapping={saveMapping}
        services={services}
        serviceById={serviceById}
        setForm={setForm}
        updateMutation={updateMutation}
      />
    </PageShell>
  );
}
