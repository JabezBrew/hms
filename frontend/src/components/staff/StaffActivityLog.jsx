/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import History from 'lucide-react/dist/esm/icons/history.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import LogIn from 'lucide-react/dist/esm/icons/log-in.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Key from 'lucide-react/dist/esm/icons/key.js';
import { useState } from 'react';
import format from 'date-fns/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useAuditLogs, useAuditFilters, exportAuditLogs } from '@/features/admin/hooks';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

const PAGE_SIZE = 10;
const ACTIVITY_SKELETON_KEYS = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5'];

const ACTION_ICONS = {
  LOGIN: LogIn,
  LOGOUT: LogOut,
  LOGIN_FAILED: AlertCircle,
  PASSWORD_CHANGE: Key,
  CREATE: UserPlus,
  READ: Eye,
  UPDATE: Edit,
  DELETE: Trash2,
  NOTE_CREATE: FileText,
  NOTE_UPDATE: FileText,
  NOTE_DELETE: FileText,
  ORDER_CREATE: FileText,
};

const CATEGORY_STYLES = {
  AUTHENTICATION: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
  PATIENT: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  CLINICAL: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  ENCOUNTER: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  ADMIN: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
  WARD: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
  APPOINTMENT: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
  LABORATORY: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30',
  DRUG_SAFETY: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  REFERRAL: 'bg-teal-500/10 text-teal-600 border-teal-500/30',
};

function getActionIcon(action) {
  return ACTION_ICONS[action] || Activity;
}

function getCategoryStyle(category) {
  return CATEGORY_STYLES[category] || 'bg-muted text-muted-foreground border-border';
}

/**
 * StaffActivityLog - Display audit trail for a specific staff member
 *
 * Shows all actions performed by this user with:
 * - Filterable by category
 * - Pagination
 * - Export capability
 * - Relative timestamps
 */
const StaffActivityLog = ({ userId }) => {
  if (isRustV2ApiMode()) {
    return <StaffActivityUnavailable />;
  }

  return <StaffActivityLogLegacy userId={userId} />;
};

function StaffActivityUnavailable() {
  return (
    <div className="p-6 rounded-xl bg-muted/30 border border-border text-center">
      <History className="size-8 text-muted-foreground mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">
        Staff-specific activity logs are not available in Rust V2 mode yet.
      </p>
    </div>
  );
}

function StaffActivityLogLegacy({ userId }) {
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  // Handle date range change - only called when both dates are selected or both cleared
  const handleDateRangeChange = ({ from, to }) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const filters = {
    user_id: userId,
    ...(categoryFilter !== 'all' && { category: categoryFilter }),
    ...(actionFilter !== 'all' && { action: actionFilter }),
    ...(dateFrom && { start_date: format(dateFrom, 'yyyy-MM-dd') }),
    ...(dateTo && { end_date: format(dateTo, 'yyyy-MM-dd') }),
  };

  const hasActiveFilters = categoryFilter !== 'all' || actionFilter !== 'all' || dateFrom || dateTo;

  const { data, isLoading, error } = useAuditLogs(filters, page, PAGE_SIZE);
  const { data: filterOptions } = useAuditFilters();
  const logs = data?.results || [];
  const totalCount = data?.count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  // Handle export
  const handleExport = async () => {
    try {
      setIsExporting(true);
      await exportAuditLogs(filters);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  if (error) {
    return (
      <div className="p-6 rounded-xl bg-destructive/10 border border-destructive/30 text-center">
        <AlertCircle className="size-8 text-destructive mx-auto mb-2" />
        <p className="text-sm text-destructive">Failed to load activity logs</p>
      </div>
    );
  }

  // Clear all filters
  const handleClearFilters = () => {
    setCategoryFilter('all');
    setActionFilter('all');
    setDateFrom(null);
    setDateTo(null);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <ActivityLogToolbar
        actionFilter={actionFilter}
        categoryFilter={categoryFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        filterOptions={filterOptions}
        hasActiveFilters={hasActiveFilters}
        isExporting={isExporting}
        onActionFilterChange={(value) => {
          setActionFilter(value);
          setPage(1);
        }}
        onCategoryFilterChange={(value) => {
          setCategoryFilter(value);
          setPage(1);
        }}
        onClearFilters={handleClearFilters}
        onDateRangeChange={handleDateRangeChange}
        onExport={handleExport}
        totalCount={totalCount}
      />
      <ActivityLogList isLoading={isLoading} logs={logs} />
      <TablePagination
        canJumpToPage
        currentPage={page}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        totalPages={totalPages}
        onPageChange={setPage}
        itemLabel="entries"
      />
    </div>
  );
}

function ActivityLogToolbar({
  actionFilter,
  categoryFilter,
  dateFrom,
  dateTo,
  filterOptions,
  hasActiveFilters,
  isExporting,
  onActionFilterChange,
  onCategoryFilterChange,
  onClearFilters,
  onDateRangeChange,
  onExport,
  totalCount,
}) {
  return (
    <div className="flex flex-col gap-3">
      <ActivityFilters
        actionFilter={actionFilter}
        categoryFilter={categoryFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        filterOptions={filterOptions}
        hasActiveFilters={hasActiveFilters}
        onActionFilterChange={onActionFilterChange}
        onCategoryFilterChange={onCategoryFilterChange}
        onClearFilters={onClearFilters}
        onDateRangeChange={onDateRangeChange}
      />
      <ActivityToolbarActions
        isExporting={isExporting}
        onExport={onExport}
        totalCount={totalCount}
      />
    </div>
  );
}

function ActivityFilters({
  actionFilter,
  categoryFilter,
  dateFrom,
  dateTo,
  filterOptions,
  hasActiveFilters,
  onActionFilterChange,
  onCategoryFilterChange,
  onClearFilters,
  onDateRangeChange,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
        <SelectTrigger className="w-[150px] font-mono text-xs h-9">
          <SelectValue placeholder="All categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {filterOptions?.categories?.map((cat) => (
            <SelectItem key={cat.value} value={cat.value}>
              {cat.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={actionFilter} onValueChange={onActionFilterChange}>
        <SelectTrigger className="w-[150px] font-mono text-xs h-9">
          <SelectValue placeholder="All actions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All actions</SelectItem>
          {filterOptions?.actions?.map((action) => (
            <SelectItem key={action.value} value={action.value}>
              {action.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DateRangePicker
        from={dateFrom}
        to={dateTo}
        onChange={onDateRangeChange}
        pickerClassName="w-[120px] font-mono text-xs h-9"
      />

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="font-mono text-xs h-9"
        >
          Clear
        </Button>
      )}
    </div>
  );
}

function ActivityToolbarActions({ isExporting, onExport, totalCount }) {
  return (
    <div className="flex items-center justify-between">
      {totalCount > 0 && (
        <span className="text-xs text-muted-foreground">
          {totalCount} {totalCount === 1 ? 'entry' : 'entries'}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={onExport}
        disabled={isExporting || totalCount === 0}
        className="font-mono text-xs"
      >
        <Download className="size-4 mr-2" />
        {isExporting ? 'Exporting...' : 'Export'}
      </Button>
    </div>
  );
}

function ActivityLogList({ isLoading, logs }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card/50">
      {isLoading ? <ActivitySkeletonList /> : <ActivityLogEntries logs={logs} />}
    </div>
  );
}

function ActivitySkeletonList() {
  return (
    <div className="divide-y divide-border">
      {ACTIVITY_SKELETON_KEYS.map((key) => (
        <div key={key} className="p-4 flex items-start gap-3">
          <Skeleton className="size-8 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityLogEntries({ logs }) {
  if (logs.length === 0) {
    return <EmptyActivityState />;
  }

  return (
    <div className="divide-y divide-border">
      {logs.map((log) => (
        <ActivityLogEntry key={log.id} log={log} />
      ))}
    </div>
  );
}

function EmptyActivityState() {
  return (
    <div className="p-12 text-center">
      <History className="size-12 text-muted-foreground/50 mx-auto mb-3" />
      <p className="text-muted-foreground">No activity recorded</p>
      <p className="text-xs text-muted-foreground mt-1">
        Actions performed by this user will appear here
      </p>
    </div>
  );
}

function ActivityLogEntry({ log }) {
  const ActionIcon = getActionIcon(log.action);
  const categoryStyle = getCategoryStyle(log.category);

  return (
    <div className="p-4 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className={cn(
          "size-8 rounded-lg flex items-center justify-center shrink-0",
          categoryStyle.replace('text-', 'bg-').replace('/10', '/20')
        )}>
          <ActionIcon className="size-4 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <ActivityEntryHeader log={log} categoryStyle={categoryStyle} />
          <p className="text-sm text-muted-foreground line-clamp-2">
            {log.description}
          </p>
          {log.resource_name && <ActivityResourceInfo log={log} />}
          {log.changes && Object.keys(log.changes).length > 0 && (
            <ActivityChangesPreview changes={log.changes} />
          )}
          <ActivityEntryMeta log={log} />
        </div>
      </div>
    </div>
  );
}

function ActivityEntryHeader({ log, categoryStyle }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-1">
      <span className="text-sm font-medium text-foreground">
        {log.action_display}
      </span>
      <Badge
        variant="outline"
        className={cn("text-[10px] px-1.5", categoryStyle)}
      >
        {log.category_display}
      </Badge>
    </div>
  );
}

function ActivityResourceInfo({ log }) {
  return (
    <p className="text-xs text-muted-foreground mt-1">
      <span className="font-mono">{log.resource_type}</span>
      {': '}
      <span>{log.resource_name}</span>
    </p>
  );
}

function ActivityChangesPreview({ changes }) {
  const changeEntries = Object.entries(changes);

  return (
    <div className="mt-2 p-2 rounded-md bg-muted/50 text-xs font-mono">
      {changeEntries.slice(0, 3).map(([field, change]) => (
        <div key={field} className="flex items-baseline gap-1">
          <span className="text-muted-foreground">{field}:</span>
          <span className="text-rose-500 line-through">{String(change.old || '—')}</span>
          <span className="text-muted-foreground">→</span>
          <span className="text-emerald-500">{String(change.new || '—')}</span>
        </div>
      ))}
      {changeEntries.length > 3 && (
        <span className="text-muted-foreground">
          +{changeEntries.length - 3} more changes
        </span>
      )}
    </div>
  );
}

function ActivityEntryMeta({ log }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
      <span title={format(new Date(log.timestamp), 'PPpp')}>
        {log.time_ago}
      </span>
      {log.ip_address && (
        <span className="font-mono">{log.ip_address}</span>
      )}
    </div>
  );
}

export default StaffActivityLog;
