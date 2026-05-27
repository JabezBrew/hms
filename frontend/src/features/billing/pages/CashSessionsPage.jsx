/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import Wallet from 'lucide-react/dist/esm/icons/wallet.js';
import Flag from 'lucide-react/dist/esm/icons/flag.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import { useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useDebounce } from '@/hooks/use-debounce';
import { VirtualizedTable } from '@/components/ui/VirtualizedTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  useCashSessions,
  useCloseCashSession,
  useCurrentCashSession,
  useCashSessionTotals,
  useOpenCashSession,
  useReviewCashSession,
} from '@/features/billing/hooks';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

export default function CashSessionsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentPage = parseInt(searchParams.get('page') || '1', 10);
  const status = searchParams.get('status') || 'all';
  const flagged = searchParams.get('flagged') || 'all';
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search, 250);

  const filters = useMemo(() => {
    const params = { page: currentPage, page_size: 20 };
    if (debouncedSearch) params.search = debouncedSearch;
    if (status !== 'all') params.status = status;
    if (flagged === 'flagged') params.is_flagged = 'true';
    return params;
  }, [currentPage, debouncedSearch, status, flagged]);

  const {
    data: sessionsData,
    isLoading,
    error,
    refetch,
  } = useCashSessions(filters);

  const { data: currentSessionData, refetch: refetchCurrent } = useCurrentCashSession();
  const currentSession = currentSessionData?.session || null;
  const { data: currentTotalsData } = useCashSessionTotals(currentSession?.id, { enabled: !!currentSession?.id });

  const openCashSessionMutation = useOpenCashSession();
  const closeCashSessionMutation = useCloseCashSession();
  const reviewCashSessionMutation = useReviewCashSession();

  const [openFloat, setOpenFloat] = useState('0.00');
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [countedCash, setCountedCash] = useState('');

  const [reviewDialog, setReviewDialog] = useState({ open: false, session: null });
  const [reviewNotes, setReviewNotes] = useState('');

  const sessions = sessionsData?.results || [];
  const totalCount = sessionsData?.count || 0;
  const pageSize = 20;
  const totalPages = Math.ceil(totalCount / pageSize);
  const hasNext = !!sessionsData?.next;
  const hasPrev = !!sessionsData?.previous;

  const isAdmin = user?.role === 'admin';
  const cashSessionReviewAvailable = !isRustV2ApiMode();

  const handleFilterChange = useCallback((key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
      next.set('page', '1');
      return next;
    });
  }, [setSearchParams]);

  const handlePageChange = useCallback((newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(newPage));
      return next;
    });
  }, [setSearchParams]);

  const columns = useMemo(() => ([
    {
      key: 'opened_at',
      header: 'Opened',
      width: '220px',
      render: (row) => (
        <div>
          <p className="font-mono text-sm text-foreground">{formatDateTime(row.opened_at)}</p>
          <p className="font-mono text-xs text-muted-foreground">
            Opened by {row.opened_by_name || '—'}
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
          "font-mono text-xs px-2 py-1 rounded inline-flex items-center gap-1",
          row.status === 'open' ? 'badge-chronicle-amber' : 'badge-chronicle-emerald'
        )}>
          {row.status === 'open' ? 'Open' : 'Closed'}
        </span>
      ),
    },
    {
      key: 'cash',
      header: 'Expected Cash',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <span className="font-mono text-sm text-foreground">
          {row.status === 'closed' ? formatCurrency(row.expected_cash_amount) : '—'}
        </span>
      ),
    },
    {
      key: 'counted',
      header: 'Counted',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <span className="font-mono text-sm text-foreground">
          {row.status === 'closed' ? formatCurrency(row.counted_cash_amount) : '—'}
        </span>
      ),
    },
    {
      key: 'variance',
      header: 'Variance',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <span className={cn(
          "font-mono text-sm",
          row.status === 'closed' && (parseFloat(row.variance_cash_amount) !== 0) ? 'text-rose-600' : 'text-muted-foreground'
        )}>
          {row.status === 'closed' ? formatCurrency(row.variance_cash_amount) : '—'}
        </span>
      ),
    },
    {
      key: 'flag',
      header: 'Flag',
      width: '120px',
      render: (row) => (
        row.is_flagged ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-1 rounded badge-chronicle-rose">
            <Flag className="size-3" />
            Flagged
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground/50">-</span>
        )
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '160px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        isAdmin && cashSessionReviewAvailable && row.status === 'closed' ? (
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-xs h-8 px-2"
            onClick={() => {
              setReviewNotes(row.review_notes || '');
              setReviewDialog({ open: true, session: row });
            }}
          >
            Review
          </Button>
        ) : null
      ),
    },
  ]), [cashSessionReviewAvailable, isAdmin]);

  if (isLoading && !sessionsData) {
    return (
      <PageState variant="loading">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 rounded-2xl" />
      </PageState>
    );
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Cash Sessions"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={(
          <span className="flex items-center gap-3">
            <span className="p-3 rounded-xl bg-primary/10">
              <Wallet className="size-6 text-primary" />
            </span>
            Cash Sessions
          </span>
        )}
        description="Cash controls and close-of-day reconciliation"
        actions={(
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/billing')}
              className="font-mono text-xs"
            >
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetch();
                refetchCurrent();
              }}
              className="font-mono text-xs"
            >
              <RefreshCw className="size-4 mr-2" />
              Refresh
            </Button>
          </div>
        )}
      />

      <main className="p-4 sm:p-6 space-y-6">
        {isAdmin && !cashSessionReviewAvailable && (
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Rust V2 read-only review
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cash session review notes are not available in Rust V2 mode yet. Cashiers can still
              open and close sessions through the Rust backend.
            </p>
          </div>
        )}

        {/* Current session card */}
        <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg text-foreground mb-1">Current Session</h2>
              <p className="font-mono text-xs text-muted-foreground">
                Your active cashier session in this facility context.
              </p>
            </div>
            {currentSession ? (
              <span className="inline-flex items-center gap-2 font-mono text-xs px-2.5 py-1 rounded badge-chronicle-amber">
                <AlertTriangle className="size-3.5" />
                Open
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 font-mono text-xs px-2.5 py-1 rounded bg-muted text-muted-foreground">
                <CheckCircle className="size-3.5" />
                None
              </span>
            )}
          </div>

          {currentSession ? (
            <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-xl bg-muted/20 border border-border/50 p-4">
                <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Opened At</p>
                <p className="font-mono text-sm text-foreground">{formatDateTime(currentSession.opened_at)}</p>
                <p className="font-mono text-xs text-muted-foreground mt-2">
                  Float: {formatCurrency(currentSession.opening_float_amount)}
                </p>
              </div>
              <div className="rounded-xl bg-muted/20 border border-border/50 p-4">
                <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Expected Cash So Far</p>
                <p className="font-display text-2xl text-foreground">
                  {formatCurrency(currentTotalsData?.expected_cash_amount || 0)}
                </p>
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  Includes float + movements + cash payments
                </p>
              </div>
              <div className="rounded-xl bg-muted/20 border border-border/50 p-4 flex flex-col justify-between">
                <div>
                  <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Closeout</p>
                  <p className="text-sm text-foreground">
                    Enter counted cash to close and record variance.
                  </p>
                </div>
                <Button
                  className="mt-4 font-mono text-xs"
                  onClick={() => {
                    setCountedCash('');
                    setCloseDialogOpen(true);
                  }}
                >
                  Close Session
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1 space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Opening Float (GHS)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={openFloat}
                  onChange={(e) => setOpenFloat(e.target.value)}
                  className="font-mono"
                />
              </div>
              <Button
                className="font-mono text-xs"
                disabled={openCashSessionMutation.isPending}
                onClick={async () => {
                  try {
                    await openCashSessionMutation.mutateAsync({
                      opening_float_amount: parseFloat(openFloat || 0),
                    });
                    toast.success('Cash session opened');
                  } catch (err) {
                    toast.error(err.message || 'Failed to open cash session');
                  }
                }}
              >
                {openCashSessionMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Opening…
                  </>
                ) : (
                  'Open Session'
                )}
              </Button>
            </div>
          )}
        </section>

        {/* Filters */}
        <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Search</Label>
              <div className="relative">
                <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Drawer, notes, staff..."
                  className="pl-9 font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Status</Label>
              <Select value={status} onValueChange={(v) => handleFilterChange('status', v)}>
                <SelectTrigger className="font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="font-mono text-sm">All</SelectItem>
                  <SelectItem value="open" className="font-mono text-sm">Open</SelectItem>
                  <SelectItem value="closed" className="font-mono text-sm">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Flagged</Label>
              <Select value={flagged} onValueChange={(v) => handleFilterChange('flagged', v)}>
                <SelectTrigger className="font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="font-mono text-sm">All</SelectItem>
                  <SelectItem value="flagged" className="font-mono text-sm">Flagged only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* List */}
        <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg text-foreground">Sessions</h2>
            <p className="font-mono text-xs text-muted-foreground">
              {totalCount} total
            </p>
          </div>

          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cash sessions found.</p>
          ) : (
            <VirtualizedTable
              rows={sessions}
              columns={columns}
              threshold={50}
            />
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="font-mono text-xs text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  disabled={!hasPrev || currentPage <= 1}
                  onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  disabled={!hasNext}
                  onClick={() => handlePageChange(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Close dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Cash Session</DialogTitle>
            <DialogDescription>
              Enter the counted cash amount to compute variance and close the session.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Counted Cash (GHS)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Expected so far: {formatCurrency(currentTotalsData?.expected_cash_amount || 0)}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" className="font-mono text-xs" onClick={() => setCloseDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="font-mono text-xs"
              disabled={closeCashSessionMutation.isPending}
              onClick={async () => {
                if (!currentSession) return;
                try {
                  await closeCashSessionMutation.mutateAsync({
                    sessionId: currentSession.id,
                    data: { counted_cash_amount: parseFloat(countedCash || 0) },
                  });
                  toast.success('Session closed');
                  setCloseDialogOpen(false);
                } catch (err) {
                  toast.error(err.message || 'Failed to close session');
                }
              }}
            >
              {closeCashSessionMutation.isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Closing…
                </>
              ) : (
                'Close'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review dialog */}
      {cashSessionReviewAvailable && (
        <Dialog
          open={reviewDialog.open}
          onOpenChange={(next) => setReviewDialog((prev) => ({ ...prev, open: next }))}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Review Session</DialogTitle>
              <DialogDescription>
                Add an internal review note (admin only).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Review Notes</Label>
              <Textarea
                rows={4}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add notes about variance, investigation steps, approvals..."
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="font-mono text-xs"
                onClick={() => setReviewDialog({ open: false, session: null })}
              >
                Cancel
              </Button>
              <Button
                className="font-mono text-xs"
                disabled={reviewCashSessionMutation.isPending}
                onClick={async () => {
                  const session = reviewDialog.session;
                  if (!session) return;
                  try {
                    await reviewCashSessionMutation.mutateAsync({
                      sessionId: session.id,
                      data: { review_notes: reviewNotes || null },
                    });
                    toast.success('Review saved');
                    setReviewDialog({ open: false, session: null });
                  } catch (err) {
                    toast.error(err.message || 'Failed to save review');
                  }
                }}
              >
                {reviewCashSessionMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}

function formatCurrency(amount) {
  return GHS_CURRENCY_FORMATTER.format(amount || 0);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return date.toLocaleString('en-GH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
