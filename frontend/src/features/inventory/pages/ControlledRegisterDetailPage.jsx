import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ControlledDispenseForm,
  ControlledCountForm,
  WastageForm,
} from '@/components/inventory/ControlledSubstanceForms';
import {
  useControlledRegister,
  useControlledRegisterEntries,
  useControlledDiscrepancies,
} from '@/features/inventory/hooks';
import { format, parseISO, differenceInDays } from 'date-fns';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import AlertOctagon from 'lucide-react/dist/esm/icons/alert-octagon.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Minus from 'lucide-react/dist/esm/icons/minus.js';

const US_NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

const ENTRY_TYPE_CONFIG = {
  receipt: { label: 'Receipt', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10', icon: Plus },
  dispense: { label: 'Dispense', color: 'text-rose-500', bgColor: 'bg-rose-500/10', icon: Minus },
  wastage: { label: 'Wastage', color: 'text-amber-500', bgColor: 'bg-amber-500/10', icon: Trash2 },
  count: { label: 'Count', color: 'text-sky-500', bgColor: 'bg-sky-500/10', icon: ClipboardCheck },
  adjustment: { label: 'Adjustment', color: 'text-violet-500', bgColor: 'bg-violet-500/10', icon: FileText },
  transfer_in: { label: 'Transfer In', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10', icon: Plus },
  transfer_out: { label: 'Transfer Out', color: 'text-rose-500', bgColor: 'bg-rose-500/10', icon: Minus },
};

function getEntryTypeConfig(type) {
  return ENTRY_TYPE_CONFIG[type?.toLowerCase()] || { label: type || 'Unknown', color: 'text-muted-foreground', bgColor: 'bg-muted', icon: FileText };
}

function formatNumber(value) {
  return US_NUMBER_FORMATTER.format(value || 0);
}

/**
 * EntriesTable - Register entries with balance tracking
 */
function EntriesTable({ registerId, page, onPageChange }) {
  const { data: entriesData, isLoading } = useControlledRegisterEntries(registerId, { page, page_size: 20 });

  const entries = entriesData?.results || entriesData || [];
  const totalCount = entriesData?.count || entries.length;
  const totalPages = Math.ceil(totalCount / 20);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="size-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">
          No entries recorded
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                #
              </th>
              <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Date/Time
              </th>
              <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Type
              </th>
              <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Qty
              </th>
              <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Before
              </th>
              <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                After
              </th>
              <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                By
              </th>
              <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Witness
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((entry, index) => {
              const typeConfig = getEntryTypeConfig(entry.entry_type || entry.type);
              const TypeIcon = typeConfig.icon;
              const isPositive = ['receipt', 'transfer_in', 'adjustment'].includes(entry.entry_type?.toLowerCase()) && entry.quantity > 0;
              const isCount = entry.entry_type?.toLowerCase() === 'count';

              return (
                <tr key={entry.id || index} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm text-muted-foreground">
                    {entry.entry_number || index + 1}
                  </td>
                  <td className="px-4 py-3">
                    {entry.created_at ? (
                      <div>
                        <p className="text-sm font-mono">
                          {format(parseISO(entry.created_at), 'MMM d, yyyy')}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground">
                          {format(parseISO(entry.created_at), 'HH:mm')}
                        </p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={cn('text-xs', typeConfig.bgColor, typeConfig.color)}>
                      <TypeIcon className="size-3 mr-1" />
                      {typeConfig.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'font-mono text-sm font-semibold',
                      isCount ? 'text-sky-500' : (isPositive ? 'text-emerald-500' : 'text-rose-500')
                    )}>
                      {isCount ? '' : (isPositive ? '+' : '-')}{formatNumber(Math.abs(entry.quantity))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">
                    {formatNumber(entry.balance_before)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
                    {formatNumber(entry.balance_after)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {entry.performed_by_name || entry.created_by_name || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {entry.witness_name || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
              <ChevronLeft className="size-4 mr-1" />
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
              Next
              <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * DiscrepanciesTab - List of discrepancies for this register
 */
function DiscrepanciesTab({ registerId }) {
  const { data: discrepanciesData, isLoading } = useControlledDiscrepancies({ register: registerId });

  const discrepancies = discrepanciesData?.results || discrepanciesData || [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!discrepancies.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertOctagon className="size-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">
          No discrepancies recorded
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {discrepancies.map((discrepancy, index) => (
        <Card
          key={discrepancy.id || index}
          className={cn(
            'bg-card/30',
            discrepancy.status === 'resolved'
              ? 'border-emerald-500/30'
              : discrepancy.status === 'escalated'
              ? 'border-rose-500/30'
              : 'border-amber-500/30'
          )}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs',
                    discrepancy.status === 'resolved'
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                      : discrepancy.status === 'escalated'
                      ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                      : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                  )}
                >
                  {discrepancy.status || 'Pending'}
                </Badge>
                {discrepancy.created_at && (
                  <span className="text-xs font-mono text-muted-foreground">
                    {format(parseISO(discrepancy.created_at), 'MMM d, yyyy HH:mm')}
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Discrepancy</p>
                <p className={cn(
                  'font-mono text-lg font-semibold',
                  (discrepancy.discrepancy_amount || 0) > 0 ? 'text-sky-500' : 'text-rose-500'
                )}>
                  {(discrepancy.discrepancy_amount || 0) > 0 ? '+' : ''}{discrepancy.discrepancy_amount}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm mb-3">
              <div>
                <p className="text-xs text-muted-foreground">Expected</p>
                <p className="font-mono">{formatNumber(discrepancy.expected_balance)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Actual</p>
                <p className="font-mono">{formatNumber(discrepancy.actual_count)}</p>
              </div>
            </div>

            {discrepancy.notes && (
              <p className="text-sm text-muted-foreground border-t border-border pt-3">
                {discrepancy.notes}
              </p>
            )}

            {discrepancy.resolution_notes && (
              <div className="bg-emerald-500/5 rounded-lg p-3 mt-3">
                <p className="text-xs text-emerald-500 font-medium mb-1">Resolution</p>
                <p className="text-sm">{discrepancy.resolution_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ControlledRegisterLoadingState() {
  return (
    <PageState variant="loading" fullHeight={false} className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-10" />
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-48 mt-2" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-80" />
      </div>
    </PageState>
  );
}

function ControlledRegisterErrorState({ error, onBack, onRetry }) {
  return (
    <PageState
      variant="error"
      title="Error Loading Register"
      description={error.message}
      action={(
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="size-4 mr-2" />
            Back to Registers
          </Button>
          <Button onClick={onRetry}>
            <RefreshCw className="size-4 mr-2" />
            Retry
          </Button>
        </div>
      )}
    />
  );
}

function ControlledRegisterNotFoundState({ onBack }) {
  return (
    <PageState
      variant="empty"
      title="Register Not Found"
      description="The requested controlled substance register does not exist."
      action={(
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Registers
        </Button>
      )}
    />
  );
}

function ControlledRegisterHeader({
  register,
  onBack,
  onOpenCount,
  onOpenDispense,
  onOpenWastage,
  onRefresh,
}) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <span>{register.item_name || register.name}</span>
          <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-500 border-rose-500/30">
            <Shield className="size-3 mr-1" />
            Controlled
          </Badge>
        </span>
      )}
      description={(
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          {register.location_name && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" />
              <span className="text-sm">{register.location_name}</span>
            </span>
          )}
          {register.schedule && (
            <Badge variant="outline" className="text-xs">
              Schedule {register.schedule}
            </Badge>
          )}
        </div>
      )}
      actions={(
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={onOpenCount}>
            <ClipboardCheck className="size-4 mr-2" />
            Count
          </Button>
          <Button onClick={onOpenDispense} className="bg-rose-600 hover:bg-rose-700">
            <Pill className="size-4 mr-2" />
            Dispense
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Controlled register actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpenWastage}>
                <Trash2 className="size-4 mr-2" />
                Record Wastage
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Printer className="size-4 mr-2" />
                Print Register
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRefresh}>
                <RefreshCw className="size-4 mr-2" />
                Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        className="w-fit -ml-2"
        onClick={onBack}
      >
        <ArrowLeft className="size-4 mr-2" />
        Back to Controlled Substances
      </Button>
    </PageHeader>
  );
}

function ControlledRegisterAlerts({ register, hasDiscrepancy, auditDue, lastAuditDays }) {
  if (!hasDiscrepancy && !auditDue) {
    return null;
  }

  return (
    <div className="space-y-2">
      {hasDiscrepancy && (
        <Card className="bg-rose-500/5 border-rose-500/30">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertOctagon className="size-5 text-rose-500" />
            <div>
              <p className="text-sm font-medium text-rose-500">Unresolved Discrepancy</p>
              <p className="text-xs text-muted-foreground">
                This register has {register.discrepancy_count || 'an'} unresolved discrepanc{(register.discrepancy_count || 1) > 1 ? 'ies' : 'y'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {auditDue && (
        <Card className="bg-amber-500/5 border-amber-500/30">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="size-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-amber-500">Audit Overdue</p>
              <p className="text-xs text-muted-foreground">
                Last audit was {lastAuditDays} days ago. Physical count recommended.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ControlledRegisterBalanceCard({ register }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardContent className="py-6">
        <div className="flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-1">Current Balance</p>
            <p className="text-6xl font-mono font-bold">
              {formatNumber(register.current_balance || 0)}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {register.unit_of_measure || 'units'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ControlledRegisterTabs({
  registerId,
  activeTab,
  entriesPage,
  hasDiscrepancy,
  discrepancyCount,
  onTabChange,
  onEntriesPageChange,
}) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="entries" className="font-mono text-xs">
          <FileText className="size-4 mr-2" />
          Entries
        </TabsTrigger>
        <TabsTrigger value="discrepancies" className="font-mono text-xs">
          <AlertOctagon className="size-4 mr-2" />
          Discrepancies
          {hasDiscrepancy && (
            <Badge variant="destructive" className="ml-2 h-5 px-1.5">
              {discrepancyCount || '!'}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="entries" className="mt-6">
        <EntriesTable
          registerId={registerId}
          page={entriesPage}
          onPageChange={onEntriesPageChange}
        />
      </TabsContent>

      <TabsContent value="discrepancies" className="mt-6">
        <DiscrepanciesTab registerId={registerId} />
      </TabsContent>
    </Tabs>
  );
}

function ControlledRegisterDetailsCard({ register, auditDue }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <MapPin className="size-4 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Location</p>
            <p className="text-sm">{register.location_name || 'N/A'}</p>
          </div>
        </div>

        {register.item_sku && (
          <div className="flex items-start gap-3">
            <Shield className="size-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">SKU</p>
              <p className="text-sm font-mono">{register.item_sku}</p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3">
          <Calendar className="size-4 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Last Audit</p>
            {register.last_audit_date ? (
              <p className={cn(
                'text-sm font-mono',
                auditDue && 'text-amber-500'
              )}>
                {format(parseISO(register.last_audit_date), 'MMM d, yyyy')}
                {auditDue && ' (Overdue)'}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Never</p>
            )}
          </div>
        </div>

        {register.created_at && (
          <div className="flex items-start gap-3">
            <Clock className="size-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Register Created</p>
              <p className="text-sm font-mono">
                {format(parseISO(register.created_at), 'MMM d, yyyy')}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ControlledRegisterActivitySummary({ register }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Activity Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total Entries</span>
          <span className="font-mono">{formatNumber(register.entry_count || 0)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total Dispensed</span>
          <span className="font-mono text-rose-500">
            {formatNumber(register.total_dispensed || 0)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total Received</span>
          <span className="font-mono text-emerald-500">
            {formatNumber(register.total_received || 0)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total Wastage</span>
          <span className="font-mono text-amber-500">
            {formatNumber(register.total_wastage || 0)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ControlledRegisterForms({
  register,
  dispenseOpen,
  countOpen,
  wastageOpen,
  onDispenseOpenChange,
  onCountOpenChange,
  onWastageOpenChange,
  onSuccess,
}) {
  return (
    <>
      <ControlledDispenseForm
        register={register}
        open={dispenseOpen}
        onOpenChange={onDispenseOpenChange}
        onSuccess={onSuccess}
      />

      <ControlledCountForm
        register={register}
        open={countOpen}
        onOpenChange={onCountOpenChange}
        onSuccess={onSuccess}
      />

      <WastageForm
        register={register}
        open={wastageOpen}
        onOpenChange={onWastageOpenChange}
        onSuccess={onSuccess}
      />
    </>
  );
}

/**
 * ControlledRegisterDetailPage - Detailed view of controlled substance register
 */
export default function ControlledRegisterDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') || 'entries';
  const action = searchParams.get('action');
  const [entriesPage, setEntriesPage] = useState(1);

  const [dispenseOpen, setDispenseOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [wastageOpen, setWastageOpen] = useState(false);

  const { data: register, isLoading, error, refetch } = useControlledRegister(id);

  // Handle action from URL
  useEffect(() => {
    if (action === 'dispense') {
      setDispenseOpen(true);
    } else if (action === 'count') {
      setCountOpen(true);
    } else if (action === 'wastage') {
      setWastageOpen(true);
    }
  }, [action]);

  const handleTabChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', value);
      params.delete('action');
      return params;
    });
  };

  const clearAction = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('action');
      return params;
    });
  };

  const handleBack = () => {
    navigate('/inventory/controlled');
  };

  const handleFormSuccess = () => {
    clearAction();
    refetch();
  };

  if (isLoading) {
    return <ControlledRegisterLoadingState />;
  }

  if (error) {
    return <ControlledRegisterErrorState error={error} onBack={handleBack} onRetry={refetch} />;
  }

  if (!register) {
    return <ControlledRegisterNotFoundState onBack={handleBack} />;
  }

  const hasDiscrepancy = register.has_discrepancy || register.discrepancy_count > 0;
  const lastAuditDays = register.last_audit_date
    ? differenceInDays(new Date(), parseISO(register.last_audit_date))
    : null;
  const auditDue = lastAuditDays !== null && lastAuditDays > 30;

  return (
    <PageShell>
      <ControlledRegisterHeader
        register={register}
        onBack={handleBack}
        onOpenCount={() => setCountOpen(true)}
        onOpenDispense={() => setDispenseOpen(true)}
        onOpenWastage={() => setWastageOpen(true)}
        onRefresh={refetch}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <ControlledRegisterAlerts
          register={register}
          hasDiscrepancy={hasDiscrepancy}
          auditDue={auditDue}
          lastAuditDays={lastAuditDays}
        />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <ControlledRegisterBalanceCard register={register} />

          <ControlledRegisterTabs
            registerId={id}
            activeTab={activeTab}
            entriesPage={entriesPage}
            hasDiscrepancy={hasDiscrepancy}
            discrepancyCount={register.discrepancy_count}
            onTabChange={handleTabChange}
            onEntriesPageChange={setEntriesPage}
          />
        </div>

        <div className="space-y-6">
          <ControlledRegisterDetailsCard register={register} auditDue={auditDue} />

          <ControlledRegisterActivitySummary register={register} />
        </div>
      </div>

      <ControlledRegisterForms
        register={register}
        dispenseOpen={dispenseOpen}
        countOpen={countOpen}
        wastageOpen={wastageOpen}
        onDispenseOpenChange={(open) => {
          setDispenseOpen(open);
          if (!open) clearAction();
        }}
        onCountOpenChange={(open) => {
          setCountOpen(open);
          if (!open) clearAction();
        }}
        onWastageOpenChange={(open) => {
          setWastageOpen(open);
          if (!open) clearAction();
        }}
        onSuccess={handleFormSuccess}
      />
      </div>
    </PageShell>
  );
}
