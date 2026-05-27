import X from 'lucide-react/dist/esm/icons/x.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Droplet from 'lucide-react/dist/esm/icons/droplet.js';
import ClipboardEdit from 'lucide-react/dist/esm/icons/clipboard-pen.js';
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import format from "date-fns/format";
import { useLabOrder } from "@/features/laboratory/hooks";
import { CancelOrderDialog } from "./CancelOrderDialog";
import { SpecimenCollectionDialog } from "./SpecimenCollectionDialog";
import { LabResultEntrySlideOver } from "./LabResultEntrySlideOver";

const STATUS_CONFIG = {
  draft: { label: "Draft", className: "bg-stone-100 text-stone-700 border-stone-300", icon: FileText },
  ordered: { label: "Ordered", className: "bg-sky-100 text-sky-700 border-sky-300", icon: Clock },
  collected: { label: "Collected", className: "bg-amber-100 text-amber-700 border-amber-300", icon: CheckCircle2 },
  received: { label: "Received", className: "bg-violet-100 text-violet-700 border-violet-300", icon: CheckCircle2 },
  processing: { label: "Processing", className: "bg-indigo-100 text-indigo-700 border-indigo-300", icon: Loader2 },
  completed: { label: "Completed", className: "bg-emerald-100 text-emerald-700 border-emerald-300", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", className: "bg-rose-100 text-rose-700 border-rose-300", icon: XCircle },
};

const PRIORITY_CONFIG = {
  routine: { label: "Routine", className: "bg-stone-100 text-stone-600" },
  urgent: { label: "Urgent", className: "bg-amber-100 text-amber-700" },
  stat: { label: "STAT", className: "bg-rose-100 text-rose-700 font-semibold" },
};

function getStatusConfig(status) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.draft;
}

function getPriorityConfig(priority) {
  return PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.routine;
}

function formatDate(dateString) {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "MMM d, yyyy h:mm a");
  } catch {
    return "-";
  }
}

function formatDob(dateString) {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "MMM d, yyyy");
  } catch {
    return "-";
  }
}

function LabOrderSlideOverHeader({ order, onClose }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
          <TestTube2 className="size-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div>
          <h2 className="font-display text-xl text-foreground">
            Lab Order Details
          </h2>
          {order && (
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {order.order_number}
            </p>
          )}
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onClose}
        className="font-mono text-xs"
      >
        <X className="size-4 mr-1.5" />
        Close
      </Button>
    </header>
  );
}

function LabOrderLoadingState() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}

function LabOrderNotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <TestTube2 className="size-12 text-muted-foreground/50 mb-4" />
      <p className="text-muted-foreground">Order not found</p>
    </div>
  );
}

function OrderBadges({ order }) {
  const statusConfig = getStatusConfig(order.status);
  const priorityConfig = getPriorityConfig(order.priority);

  return (
    <div className="flex items-center gap-3">
      <Badge
        variant="outline"
        className={cn("px-3 py-1", statusConfig.className)}
      >
        {order.status_display || statusConfig.label}
      </Badge>
      <Badge
        variant="outline"
        className={cn("px-3 py-1", priorityConfig.className)}
      >
        {order.priority_display || priorityConfig.label}
      </Badge>
      {order.has_critical_results && (
        <Badge
          variant="outline"
          className="px-3 py-1 bg-rose-100 text-rose-700 border-rose-300"
        >
          <AlertTriangle className="size-3 mr-1" />
          Critical
        </Badge>
      )}
    </div>
  );
}

function PatientInformation({ order }) {
  return (
    <div className="bg-card/50 rounded-lg border border-border p-4">
      <h3 className="font-heading text-sm font-medium text-muted-foreground mb-3">
        Patient Information
      </h3>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <User className="size-4 text-muted-foreground" />
          <span className="font-display text-lg">{order.patient_name}</span>
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          MRN: {order.patient_mrn || "-"}
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <span className="font-mono uppercase tracking-[0.2em] text-[10px]">DOB</span>
            <p className="mt-1 text-foreground">{formatDob(order.patient_dob)}</p>
          </div>
          <div>
            <span className="font-mono uppercase tracking-[0.2em] text-[10px]">Gender</span>
            <p className="mt-1 text-foreground">
              {order.patient_gender_display || order.patient_gender || "-"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderInformation({ order }) {
  return (
    <div className="bg-card/50 rounded-lg border border-border p-4">
      <h3 className="font-heading text-sm font-medium text-muted-foreground mb-3">
        Order Information
      </h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Ordered By:</span>
          <p className="font-medium">{order.ordering_provider_name}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Order Date:</span>
          <p className="font-mono text-xs">{formatDate(order.ordered_at || order.created_at)}</p>
        </div>
        {order.fasting_required && (
          <div className="col-span-2">
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Fasting Required
            </Badge>
          </div>
        )}
        {order.clinical_notes && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Clinical Notes:</span>
            <p className="mt-1 text-foreground">{order.clinical_notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TestsOrdered({ tests }) {
  return (
    <div className="bg-card/50 rounded-lg border border-border p-4">
      <h3 className="font-heading text-sm font-medium text-muted-foreground mb-3">
        Tests Ordered ({tests?.length || 0})
      </h3>
      <div className="space-y-2">
        {tests?.map((orderTest, index) => (
          <div
            key={orderTest.id || index}
            className="flex items-center justify-between py-2 px-3 bg-background rounded-md"
          >
            <div>
              <span className="text-sm font-medium">
                {orderTest.test?.name || orderTest.test?.short_name || "Unknown Test"}
              </span>
              {orderTest.test?.code && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  ({orderTest.test.code})
                </span>
              )}
            </div>
            <Badge variant="outline" className="text-xs">
              {orderTest.status_display || orderTest.status}
            </Badge>
          </div>
        ))}
        {(!tests || tests.length === 0) && (
          <p className="text-sm text-muted-foreground py-2">No tests in this order</p>
        )}
      </div>
    </div>
  );
}

function StatusTimeline({ order }) {
  const timelineItems = [
    ["created_at", "Created", "bg-stone-400"],
    ["ordered_at", "Ordered", "bg-sky-500"],
    ["collected_at", "Collected", "bg-amber-500"],
    ["received_at", "Received", "bg-violet-500"],
    ["completed_at", "Completed", "bg-emerald-500"],
    ["cancelled_at", "Cancelled", "bg-rose-500"],
  ];

  return (
    <div className="bg-card/50 rounded-lg border border-border p-4">
      <h3 className="font-heading text-sm font-medium text-muted-foreground mb-3">
        Status Timeline
      </h3>
      <div className="space-y-3">
        {timelineItems.map(([field, label, markerClass]) => (
          order[field] && (
            <div key={field} className="flex items-center gap-3 text-sm">
              <div className={cn("size-2 rounded-full", markerClass)} />
              <span className="text-muted-foreground">{label}:</span>
              <span className="font-mono text-xs">{formatDate(order[field])}</span>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function SpecimensList({ specimens }) {
  if (!specimens || specimens.length === 0) return null;

  return (
    <div className="bg-card/50 rounded-lg border border-border p-4">
      <h3 className="font-heading text-sm font-medium text-muted-foreground mb-3">
        Specimens ({specimens.length})
      </h3>
      <div className="space-y-2">
        {specimens.map((specimen, index) => (
          <div
            key={specimen.id || index}
            className="flex items-center justify-between py-2 px-3 bg-background rounded-md"
          >
            <div className="flex items-center gap-3">
              <Droplet className="size-4 text-amber-500" />
              <div>
                <p className="text-sm font-medium capitalize">
                  {specimen.specimen_type}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {specimen.barcode}
                </p>
              </div>
            </div>
            <div className="text-right">
              <Badge
                variant="outline"
                className={cn(
                  "text-xs capitalize",
                  specimen.status === "rejected"
                    ? "bg-rose-100 text-rose-700"
                    : specimen.status === "received"
                    ? "bg-violet-100 text-violet-700"
                    : "bg-amber-100 text-amber-700"
                )}
              >
                {specimen.status}
              </Badge>
              {specimen.collected_at && (
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  {formatDate(specimen.collected_at)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CancellationReason({ order }) {
  if (order.status !== "cancelled" || !order.cancellation_reason) return null;

  return (
    <div className="bg-rose-50 dark:bg-rose-900/20 rounded-lg border border-rose-200 dark:border-rose-800 p-4">
      <h3 className="font-heading text-sm font-medium text-rose-700 dark:text-rose-400 mb-2">
        Cancellation Reason
      </h3>
      <p className="text-sm text-rose-600 dark:text-rose-300">
        {order.cancellation_reason}
      </p>
    </div>
  );
}

function LabOrderDetailContent({ order }) {
  return (
    <div className="space-y-6">
      <OrderBadges order={order} />
      <PatientInformation order={order} />
      <OrderInformation order={order} />
      <TestsOrdered tests={order.order_tests} />
      <StatusTimeline order={order} />
      <SpecimensList specimens={order.specimens} />
      <CancellationReason order={order} />
    </div>
  );
}

function LabOrderActionFooter({
  canCancel,
  canCollect,
  canEnterResults,
  onCollect,
  onEnterResults,
  onCancelOrder,
}) {
  if (!canCancel && !canCollect && !canEnterResults) return null;

  return (
    <footer className="px-6 py-4 border-t border-border bg-card">
      <div className="flex justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          {canCollect && (
            <Button
              onClick={onCollect}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Droplet className="size-4 mr-2" />
              Collect Specimen
            </Button>
          )}

          {canEnterResults && (
            <Button
              onClick={onEnterResults}
              className="bg-sky-600 hover:bg-sky-700 text-white"
            >
              <ClipboardEdit className="size-4 mr-2" />
              Enter Results
            </Button>
          )}
        </div>

        <div>
          {canCancel && (
            <Button
              variant="destructive"
              onClick={onCancelOrder}
              className="bg-rose-600 hover:bg-rose-700"
            >
              <XCircle className="size-4 mr-2" />
              Cancel Order
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}

/**
 * LabOrderDetailSlideOver - Chronicle-styled slide-over for viewing lab order details
 *
 * Features:
 * - Full order details with tests list
 * - Status timeline
 * - Cancel order button (for non-completed orders)
 * - Patient and provider information
 */
const LabOrderDetailSlideOver = ({
  open,
  onClose,
  orderId,
  onOrderCancelled,
  onSpecimenCollected,
  onResultsEntered,
}) => {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [collectDialogOpen, setCollectDialogOpen] = useState(false);
  const [resultEntryOpen, setResultEntryOpen] = useState(false);

  const { data: order, isLoading, refetch } = useLabOrder(orderId);

  const canCancel = order && !["completed", "cancelled"].includes(order.status);
  const canCollect = order && order.status === "ordered";
  const canEnterResults = order &&
    ["received", "processing"].includes(order.status) &&
    order.specimens &&
    order.specimens.length > 0;

  const specimenForResults = order?.specimens?.find(s => s.status !== "rejected") || order?.specimens?.[0];

  const handleCancelSuccess = () => {
    refetch();
    onOrderCancelled?.();
  };

  const handleCollectSuccess = () => {
    refetch();
    onSpecimenCollected?.();
  };

  const handleResultsSuccess = () => {
    refetch();
    onResultsEntered?.();
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
          "transform transition-transform duration-300 ease-in-out",
          "flex flex-col shadow-2xl",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <LabOrderSlideOverHeader order={order} onClose={onClose} />

        <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
          {isLoading ? (
            <LabOrderLoadingState />
          ) : order ? (
            <LabOrderDetailContent order={order} />
          ) : (
            <LabOrderNotFoundState />
          )}
        </div>

        {order && (
          <LabOrderActionFooter
            canCancel={canCancel}
            canCollect={canCollect}
            canEnterResults={canEnterResults}
            onCollect={() => setCollectDialogOpen(true)}
            onEnterResults={() => setResultEntryOpen(true)}
            onCancelOrder={() => setCancelDialogOpen(true)}
          />
        )}
      </div>

      <CancelOrderDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        order={order}
        onSuccess={handleCancelSuccess}
      />

      <SpecimenCollectionDialog
        open={collectDialogOpen}
        onOpenChange={setCollectDialogOpen}
        order={order}
        onSuccess={handleCollectSuccess}
      />

      <LabResultEntrySlideOver
        open={resultEntryOpen}
        onClose={() => setResultEntryOpen(false)}
        order={order}
        specimen={specimenForResults}
        onSuccess={handleResultsSuccess}
      />
    </>
  );
};

export { LabOrderDetailSlideOver };
export default LabOrderDetailSlideOver;
