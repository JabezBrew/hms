import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import Play from 'lucide-react/dist/esm/icons/play.js';
import Beaker from 'lucide-react/dist/esm/icons/beaker.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import format from "date-fns/format";
import {
  useLabOrders,
  useCollectLabOrder,
  useStartProcessingLabOrder,
} from "@/hooks/useLabQueries";
import { toast } from "sonner";
import { LabResultEntrySlideOver } from "./LabResultEntrySlideOver";

/**
 * LabTechnicianDashboard - Lab technician worklist and workflow management
 *
 * Features:
 * - Orders grouped by status (collected, processing)
 * - Quick actions for status transitions (Start Processing skips RECEIVED status)
 * - Result entry form for completed tests
 * - Patient and order search
 * - Priority highlighting
 * - Specimen barcode tracking
 * - Chronicle design system styling
 */
const LabTechnicianDashboard = () => {
  const [activeTab, setActiveTab] = useState("collected");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState(null);
  const [resultEntryOpen, setResultEntryOpen] = useState(false);

  // Form states
  const [specimenBarcode, setSpecimenBarcode] = useState("");
  const [collectionNotes, setCollectionNotes] = useState("");

  // API queries - Lab worklist only shows collected onwards (not submitted/ordered)
  // Include expand=tests to get full order_tests array with test details
  const { data: collectedOrders } = useLabOrders({ status: "collected", expand: "tests,specimens" });
  const { data: processingOrders } = useLabOrders({ status: "processing", expand: "tests,specimens" });

  // Mutations
  const collectOrder = useCollectLabOrder();
  const startProcessing = useStartProcessingLabOrder();

  // Get orders for active tab
  const getActiveOrders = () => {
    switch (activeTab) {
      case "collected":
        return collectedOrders?.results || collectedOrders || [];
      case "processing":
        return processingOrders?.results || processingOrders || [];
      default:
        return [];
    }
  };

  // Filter orders by search
  const filteredOrders = getActiveOrders().filter((order) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    const patientName = order.patient_name?.toLowerCase() || "";
    const mrn = order.patient_mrn?.toLowerCase() || "";
    const orderNumber = order.order_number?.toLowerCase() || "";

    return (
      patientName.includes(query) || mrn.includes(query) || orderNumber.includes(query)
    );
  });

  // Handle action click
  const handleActionClick = (order, action) => {
    setSelectedOrder(order);
    setCurrentAction(action);
    setSpecimenBarcode("");
    setCollectionNotes("");
    setActionDialogOpen(true);
  };

  // Handle action submit
  const handleActionSubmit = async () => {
    if (!selectedOrder) return;

    try {
      switch (currentAction) {
        case "collect":
          await collectOrder.mutateAsync({
            id: selectedOrder.id,
            specimenBarcode,
            collectionNotes,
          });
          toast.success("Specimen collected", {
            description: `Order #${selectedOrder.order_number}`,
          });
          break;

        case "start":
          // Start processing directly from collected (skip received status)
          await startProcessing.mutateAsync(selectedOrder.id);
          toast.success("Processing started", {
            description: `Order #${selectedOrder.order_number}`,
          });
          break;

        default:
          break;
      }

      setActionDialogOpen(false);
      setSelectedOrder(null);
      setCurrentAction(null);
    } catch (error) {
      console.error("Error performing action:", error);
      toast.error("Action failed", {
        description: error.message || "Please try again",
      });
    }
  };

  // Handle bulk result entry - opens the slide-over for all tests in order
  const handleEnterResults = (order) => {
    setSelectedOrder(order);
    setResultEntryOpen(true);
  };

  // Handle result entry success
  const handleResultEntrySuccess = () => {
    setResultEntryOpen(false);
    setSelectedOrder(null);
  };

  // Get the first non-rejected specimen for result entry
  const getSpecimenForOrder = (order) => {
    return order?.specimens?.find(s => s.status !== "rejected") || order?.specimens?.[0];
  };

  // Priority config
  const priorityConfig = {
    routine: { label: "Routine", color: "bg-stone-100 text-stone-700", icon: Clock },
    urgent: { label: "Urgent", color: "bg-amber-100 text-amber-700", icon: AlertTriangle },
    stat: { label: "STAT", color: "bg-rose-100 text-rose-700", icon: AlertTriangle },
  };

  // Action config
  const actionConfig = {
    collect: {
      title: "Collect Specimen",
      description: "Mark this order's specimen as collected and ready for processing",
      needsBarcode: true,
      buttonLabel: "Collect Specimen",
      icon: TestTube2,
    },
    start: {
      title: "Start Processing",
      description: "Receive the specimen in the lab and begin processing",
      needsBarcode: false,
      buttonLabel: "Start Processing",
      icon: Play,
    },
  };

  // Get order counts for tabs
  const orderCounts = {
    collected: collectedOrders?.count || 0,
    processing: processingOrders?.count || 0,
  };

  return (
    <div className="space-y-6">
      {/* Chronicle Hero Header */}
      <header className="relative overflow-hidden rounded-2xl bg-card/50 backdrop-blur border border-border p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-[oklch(0.70_0.15_230)]/10 via-transparent to-primary/5" />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-[oklch(0.70_0.15_230)]/10 border border-[oklch(0.70_0.15_230)]/20">
              <FlaskConical className="h-8 w-8 text-[oklch(0.70_0.15_230)]" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight">
                Laboratory Worklist
              </h1>
              <p className="font-mono text-xs sm:text-sm text-muted-foreground mt-1">
                Manage specimen collection, processing, and results
              </p>
            </div>
          </div>
          {/* Stats */}
          <div className="hidden sm:flex items-center gap-6">
            <div className="text-right">
              <p className="font-mono text-2xl text-foreground">{orderCounts.collected}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Collected</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div className="text-right">
              <p className="font-mono text-2xl text-foreground">{orderCounts.processing}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Processing</p>
            </div>
          </div>
        </div>
      </header>

      {/* Search with Chronicle styling */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Label htmlFor="lab-search" className="sr-only">Search by patient name, MRN, or order number</Label>
        <Input
          id="lab-search"
          placeholder="Search by patient name, MRN, or order number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-11 h-11 bg-card/50 border-border font-mono text-sm placeholder:text-muted-foreground"
        />
      </div>

      {/* Chronicle-styled Tabs */}
      <div role="tablist" aria-label="Lab order status" className="flex gap-2 border-b border-border pb-0">
        <button
          role="tab"
          id="tab-collected"
          aria-selected={activeTab === "collected"}
          aria-controls="tabpanel-collected"
          onClick={() => setActiveTab("collected")}
          className={cn(
            "relative px-4 py-3 font-mono text-xs uppercase tracking-widest transition-colors",
            activeTab === "collected"
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2">
            Collected
            {orderCounts.collected > 0 && (
              <span className="badge-chronicle-amber px-1.5 py-0.5 text-[10px]">
                {orderCounts.collected}
              </span>
            )}
          </span>
          {activeTab === "collected" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" aria-hidden="true" />
          )}
        </button>
        <button
          role="tab"
          id="tab-processing"
          aria-selected={activeTab === "processing"}
          aria-controls="tabpanel-processing"
          onClick={() => setActiveTab("processing")}
          className={cn(
            "relative px-4 py-3 font-mono text-xs uppercase tracking-widest transition-colors",
            activeTab === "processing"
              ? "text-[oklch(0.70_0.15_230)]"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2">
            Processing
            {orderCounts.processing > 0 && (
              <span className="badge-chronicle-sky px-1.5 py-0.5 text-[10px]">
                {orderCounts.processing}
              </span>
            )}
          </span>
          {activeTab === "processing" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[oklch(0.70_0.15_230)]" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Tab Content with Chronicle cards */}
      <div
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        className="space-y-4"
      >
        {filteredOrders.length === 0 ? (
          <div className="bg-card/50 backdrop-blur border border-border rounded-2xl p-12 animate-chronicle-enter">
            <div className="text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                <TestTube2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="font-display text-xl text-foreground mb-2">No orders in this category</p>
              <p className="font-mono text-xs text-muted-foreground">
                Orders will appear here as they progress through the workflow
              </p>
            </div>
          </div>
        ) : (
          filteredOrders.map((order, index) => {
            const priority = priorityConfig[order.priority];
            const PriorityIcon = priority?.icon || Clock;

            return (
              <article
                key={order.id}
                className={cn(
                  "group relative bg-card/50 backdrop-blur border border-border",
                  "rounded-xl sm:rounded-2xl p-4 sm:p-6",
                  "hover:border-primary/30 transition-all duration-500",
                  "hover:shadow-[0_0_40px_-12px_var(--chronicle-amber)]",
                  "animate-chronicle-enter"
                )}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Priority Status Ribbon */}
                <div className={cn(
                  "status-ribbon",
                  order.priority === 'stat' && "status-ribbon-critical",
                  order.priority === 'urgent' && "status-ribbon-warning",
                  order.priority === 'routine' && "status-ribbon-stable"
                )} />

                {/* Header */}
                <header className="flex items-start justify-between gap-4 mb-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-display text-lg sm:text-xl text-foreground tracking-tight">
                        {order.patient_name}
                      </h3>
                      <span className={cn(
                        "shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase",
                        order.priority === 'stat' && "bg-[oklch(0.65_0.22_15)]/10 text-[oklch(0.65_0.22_15)]",
                        order.priority === 'urgent' && "bg-primary/10 text-primary",
                        order.priority === 'routine' && "bg-muted text-muted-foreground"
                      )}>
                        <PriorityIcon className="h-3 w-3" />
                        {priority?.label || 'Routine'}
                      </span>
                    </div>
                    <p className="font-mono text-[10px] sm:text-xs text-muted-foreground flex flex-wrap items-center gap-2 sm:gap-4">
                      <span className="flex items-center gap-1">
                        <span className="text-foreground/70">MRN</span>
                        {order.patient_mrn || '—'}
                      </span>
                      <span className="hidden sm:inline text-border">·</span>
                      <span className="flex items-center gap-1">
                        <span className="text-foreground/70">Order</span>
                        #{order.order_number}
                      </span>
                      <span className="hidden sm:inline text-border">·</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(order.created_at), "MMM dd, HH:mm")}
                      </span>
                    </p>
                  </div>
                </header>

                {/* Clinical Info */}
                {order.indication && (
                  <div className="bg-background/50 border border-border rounded-lg p-3 mb-4">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Clinical Indication
                    </p>
                    <p className="text-sm text-foreground">{order.indication}</p>
                  </div>
                )}

                {/* Tests Grid */}
                <div className="mb-4">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                    Tests Ordered ({order.order_tests?.length || 0})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {order.order_tests?.map((orderTest) => (
                      <span
                        key={orderTest.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background/50 border border-border text-xs text-foreground"
                      >
                        {orderTest.panel ? (
                          <>
                            <Package className="h-3 w-3 text-muted-foreground" />
                            {orderTest.panel.name}
                          </>
                        ) : (
                          <>
                            <TestTube2 className="h-3 w-3 text-muted-foreground" />
                            {orderTest.test?.name}
                          </>
                        )}
                        {orderTest.result && (
                          <CheckCircle2 className="h-3 w-3 text-[oklch(0.70_0.17_155)] ml-1" />
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Specimen Info */}
                {order.specimens && order.specimens.length > 0 && (
                  <div className="bg-background/50 border border-border rounded-lg p-3 mb-4">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                      Specimens
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {order.specimens.map((specimen) => (
                        <span
                          key={specimen.id}
                          className="font-mono text-xs text-foreground bg-muted/50 px-2 py-1 rounded"
                        >
                          {specimen.barcode_number}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions Footer */}
                <footer className="flex items-center justify-between pt-4 border-t border-border">
                  <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {activeTab === "collected" ? "Ready for processing" : "In progress"}
                  </span>
                  <div className="flex gap-2">
                    {activeTab === "collected" && (
                      <Button
                        onClick={() => handleActionClick(order, "start")}
                        size="sm"
                        className="font-mono text-xs bg-[oklch(0.70_0.15_230)] hover:bg-[oklch(0.65_0.15_230)]"
                      >
                        <Play className="h-3 w-3 mr-1.5" />
                        Start Processing
                      </Button>
                    )}
                    {activeTab === "processing" && (
                      <Button
                        onClick={() => handleEnterResults(order)}
                        size="sm"
                        className="font-mono text-xs bg-primary hover:bg-primary/90"
                      >
                        <Beaker className="h-3 w-3 mr-1.5" />
                        Enter Results
                      </Button>
                    )}
                  </div>
                </footer>
              </article>
            );
          })
        )}
      </div>

      {/* Action Dialog - Chronicle styled */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground">
              {actionConfig[currentAction]?.title}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">
              {actionConfig[currentAction]?.description}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="py-4 space-y-4">
              <div className="bg-background/50 border border-border rounded-lg p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Order Number</span>
                    <span className="font-mono text-sm text-foreground">
                      #{selectedOrder.order_number}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Patient</span>
                    <span className="font-display text-sm text-foreground">
                      {selectedOrder.patient_name}
                    </span>
                  </div>
                </div>
              </div>

              {actionConfig[currentAction]?.needsBarcode && (
                <div className="space-y-2">
                  <Label htmlFor="specimen_barcode" className="font-mono text-xs text-muted-foreground">
                    Specimen Barcode *
                  </Label>
                  <Input
                    id="specimen_barcode"
                    placeholder="Scan or enter barcode..."
                    value={specimenBarcode}
                    onChange={(e) => setSpecimenBarcode(e.target.value)}
                    className="font-mono bg-background/50 border-border"
                  />
                </div>
              )}

              {currentAction === "collect" && (
                <div className="space-y-2">
                  <Label htmlFor="collection_notes" className="font-mono text-xs text-muted-foreground">
                    Collection Notes (Optional)
                  </Label>
                  <Textarea
                    id="collection_notes"
                    placeholder="Any notes about the collection..."
                    value={collectionNotes}
                    onChange={(e) => setCollectionNotes(e.target.value)}
                    className="min-h-[80px] bg-background/50 border-border"
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActionDialogOpen(false)}
              disabled={
                collectOrder.isPending ||
                startProcessing.isPending
              }
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleActionSubmit}
              disabled={
                (actionConfig[currentAction]?.needsBarcode && !specimenBarcode) ||
                collectOrder.isPending ||
                startProcessing.isPending
              }
              className="font-mono text-xs bg-[oklch(0.70_0.15_230)] hover:bg-[oklch(0.65_0.15_230)]"
            >
              {collectOrder.isPending ||
              startProcessing.isPending
                ? "Processing..."
                : actionConfig[currentAction]?.buttonLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Result Entry Slide-Over */}
      <LabResultEntrySlideOver
        open={resultEntryOpen}
        onClose={() => {
          setResultEntryOpen(false);
          setSelectedOrder(null);
        }}
        order={selectedOrder}
        specimen={getSpecimenForOrder(selectedOrder)}
        onSuccess={handleResultEntrySuccess}
      />
    </div>
  );
};

export default LabTechnicianDashboard;
