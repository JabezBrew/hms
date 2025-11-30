import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/dashboard";
import { LabOrderCard, LabOrderDetailSlideOver } from "@/components/laboratory";
import {
  Search,
  TestTube2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  LayoutGrid,
  List,
  RefreshCw,
  X,
  Filter,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useLabOrders } from "@/hooks/useLabQueries";

/**
 * LabOrdersPage - Lab orders list for clinicians
 *
 * Features:
 * - Chronicle-style order cards
 * - "My Orders" toggle for doctors (default on)
 * - Search and filter by status, priority
 * - Stats header showing order counts
 * - Grid/list view toggle
 */
export default function LabOrdersPage() {
  const { user } = useAuth();
  const userRole = user?.role || "";
  const userId = user?.id;

  // Determine if user is a doctor (should see "My Orders" toggle)
  const isDoctor = ["doctor", "physician", "practitioner", "inpatient_doctor"].includes(userRole);
  const isLabTech = ["lab_technician"].includes(userRole);

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [myOrdersOnly, setMyOrdersOnly] = useState(isDoctor); // Default ON for doctors
  const [viewMode, setViewMode] = useState("grid");

  // Slide-over state
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [slideOverOpen, setSlideOverOpen] = useState(false);

  // Build query filters
  const queryFilters = useMemo(() => {
    const filters = {};

    if (statusFilter !== "all") {
      filters.status = statusFilter;
    }

    if (priorityFilter !== "all") {
      filters.priority = priorityFilter;
    }

    // For "My Orders" - filter by ordering provider
    // Note: Backend may need to support this filter
    if (myOrdersOnly && userId) {
      filters.ordering_provider = userId;
    }

    return filters;
  }, [statusFilter, priorityFilter, myOrdersOnly, userId]);

  // Fetch orders
  const {
    data: ordersData,
    isLoading,
    refetch,
  } = useLabOrders(queryFilters);

  // Process orders data
  const orders = useMemo(() => {
    const data = ordersData?.results || ordersData || [];
    return Array.isArray(data) ? data : [];
  }, [ordersData]);

  // Client-side search filtering
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;

    const query = searchQuery.toLowerCase();
    return orders.filter((order) => {
      return (
        order.order_number?.toLowerCase().includes(query) ||
        order.patient_name?.toLowerCase().includes(query) ||
        order.patient_mrn?.toLowerCase().includes(query)
      );
    });
  }, [orders, searchQuery]);

  // Calculate stats
  const stats = useMemo(() => {
    const all = orders;
    const pending = orders.filter((o) =>
      ["ordered", "collected", "received"].includes(o.status)
    );
    const processing = orders.filter((o) => o.status === "processing");
    const completed = orders.filter((o) => o.status === "completed");
    const critical = orders.filter((o) => o.has_critical_results);

    return {
      total: all.length,
      pending: pending.length,
      processing: processing.length,
      completed: completed.length,
      critical: critical.length,
    };
  }, [orders]);

  // Event handlers
  const handleClearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setPriorityFilter("all");
    if (!isDoctor) {
      setMyOrdersOnly(false);
    }
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
    searchQuery ||
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    (myOrdersOnly && !isDoctor);

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
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 sm:mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight mb-1">
              Lab Orders
            </h1>
            <p className="text-sm text-muted-foreground">
              {stats.total} orders
              {stats.critical > 0 && (
                <span className="text-rose-600 ml-2">
                  ({stats.critical} critical)
                </span>
              )}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            title="Total Orders"
            value={stats.total}
            icon={TestTube2}
            color="sky"
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={Clock}
            color="amber"
          />
          <StatCard
            title="Processing"
            value={stats.processing}
            icon={AlertTriangle}
            color="rose"
          />
          <StatCard
            title="Completed"
            value={stats.completed}
            icon={CheckCircle2}
            color="emerald"
          />
        </div>
      </header>

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
            {/* My Orders toggle (for doctors) */}
            {isDoctor && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-md border">
                <Switch
                  id="my-orders"
                  checked={myOrdersOnly}
                  onCheckedChange={setMyOrdersOnly}
                  className="scale-90"
                />
                <Label htmlFor="my-orders" className="text-sm cursor-pointer">
                  My Orders
                </Label>
              </div>
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
        ) : filteredOrders.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <TestTube2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-display text-lg text-foreground mb-2">
              No orders found
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {searchQuery || statusFilter !== "all" || priorityFilter !== "all"
                ? "Try adjusting your filters to see more orders."
                : myOrdersOnly
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
        ) : (
          // Orders grid/list
          <div
            className={cn(
              viewMode === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                : "flex flex-col gap-3"
            )}
          >
            {filteredOrders.map((order, index) => (
              <LabOrderCard
                key={order.id}
                order={order}
                index={index}
                onClick={handleOrderClick}
              />
            ))}
          </div>
        )}
      </main>

      {/* Order Detail Slide-over */}
      <LabOrderDetailSlideOver
        open={slideOverOpen}
        onClose={handleSlideOverClose}
        orderId={selectedOrderId}
        onOrderCancelled={handleOrderCancelled}
      />
    </div>
  );
}
