import { useState, useMemo, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AuditLogCard } from '@/components/admin/AuditLogCard';
import {
  useAuditLogs,
  useAuditStats,
  useAuditFilters,
  exportAuditLogs,
} from '@/hooks/useAuditLogs';
import {
  Search,
  Shield,
  Filter,
  Download,
  RefreshCw,
  X,
  Calendar,
  Activity,
  TrendingUp,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

/**
 * AuditLogsPage - Admin audit logs with Chronicle styling
 */
const AuditLogsPage = () => {
  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedAction, setSelectedAction] = useState('all');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Build filters object
  const filters = useMemo(() => {
    const f = {};
    if (selectedCategory !== 'all') f.category = selectedCategory;
    if (selectedAction !== 'all') f.action = selectedAction;
    if (debouncedSearch) f.search = debouncedSearch;
    return f;
  }, [selectedCategory, selectedAction, debouncedSearch]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch data
  const {
    data: logsData,
    isLoading,
    isError,
    refetch,
  } = useAuditLogs(filters, currentPage);

  const { data: stats } = useAuditStats();
  const { data: filterOptions } = useAuditFilters();

  // Extract logs from response (handle both paginated and direct array)
  const allLogs = useMemo(() => {
    if (!logsData) return [];
    // Handle paginated response
    if (logsData.results) return logsData.results;
    // Handle direct array response
    if (Array.isArray(logsData)) return logsData;
    return [];
  }, [logsData]);

  // Pagination info
  const hasNextPage = logsData?.next;
  const hasPrevPage = logsData?.previous;
  const totalCount = logsData?.count || allLogs.length;

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  // Handlers
  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedAction('all');
    setCurrentPage(1);
  };

  const handleExport = async () => {
    try {
      await exportAuditLogs(filters);
      toast.success('Audit logs exported successfully');
    } catch (error) {
      toast.error('Failed to export audit logs');
      console.error('Export error:', error);
    }
  };

  const hasActiveFilters = searchQuery || selectedCategory !== 'all' || selectedAction !== 'all';

  // ============================================
  // Render
  // ============================================

  return (
    <>
      <Helmet>
        <title>Audit Logs | HMS Admin</title>
        <meta name="description" content="View system audit logs" />
      </Helmet>

      <div className="min-h-screen bg-background">
        {/* Page Header */}
        <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 sm:mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-6 w-6 text-primary" />
                <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight">
                  Audit Logs
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Track system activity and user actions
              </p>
            </div>

            <Button
              onClick={handleExport}
              variant="outline"
              size="sm"
              className="font-mono text-xs w-full sm:w-auto"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>

          {/* Stats Row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 sm:mb-6">
              <StatCard
                icon={Activity}
                label="Total Logs"
                value={stats.total_logs?.toLocaleString() || '0'}
                color="text-primary"
              />
              <StatCard
                icon={Calendar}
                label="Today"
                value={stats.logs_today?.toLocaleString() || '0'}
                color="text-emerald-600"
              />
              <StatCard
                icon={TrendingUp}
                label="This Week"
                value={stats.logs_this_week?.toLocaleString() || '0'}
                color="text-amber-600"
              />
              <StatCard
                icon={Users}
                label="Active Users"
                value={stats.most_active_users?.length || '0'}
                color="text-violet-600"
              />
            </div>
          )}

          {/* Search and Filters */}
          <div className="flex flex-col gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs by description, user, or resource..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 font-mono text-sm bg-background"
              />
            </div>

            {/* Filters Row */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Category Filter */}
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-full sm:w-[150px] font-mono text-xs h-9">
                  <Filter className="h-3.5 w-3.5 mr-2" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {filterOptions?.categories?.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Action Filter */}
              <Select value={selectedAction} onValueChange={setSelectedAction}>
                <SelectTrigger className="w-full sm:w-[150px] font-mono text-xs h-9">
                  <Activity className="h-3.5 w-3.5 mr-2" />
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {filterOptions?.actions?.map((action) => (
                    <SelectItem key={action.value} value={action.value}>
                      {action.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Refresh */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetch()}
                className="shrink-0 h-9 w-9"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="font-mono text-xs h-9"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Logs List */}
        <main className="p-4 sm:p-6">
          {isLoading ? (
            <LoadingSkeleton />
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} />
          ) : allLogs.length === 0 ? (
            <EmptyState hasFilters={hasActiveFilters} onClear={handleClearFilters} />
          ) : (
            <div className="space-y-4">
              {allLogs.map((log, index) => (
                <AuditLogCard
                  key={log.id}
                  log={log}
                  index={index}
                />
              ))}

              {/* Pagination */}
              {(hasNextPage || hasPrevPage) && (
                <div className="flex items-center justify-between py-4 border-t border-border mt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {allLogs.length} of {totalCount} logs
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => p - 1)}
                      disabled={!hasPrevPage}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => p + 1)}
                      disabled={!hasNextPage}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
};

/**
 * StatCard - Quick stats display
 */
const StatCard = ({ icon: Icon, label, value, color }) => (
  <div className="bg-card/50 border border-border rounded-lg p-3">
    <div className="flex items-center gap-2 mb-1">
      <Icon className={cn("h-4 w-4", color)} />
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
    <p className="font-display text-xl sm:text-2xl text-foreground">
      {value}
    </p>
  </div>
);

/**
 * LoadingSkeleton
 */
const LoadingSkeleton = () => (
  <div className="space-y-4">
    {Array.from({ length: 5 }).map((_, i) => (
      <div
        key={i}
        className="bg-card/50 border border-border rounded-2xl p-5 space-y-3"
      >
        <div className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-3 w-1/2" />
      </div>
    ))}
  </div>
);

/**
 * EmptyState
 */
const EmptyState = ({ hasFilters, onClear }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
      <Shield className="h-8 w-8 text-muted-foreground" />
    </div>
    <h3 className="font-display text-xl text-foreground mb-2">
      {hasFilters ? 'No matching logs' : 'No audit logs yet'}
    </h3>
    <p className="text-muted-foreground text-sm mb-4 max-w-md">
      {hasFilters
        ? 'Try adjusting your search or filter criteria.'
        : 'Audit logs will appear here as users perform actions in the system.'}
    </p>
    {hasFilters && (
      <Button variant="outline" size="sm" onClick={onClear}>
        <X className="h-4 w-4 mr-2" />
        Clear Filters
      </Button>
    )}
  </div>
);

/**
 * ErrorState
 */
const ErrorState = ({ onRetry }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
      <Shield className="h-8 w-8 text-destructive" />
    </div>
    <h3 className="font-display text-xl text-foreground mb-2">
      Failed to load audit logs
    </h3>
    <p className="text-muted-foreground text-sm mb-4">
      There was an error loading the audit logs. Please try again.
    </p>
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RefreshCw className="h-4 w-4 mr-2" />
      Retry
    </Button>
  </div>
);

export default AuditLogsPage;
