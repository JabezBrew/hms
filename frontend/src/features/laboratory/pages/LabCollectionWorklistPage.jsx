import Search from 'lucide-react/dist/esm/icons/search.js';
import Droplet from 'lucide-react/dist/esm/icons/droplet.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import { useEffect, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from '@/components/ui/table-pagination';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import formatDistanceToNow from "date-fns/formatDistanceToNow";
import { usePaginatedLabOrders } from "@/features/laboratory/hooks";
import { LabOrderDetailSlideOver, SpecimenCollectionDialog } from "@/components/laboratory";
import { useDebounce } from '@/hooks/use-debounce';

const COLLECTION_PAGE_SIZE = 20;

/**
 * LabCollectionWorklistPage - Worklist for specimen collection
 *
 * Features:
 * - Shows orders awaiting specimen collection (status: "ordered")
 * - Priority-based sorting (STAT first, then urgent, then routine)
 * - Quick collection action from worklist
 * - Patient and order information at a glance
 * - Search by patient name or order number
 */
export default function LabCollectionWorklistPage() {
  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Slide-over state
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [slideOverOpen, setSlideOverOpen] = useState(false);

  // Collection dialog state
  const [collectDialogOpen, setCollectDialogOpen] = useState(false);
  const [orderToCollect, setOrderToCollect] = useState(null);

  // Fetch orders with "ordered" status
  const queryFilters = useMemo(() => {
    const filters = {
      status: "ordered",
      page,
      page_size: COLLECTION_PAGE_SIZE,
    };
    if (debouncedSearchQuery.trim()) {
      filters.search = debouncedSearchQuery.trim();
    }
    if (priorityFilter !== "all") {
      filters.priority = priorityFilter;
    }
    return filters;
  }, [priorityFilter, debouncedSearchQuery, page]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearchQuery, priorityFilter]);

  const { data: ordersData, isLoading, isFetching, refetch } = usePaginatedLabOrders(queryFilters);

  // Process and sort orders by priority
  const orders = useMemo(() => {
    const data = ordersData?.results || [];
    const ordersList = Array.isArray(data) ? data : [];

    // Priority order: stat > urgent > routine
    const priorityOrder = { stat: 0, urgent: 1, routine: 2 };

    return [...ordersList].sort((a, b) => {
      const priorityDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
      if (priorityDiff !== 0) return priorityDiff;
      // Within same priority, older orders first
      return new Date(a.ordered_at || a.created_at) - new Date(b.ordered_at || b.created_at);
    });
  }, [ordersData]);
  const totalCount = ordersData?.count || 0;

  // Stats
  const stats = useMemo(() => {
    return {
      total: totalCount,
      visible: orders.length,
      stat: orders.filter((o) => o.priority === "stat").length,
      urgent: orders.filter((o) => o.priority === "urgent").length,
      routine: orders.filter((o) => o.priority === "routine").length,
    };
  }, [orders, totalCount]);

  // Priority config
  const getPriorityConfig = (priority) => {
    const configs = {
      stat: { label: "STAT", className: "bg-rose-100 text-rose-700 border-rose-300 font-semibold" },
      urgent: { label: "Urgent", className: "bg-amber-100 text-amber-700 border-amber-300" },
      routine: { label: "Routine", className: "bg-stone-100 text-stone-600 border-stone-300" },
    };
    return configs[priority] || configs.routine;
  };

  // Format time ago
  const formatTimeAgo = (dateString) => {
    if (!dateString) return "-";
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
      return "-";
    }
  };

  const collectionColumns = useMemo(() => ([
    {
      key: "order",
      header: "Order",
      width: "180px",
      render: (order) => (
        <span className="font-mono text-sm font-medium text-primary">
          {order.order_number}
        </span>
      ),
    },
    {
      key: "patient",
      header: "Patient",
      width: "220px",
      render: (order) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{order.patient_name}</p>
          <p className="font-mono text-xs text-muted-foreground">MRN: {order.patient_mrn || "-"}</p>
        </div>
      ),
    },
    {
      key: "tests",
      header: "Tests",
      width: "120px",
      render: (order) => (
        <span className="font-mono text-sm text-muted-foreground">
          {order.test_count || 0}
        </span>
      ),
    },
    {
      key: "ordered",
      header: "Ordered",
      width: "180px",
      render: (order) => (
        <span className="text-sm text-muted-foreground">
          {formatTimeAgo(order.ordered_at || order.created_at)}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      width: "140px",
      render: (order) => {
        const priorityConfig = getPriorityConfig(order.priority);
        return (
          <Badge variant="outline" className={cn("text-xs", priorityConfig.className)}>
            {priorityConfig.label}
          </Badge>
        );
      },
    },
    {
      key: "notes",
      header: "Notes",
      width: "180px",
      render: (order) => (
        <span className="text-sm text-muted-foreground">
          {order.fasting_required ? "Fasting required" : "Ready for collection"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "120px",
      render: (order) => (
        <div className="flex justify-end">
          <Button
            onClick={(event) => handleQuickCollect(event, order)}
            className="h-8 bg-amber-600 px-2 text-xs hover:bg-amber-700"
            size="sm"
          >
            <Droplet className="mr-1.5 h-3.5 w-3.5" />
            Collect
          </Button>
        </div>
      ),
    },
  ]), []);

  // Handlers
  const handleOrderClick = (order) => {
    setSelectedOrderId(order.id);
    setSlideOverOpen(true);
  };

  const handleSlideOverClose = () => {
    setSlideOverOpen(false);
    setSelectedOrderId(null);
  };

  const handleQuickCollect = (e, order) => {
    e.stopPropagation();
    setOrderToCollect(order);
    setCollectDialogOpen(true);
  };

  const handleCollectSuccess = () => {
    setCollectDialogOpen(false);
    setOrderToCollect(null);
    refetch();
  };

  const handleSpecimenCollectedFromSlideOver = () => {
    refetch();
  };

  return (
    <PageShell>
      <PageHeader
        title="Collection Worklist"
        description={(
          <span>
            {stats.total} orders awaiting specimen collection
            {stats.total !== stats.visible && (
              <span className="text-muted-foreground ml-2">
                (showing {stats.visible} on this page)
              </span>
            )}
            {stats.stat > 0 && (
              <span className="text-rose-600 font-semibold ml-2">
                ({stats.stat} STAT on this page)
              </span>
            )}
          </span>
        )}
        actions={(
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="flex items-center gap-2"
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Refresh
          </Button>
        )}
      >
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 sm:mt-6">
          <div className="bg-background rounded-lg border p-3">
            <div className="flex items-center gap-2 mb-1">
              <Droplet className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Total</span>
            </div>
            <p className="font-display text-2xl">{stats.total}</p>
          </div>
          <div className="bg-background rounded-lg border p-3">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="h-4 w-4 text-sky-600" />
              <span className="text-xs text-muted-foreground">Visible</span>
            </div>
            <p className="font-display text-2xl">{stats.visible}</p>
          </div>
          <div className="bg-rose-50 dark:bg-rose-900/20 rounded-lg border border-rose-200 dark:border-rose-800 p-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
              <span className="text-xs text-rose-600 font-medium">STAT</span>
            </div>
            <p className="font-display text-2xl text-rose-700">{stats.stat}</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-amber-600" />
              <span className="text-xs text-amber-600 font-medium">Urgent</span>
            </div>
            <p className="font-display text-2xl text-amber-700">{stats.urgent}</p>
          </div>
        </div>
      </PageHeader>

      {/* Filter Bar */}
      <div className="bg-card/50 border-b border-border px-4 sm:px-6 py-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by patient name, MRN, or order number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 font-mono text-sm"
            />
          </div>

          {/* Priority filter */}
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[160px] text-sm">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="stat">STAT Only</SelectItem>
              <SelectItem value="urgent">Urgent Only</SelectItem>
              <SelectItem value="routine">Routine Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <main className="p-4 sm:p-6">
        {isLoading ? (
          // Loading skeletons
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="bg-card rounded-lg border border-border p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-4 w-48 mb-2" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <Droplet className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-display text-lg text-foreground mb-2">
              No collections pending
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {searchQuery || priorityFilter !== "all"
                ? "Try adjusting your filters to see more orders."
                : "All specimens have been collected. Great work!"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <VirtualizedTable
              rows={orders}
              rowKey={(order) => order.id}
              rowHeight={68}
              columns={collectionColumns}
              onRowClick={(order) => handleOrderClick(order)}
              rowClassName="hover:bg-muted/30"
              className="min-w-[1120px]"
              headerClassName="bg-muted/50 border-b border-border"
            />
          </div>
        )}
      </main>

      {totalCount > COLLECTION_PAGE_SIZE && (
        <div className="px-4 sm:px-6 pb-6">
          <TablePagination
            currentPage={page}
            totalCount={totalCount}
            pageSize={COLLECTION_PAGE_SIZE}
            onPageChange={setPage}
            itemLabel="orders"
          />
        </div>
      )}

      {/* Order Detail Slide-over */}
      <LabOrderDetailSlideOver
        open={slideOverOpen}
        onClose={handleSlideOverClose}
        orderId={selectedOrderId}
        onOrderCancelled={() => refetch()}
        onSpecimenCollected={handleSpecimenCollectedFromSlideOver}
      />

      {/* Quick Collection Dialog */}
      <SpecimenCollectionDialog
        open={collectDialogOpen}
        onOpenChange={setCollectDialogOpen}
        order={orderToCollect}
        onSuccess={handleCollectSuccess}
      />
    </PageShell>
  );
}
