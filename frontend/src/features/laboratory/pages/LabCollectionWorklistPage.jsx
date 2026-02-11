import Search from 'lucide-react/dist/esm/icons/search.js';
import Droplet from 'lucide-react/dist/esm/icons/droplet.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

import format from "date-fns/format";
import formatDistanceToNow from "date-fns/formatDistanceToNow";
import { useAuth } from "@/lib/auth";
import { useLabOrders } from "@/features/laboratory/hooks";
import { LabOrderDetailSlideOver, SpecimenCollectionDialog } from "@/components/laboratory";

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
  const { user } = useAuth();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");

  // Slide-over state
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [slideOverOpen, setSlideOverOpen] = useState(false);

  // Collection dialog state
  const [collectDialogOpen, setCollectDialogOpen] = useState(false);
  const [orderToCollect, setOrderToCollect] = useState(null);

  // Fetch orders with "ordered" status
  const queryFilters = useMemo(() => {
    const filters = { status: "ordered" };
    if (priorityFilter !== "all") {
      filters.priority = priorityFilter;
    }
    return filters;
  }, [priorityFilter]);

  const { data: ordersData, isLoading, refetch } = useLabOrders(queryFilters);

  // Process and sort orders by priority
  const orders = useMemo(() => {
    const data = ordersData?.results || ordersData || [];
    const ordersList = Array.isArray(data) ? data : [];

    // Priority order: stat > urgent > routine
    const priorityOrder = { stat: 0, urgent: 1, routine: 2 };

    return ordersList.sort((a, b) => {
      const priorityDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
      if (priorityDiff !== 0) return priorityDiff;
      // Within same priority, older orders first
      return new Date(a.ordered_at || a.created_at) - new Date(b.ordered_at || b.created_at);
    });
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

  // Stats
  const stats = useMemo(() => {
    return {
      total: orders.length,
      stat: orders.filter((o) => o.priority === "stat").length,
      urgent: orders.filter((o) => o.priority === "urgent").length,
      routine: orders.filter((o) => o.priority === "routine").length,
    };
  }, [orders]);

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
            {stats.stat > 0 && (
              <span className="text-rose-600 font-semibold ml-2">
                ({stats.stat} STAT)
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
          >
            <RefreshCw className="h-4 w-4" />
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
          <div className="bg-background rounded-lg border p-3">
            <div className="flex items-center gap-2 mb-1">
              <TestTube2 className="h-4 w-4 text-stone-500" />
              <span className="text-xs text-muted-foreground">Routine</span>
            </div>
            <p className="font-display text-2xl">{stats.routine}</p>
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
        ) : filteredOrders.length === 0 ? (
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
          <VirtualizedList
            items={filteredOrders}
            estimateSize={150}
            gap={12}
            getItemKey={(order) => order.id}
            renderItem={(order, index) => {
              const priorityConfig = getPriorityConfig(order.priority);

              return (
                <div
                  onClick={() => handleOrderClick(order)}
                  className={cn(
                    "bg-card rounded-lg border border-border p-4 cursor-pointer",
                    "hover:border-amber-300 hover:shadow-md transition-all",
                    "animate-chronicle-enter",
                    order.priority === "stat" && "border-l-4 border-l-rose-500"
                  )}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className={cn("text-xs", priorityConfig.className)}
                        >
                          {priorityConfig.label}
                        </Badge>
                        <span className="font-mono text-xs text-muted-foreground">
                          {order.order_number}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-display text-lg truncate">
                          {order.patient_name}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono">MRN: {order.patient_mrn}</span>
                        <span>{order.test_count} test(s)</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Ordered {formatTimeAgo(order.ordered_at || order.created_at)}
                        </span>
                      </div>

                      {order.fasting_required && (
                        <div className="flex items-center gap-1.5 mt-2 text-amber-600 text-xs">
                          <AlertTriangle className="h-3 w-3" />
                          <span className="font-medium">Fasting required</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 sm:flex-shrink-0">
                      <Button
                        onClick={(e) => handleQuickCollect(e, order)}
                        className="bg-amber-600 hover:bg-amber-700 text-white"
                        size="sm"
                      >
                        <Droplet className="h-4 w-4 mr-1.5" />
                        Collect
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }}
          />
        )}
      </main>

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
