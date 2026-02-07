import Link2 from 'lucide-react/dist/esm/icons/link-2.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Pencil from 'lucide-react/dist/esm/icons/square-pen.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { VirtualizedTable } from '@/components/ui/VirtualizedTable';
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

export default function NhisServiceMappingsPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);

  const providersQuery = useInsuranceProviders({ page_size: 200 });
  const allProviders = normalizeResults(providersQuery.data).results;
  const nhisProviders = useMemo(
    () => allProviders.filter((p) => p?.payer_type === 'nhis'),
    [allProviders]
  );

  const [selectedPayer, setSelectedPayer] = useState('');
  const payerId = selectedPayer || nhisProviders?.[0]?.id || '';

  const servicesQuery = useServices({ page_size: 500, is_active: true });
  const services = normalizeResults(servicesQuery.data).results;

  const codesQuery = usePayerServiceCodes({
    page: 1,
    page_size: 200,
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

  const [importFile, setImportFile] = useState(null);
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

  const downloadTemplate = () => {
    const csv = [
      TEMPLATE_HEADERS.join(','),
      'LAB-FBC,NHIS_CODE_123,2026-01-01,',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nhis-service-mapping-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const serviceById = useMemo(() => {
    const map = new Map();
    for (const s of services) map.set(s.id, s);
    return map;
  }, [services]);

  const startImportPreview = async () => {
    if (!payerId) {
      toast.error('Select an NHIS payer');
      return;
    }
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
    } catch (e) {
      toast.error(e.message || 'Failed to start import preview');
    }
  };

  const applyImport = async () => {
    if (!importJob?.id) return;
    try {
      await applyImportJobMutation.mutateAsync({ id: importJob.id, data: { force: false } });
      toast.success('Apply started');
    } catch (e) {
      toast.error(e.message || 'Failed to apply import');
    }
  };

  const columns = useMemo(() => ([
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
      render: (row) => (
        <span className={cn(
          'font-mono text-xs px-2 py-1 rounded',
          row.is_active ? 'badge-chronicle-emerald' : 'bg-muted text-muted-foreground'
        )}>
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs"
          onClick={() => {
            setForm({
              service: row.service || '',
              external_code: row.external_code || '',
              effective_from: row.effective_from || '',
              effective_until: row.effective_until || '',
              is_active: !!row.is_active,
            });
            setDialog({ open: true, mode: 'edit', row });
          }}
        >
          <Pencil className="h-3 w-3 mr-2" />
          Edit
        </Button>
      ),
    },
  ]), []);

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
      <PageHeader
        title={(
          <span className="flex items-center gap-3">
            <span className="p-3 rounded-xl bg-primary/10">
              <Link2 className="h-6 w-6 text-primary" />
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
              onClick={downloadTemplate}
            >
              <Download className="h-4 w-4 mr-2" />
              CSV Template
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={handleRefresh}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button
              size="sm"
              className="font-mono text-xs"
              disabled={!payerId}
              onClick={() => {
                setForm({
                  service: '',
                  external_code: '',
                  effective_from: '',
                  effective_until: '',
                  is_active: true,
                });
                setDialog({ open: true, mode: 'create', row: null });
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Mapping
            </Button>
          </div>
        )}
      />

      <main className="p-4 sm:p-6 space-y-3">
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
                <RefreshCw className="h-4 w-4 mr-2" />
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
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="font-mono text-xs"
                  onClick={startImportPreview}
                  disabled={createImportJobMutation.isPending}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Preview Import
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="font-mono text-xs"
                  onClick={applyImport}
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
          </div>

          {importJob && importIssues.length > 0 && (
            <div className="mt-4 rounded-lg border bg-background p-3">
              <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Preview Issues (first 20)</p>
              <div className="mt-2 space-y-1">
                {importIssues.slice(0, 20).map((it, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={cn(
                      'mt-0.5 inline-flex rounded px-1.5 py-0.5 font-mono text-[10px]',
                      it.severity === 'error' ? 'badge-chronicle-rose' : 'badge-chronicle-amber'
                    )}>
                      {it.severity}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {it.row ? `Row ${it.row}: ` : ''}
                      {it.field ? `${it.field}: ` : ''}
                      {it.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">NHIS Payer</Label>
            <Select
              value={payerId}
              onValueChange={(val) => setSelectedPayer(val)}
            >
              <SelectTrigger className="font-mono text-sm">
                <SelectValue placeholder="Select NHIS payer" />
              </SelectTrigger>
              <SelectContent>
                {nhisProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="font-mono text-sm">
                    {p.name} ({p.code})
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mappings (service name/code, external code)"
                className="pl-9 font-mono text-sm"
              />
            </div>
          </div>
        </div>

        <VirtualizedTable
          columns={columns}
          rows={codes}
          threshold={50}
          className="rounded-2xl border border-border bg-card"
        />
      </main>

      <Dialog open={dialog.open} onOpenChange={(open) => setDialog((p) => ({ ...p, open }))}>
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
              <Select value={form.service} onValueChange={(val) => setForm((p) => ({ ...p, service: val }))}>
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue placeholder="Select a service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="font-mono text-sm">
                      {s.code} · {s.name}
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
                onChange={(e) => setForm((p) => ({ ...p, external_code: e.target.value }))}
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
                  onChange={(e) => setForm((p) => ({ ...p, effective_from: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Effective Until (optional)</Label>
                <Input
                  type="date"
                  value={form.effective_until}
                  onChange={(e) => setForm((p) => ({ ...p, effective_until: e.target.value }))}
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
                onClick={() => setForm((p) => ({ ...p, is_active: !p.is_active }))}
              >
                Toggle
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="font-mono text-xs"
              onClick={() => setDialog({ open: false, mode: 'create', row: null })}
            >
              Cancel
            </Button>
            <Button
              className="font-mono text-xs"
              disabled={createMutation.isPending || updateMutation.isPending}
              onClick={async () => {
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
                } catch (err) {
                  toast.error(err.message || 'Failed to save mapping');
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
