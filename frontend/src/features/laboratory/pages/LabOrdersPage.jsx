import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import UserRound from 'lucide-react/dist/esm/icons/user-round.js';
import { useEffect, useMemo, useState } from "react";
import format from 'date-fns/format';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TablePagination } from '@/components/ui/table-pagination';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import {
  LabEmptyState,
  LabMetricGrid,
  LabSearchField,
  LabTableSkeleton,
  LabToolbar,
  labTableClassName,
  labTableHeaderClassName,
} from '@/features/laboratory/components';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LabOrderDetailSlideOver } from "@/components/laboratory";

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

  const metrics = useMemo(() => ([
    { title: "Total Orders", label: "Total Orders", value: stats.total, icon: TestTube2, color: "sky" },
    { title: "Visible", label: "Visible", value: stats.visible, icon: UserRound, color: "sky" },
    { title: "Pending Page", label: "Pending Page", value: stats.pending, icon: Clock, color: "amber" },
    { title: "Completed Page", label: "Completed Page", value: stats.completed, icon: CheckCircle2, color: "emerald" },
  ]), [stats]);

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

  const getStatusConfig = (status) => {
    const configs = {
      draft: { label: "Draft", className: "border-stone-300 bg-stone-100 text-stone-700" },
      ordered: { label: "Ordered", className: "border-sky-300 bg-sky-100 text-sky-700" },
      collected: { label: "Collected", className: "border-amber-300 bg-amber-100 text-amber-700" },
      received: { label: "Received", className: "border-violet-300 bg-violet-100 text-violet-700" },
      processing: { label: "Processing", className: "border-indigo-300 bg-indigo-100 text-indigo-700" },
      completed: { label: "Completed", className: "border-emerald-300 bg-emerald-100 text-emerald-700" },
      cancelled: { label: "Cancelled", className: "border-rose-300 bg-rose-100 text-rose-700" },
    };
    return configs[status] || configs.draft;
  };

  const getPriorityConfig = (priority) => {
    const configs = {
      routine: { label: "Routine", className: "border-stone-300 bg-stone-100 text-stone-600" },
      urgent: { label: "Urgent", className: "border-amber-300 bg-amber-100 text-amber-700" },
      stat: { label: "STAT", className: "border-rose-300 bg-rose-100 text-rose-700 font-semibold" },
    };
    return configs[priority] || configs.routine;
  };

  const formatDate = (dateString) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy h:mm a");
    } catch {
      return "-";
    }
  };

  const orderColumns = useMemo(() => ([
    {
      key: "order",
      header: "Order",
      width: "200px",
      render: (order) => (
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium text-primary">{order.order_number}</p>
          <p className="truncate text-xs text-muted-foreground">
            {formatDate(order.ordered_at || order.created_at)}
          </p>
        </div>
      ),
    },
    {
      key: "patient",
      header: "Patient",
      width: "220px",
      render: (order) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{order.patient_name || "Unknown Patient"}</p>
          <p className="font-mono text-xs text-muted-foreground">MRN: {order.patient_mrn || "-"}</p>
        </div>
      ),
    },
    {
      key: "provider",
      header: "Ordering Provider",
      width: "200px",
      render: (order) => (
        <span className="truncate text-sm text-muted-foreground">
          {order.ordering_provider_name || "Unknown"}
        </span>
      ),
    },
    {
      key: "tests",
      header: "Tests",
      width: "120px",
      headerClassName: "text-center",
      cellClassName: "text-center",
      render: (order) => `${order.test_count || 0}`,
    },
    {
      key: "priority",
      header: "Priority",
      width: "120px",
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
      key: "status",
      header: "Status",
      width: "140px",
      render: (order) => {
        const statusConfig = getStatusConfig(order.status);
        return (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-xs", statusConfig.className)}>
              {order.status_display || statusConfig.label}
            </Badge>
            {order.has_critical_results && (
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700 text-xs">
                Critical
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "notes",
      header: "Notes",
      width: "180px",
      render: (order) => (
        <span className="truncate text-sm text-muted-foreground">
          {order.fasting_required ? "Fasting required" : "No special prep"}
        </span>
      ),
    },
  ]), []);

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
        <LabMetricGrid metrics={metrics} className="mt-4 sm:mt-6" />
      </PageHeader>

      <LabToolbar>
        <div className="flex flex-col gap-3">
          <LabSearchField
            id="lab-orders-search"
            placeholder="Search by order number, patient name, or MRN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {isLabStaff && (
              <Select value={selectedDoctorFilter} onValueChange={setSelectedDoctorFilter}>
                <SelectTrigger className="w-full font-mono text-sm sm:w-[200px]">
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

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full font-mono text-sm sm:w-[160px]">
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

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full font-mono text-sm sm:w-[160px]">
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

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="font-mono text-xs text-muted-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </LabToolbar>

      {/* Content */}
      <main className="p-4 sm:p-6">
        {isLoading ? (
          <LabTableSkeleton rows={6} />
        ) : orders.length === 0 ? (
          <LabEmptyState
            icon={TestTube2}
            title="No orders found"
            description={
              hasActiveFilters
                ? "Try adjusting your filters to see more orders."
                : isDoctor
                  ? "You haven't placed any lab orders yet."
                  : "No lab orders have been placed yet."
            }
            action={hasActiveFilters ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="font-mono text-xs"
              >
                Clear Filters
              </Button>
            ) : null}
          />
        ) : (
          <div className="overflow-x-auto">
            <VirtualizedTable
              rows={orders}
              rowKey={(order) => order.id}
              rowHeight={68}
              columns={orderColumns}
              onRowClick={(order) => handleOrderClick(order)}
              rowClassName="hover:bg-muted/30"
              className={cn(labTableClassName, "min-w-[1180px]")}
              headerClassName={labTableHeaderClassName}
            />
          </div>
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
