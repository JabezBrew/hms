import { useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useAuditLogs, useAuditFilters, exportAuditLogs } from '@/hooks/useAuditLogs';
import {
  History,
  ChevronLeft,
  ChevronRight,
  Download,
  LogIn,
  LogOut,
  UserPlus,
  Edit,
  Trash2,
  FileText,
  Eye,
  Shield,
  Activity,
  Stethoscope,
  FlaskConical,
  Pill,
  Calendar,
  AlertCircle,
  Key,
} from 'lucide-react';

/**
 * StaffActivityLog - Display audit trail for a specific staff member
 *
 * Shows all actions performed by this user with:
 * - Filterable by category
 * - Pagination
 * - Export capability
 * - Relative timestamps
 */
const StaffActivityLog = ({ userId, userName }) => {
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

  const PAGE_SIZE = 10;

  const { data, isLoading, error } = useAuditLogs(filters, page, PAGE_SIZE);
  const { data: filterOptions } = useAuditFilters();
  const logs = data?.results || [];
  const totalCount = data?.count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  // Get action icon based on action type
  const getActionIcon = (action) => {
    const icons = {
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
    return icons[action] || Activity;
  };

  // Get category styling
  const getCategoryStyle = (category) => {
    const styles = {
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
    return styles[category] || 'bg-muted text-muted-foreground border-border';
  };

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
        <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
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
      {/* Header with filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
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

          <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
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
            onChange={handleDateRangeChange}
            pickerClassName="w-[120px] font-mono text-xs h-9"
          />

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="font-mono text-xs h-9"
            >
              Clear
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between">
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {totalCount} {totalCount === 1 ? 'entry' : 'entries'}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isExporting || totalCount === 0}
            className="font-mono text-xs"
          >
            <Download className="h-4 w-4 mr-2" />
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Activity List */}
      <div className="rounded-xl border border-border overflow-hidden bg-card/50">
        {isLoading ? (
          <div className="divide-y divide-border">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-4 flex items-start gap-3">
                <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <History className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground">No activity recorded</p>
            <p className="text-xs text-muted-foreground mt-1">
              Actions performed by this user will appear here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {logs.map((log) => {
              const ActionIcon = getActionIcon(log.action);
              return (
                <div
                  key={log.id}
                  className="p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      getCategoryStyle(log.category).replace('text-', 'bg-').replace('/10', '/20')
                    )}>
                      <ActionIcon className="h-4 w-4 text-foreground/70" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground">
                          {log.action_display}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] px-1.5", getCategoryStyle(log.category))}
                        >
                          {log.category_display}
                        </Badge>
                      </div>

                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {log.description}
                      </p>

                      {/* Resource info */}
                      {log.resource_name && (
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="font-mono">{log.resource_type}</span>
                          {': '}
                          <span>{log.resource_name}</span>
                        </p>
                      )}

                      {/* Changes preview */}
                      {log.changes && Object.keys(log.changes).length > 0 && (
                        <div className="mt-2 p-2 rounded-md bg-muted/50 text-xs font-mono">
                          {Object.entries(log.changes).slice(0, 3).map(([field, change]) => (
                            <div key={field} className="flex items-baseline gap-1">
                              <span className="text-muted-foreground">{field}:</span>
                              <span className="text-rose-500 line-through">{String(change.old || '—')}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-emerald-500">{String(change.new || '—')}</span>
                            </div>
                          ))}
                          {Object.keys(log.changes).length > 3 && (
                            <span className="text-muted-foreground">
                              +{Object.keys(log.changes).length - 3} more changes
                            </span>
                          )}
                        </div>
                      )}

                      {/* Meta */}
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span title={format(new Date(log.timestamp), 'PPpp')}>
                          {log.time_ago}
                        </span>
                        {log.ip_address && (
                          <span className="font-mono">{log.ip_address}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffActivityLog;
