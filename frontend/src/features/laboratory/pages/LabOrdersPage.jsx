import Search from 'lucide-react/dist/esm/icons/search.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import List from 'lucide-react/dist/esm/icons/list.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import UserRound from 'lucide-react/dist/esm/icons/user-round.js';
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from '@/components/ui/table-pagination';
import VirtualizedGrid from '@/components/ui/VirtualizedGrid';
import VirtualizedList from '@/components/ui/VirtualizedList';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/dashboard";
import { LabOrderCard, LabOrderDetailSlideOver } from "@/components/laboratory";

import { useAuth } from "@/lib/auth";
import { usePaginatedLabOrders } from "@/features/laboratory/hooks";
import { usePractitioners } from "@/features/staff/hooks";
import { useDebounce } from '@/hooks/use-debounce';

const ORDERS_PAGE_SIZE = 24;

/**
 * LabOrdersPage - Lab orders list for clinicians
 *
 * Features:
 * - Chronicle-style order cards
 * - Doctors automatically see only their orders
 * - Lab staff/admins can filter by ordering doctor
 * - Search and filter by status, priority
 * - Stats header showing order counts
 * - Grid/list view toggle
 */
export default function LabOrdersPage() {
  const { user } = useAuth();
  const userRole = user?.role || "";

  // Determine user type
  const isDoctor = ["doctor", "physician", "practitioner", "inpatient_doctor"].includes(userRole);
  const isLabStaff = ["lab_technician", "lab_tech", "laboratory", "admin"].includes(userRole);

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [selectedDoctorFilter, setSelectedDoctorFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [page, setPage] = useState(1);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Slide-over state
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [slideOverOpen, setSlideOverOpen] = useState(false);

  // Fetch practitioners for the doctor filter dropdown (only for lab staff)
  const { data: practitionersData } = usePractitioners({ user_type: "doctor" });
  const practitioners = useMemo(() => {
    const data = practitionersData?.results || practitionersData || [];
    return Array.isArray(data) ? data : [];
  }, [practitionersData]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearchQuery, statusFilter, priorityFilter, selectedDoctorFilter]);

  // Build query filters
  const queryFilters = useMemo(() => {
    const filters = {
      page,
      page_size: ORDERS_PAGE_SIZE,
    };

    if (debouncedSearchQuery.trim()) {
      filters.search = debouncedSearchQuery.trim();
    }

    if (statusFilter !== "all") {
      filters.status = statusFilter;
    }

    if (priorityFilter !== "all") {
      filters.priority = priorityFilter;
    }

    // Doctors automatically see only their orders
    if (isDoctor) {
      filters.my_orders = "true";
    }

    // Lab staff can filter by specific doctor
    if (isLabStaff && selectedDoctorFilter !== "all") {
      filters.ordering_provider = selectedDoctorFilter;
    }

    return filters;
  }, [
    debouncedSearchQuery,
    statusFilter,
    priorityFilter,
    isDoctor,
    isLabStaff,
    selectedDoctorFilter,
    page,
  ]);

  // Fetch orders
  const {
    data: ordersData,
    isLoading,
    isFetching,
    refetch,
  } = usePaginatedLabOrders(queryFilters);

  // Process orders data
  const orders = useMemo(() => {
    const data = ordersData?.results || [];
    return Array.isArray(data) ? data : [];
  }, [ordersData]);
  const totalCount = ordersData?.count || 0;

  // Calculate page-local stats
  const stats = useMemo(() => {
    const pending = orders.filter((o) =>
      ["ordered", "collected", "received"].includes(o.status)
    );
    const processing = orders.filter((o) => o.status === "processing");
    const completed = orders.filter((o) => o.status === "completed");
    const critical = orders.filter((o) => o.has_critical_results);

    return {
      total: totalCount,
      visible: orders.length,
      pending: pending.length,
      processing: processing.length,
      completed: completed.length,
      critical: critical.length,
    };
  }, [orders, totalCount]);

  // Event handlers
  const handleClearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setSelectedDoctorFilter("all");
    setPage(1);
  };

  const handleOrderClick = (order) => {
    setSelectedOrderId(order.id);
    setSlideOverOpen(true);
  };

  const handleSlideOverClose = () => {
    setSlideOverOpen(false);
    setSelectedOrderId(null);
  };

  const handleOrderCancelled = () => {
    refetch();
  };

  const hasActiveFilters =
    searchQuery.trim() ||
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    selectedDoctorFilter !== "all";

  // Status options
  const statusOptions = [
    { value: "all", label: "All Statuses" },
    { value: "draft", label: "Draft" },
    { value: "ordered", label: "Ordered" },
    { value: "collected", label: "Collected" },
    { value: "received", label: "Received" },
    { value: "processing", label: "Processing" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ];

  // Priority options
  const priorityOptions = [
    { value: "all", label: "All Priorities" },
    { value: "routine", label: "Routine" },
    { value: "urgent", label: "Urgent" },
    { value: "stat", label: "STAT" },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Lab Orders"
        description={(
          <span>
            {stats.total} {isDoctor ? "matching orders placed by you" : "matching orders"}
            {stats.total !== stats.visible && (
              <span className="ml-2 text-muted-foreground">
                (showing {stats.visible} on this page)
              </span>
            )}
            {stats.critical > 0 && (
              <span className="text-rose-600 ml-2">
                ({stats.critical} critical on this page)
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-4 sm:mt-6">
          <StatCard
            title="Total Orders"
            value={stats.total}
            icon={TestTube2}
            color="sky"
          />
          <StatCard
            title="Visible"
            value={stats.visible}
            icon={List}
            color="sky"
          />
          <StatCard
            title="Pending Page"
            value={stats.pending}
            icon={Clock}
            color="amber"
          />
          <StatCard
            title="Completed Page"
            value={stats.completed}
            icon={CheckCircle2}
            color="emerald"
          />
        </div>
      </PageHeader>

      {/* Filter Bar */}
      <div className="bg-card/50 border-b border-border px-4 sm:px-6 py-3">
        <div className="flex flex-col gap-3">
          {/* Search row */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by order number, patient name, or MRN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 font-mono text-sm"
            />
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Ordering Doctor filter (for lab staff/admins only) */}
            {isLabStaff && (
              <Select value={selectedDoctorFilter} onValueChange={setSelectedDoctorFilter}>
                <SelectTrigger className="w-[180px] sm:w-[200px] text-sm">
                  <div className="flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-muted-foreground" />
                    <SelectValue placeholder="Ordering Doctor" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Doctors</SelectItem>
                  {practitioners.map((doc) => (
                    <SelectItem key={doc.id} value={doc.id}>
                      {doc.name || `Dr. ${doc.staff?.user?.last_name || "Unknown"}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px] sm:w-[160px] text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Priority filter */}
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[140px] sm:w-[160px] text-sm">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                {priorityOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* View toggle */}
            <div className="flex items-center gap-1 ml-auto">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="text-muted-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="p-4 sm:p-6">
        {isLoading ? (
          // Loading skeletons
          <div
            className={cn(
              viewMode === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                : "flex flex-col gap-3"
            )}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-card/30 rounded-lg border border-border/50 p-4"
              >
                <div className="flex justify-between mb-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-6 w-40 mb-2" />
                <Skeleton className="h-3 w-20 mb-3" />
                <Skeleton className="h-4 w-full mb-2" />
                <div className="flex justify-between pt-2 border-t border-border/30">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <TestTube2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-display text-lg text-foreground mb-2">
              No orders found
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {hasActiveFilters
                ? "Try adjusting your filters to see more orders."
                : isDoctor
                ? "You haven't placed any lab orders yet."
                : "No lab orders have been placed yet."}
            </p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="mt-4"
              >
                Clear Filters
              </Button>
            )}
          </div>
        ) : viewMode === "grid" ? (
          <VirtualizedGrid
            items={orders}
            minItemWidth={320}
            rowHeight={260}
            gap={16}
            getItemKey={(order) => order.id}
            renderItem={(order, index) => (
              <LabOrderCard
                order={order}
                index={index}
                onClick={handleOrderClick}
              />
            )}
          />
        ) : (
          <VirtualizedList
            items={orders}
            estimateSize={140}
            gap={12}
            getItemKey={(order) => order.id}
            renderItem={(order, index) => (
              <LabOrderCard
                order={order}
                index={index}
                onClick={handleOrderClick}
              />
            )}
          />
        )}
      </main>

      {totalCount > ORDERS_PAGE_SIZE && (
        <div className="px-4 sm:px-6 pb-6">
          <TablePagination
            currentPage={page}
            totalCount={totalCount}
            pageSize={ORDERS_PAGE_SIZE}
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
        onOrderCancelled={handleOrderCancelled}
      />
    </PageShell>
  );
}
