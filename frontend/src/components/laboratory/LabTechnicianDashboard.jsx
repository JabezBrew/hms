import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TestTube2,
  AlertTriangle,
  Clock,
  User,
  Calendar,
  Search,
  Package,
  CheckCircle2,
  XCircle,
  Play,
  Beaker,
  FileText,
} from "lucide-react";
import { format } from "date-fns";
import {
  useLabOrders,
  useCollectLabOrder,
  useReceiveLabOrder,
  useStartProcessingLabOrder,
  useCompleteLabOrder,
  useCreateLabResult,
} from "@/hooks/useLabQueries";
import { toast } from "sonner";

/**
 * LabTechnicianDashboard - Lab technician worklist and workflow management
 *
 * Features:
 * - Orders grouped by status (submitted, collected, received, processing)
 * - Quick actions for status transitions
 * - Result entry form for completed tests
 * - Patient and order search
 * - Priority highlighting
 * - Specimen barcode tracking
 * - Chronicle design system styling
 */
const LabTechnicianDashboard = () => {
  const [activeTab, setActiveTab] = useState("submitted");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [selectedTest, setSelectedTest] = useState(null);

  // Form states
  const [specimenBarcode, setSpecimenBarcode] = useState("");
  const [collectionNotes, setCollectionNotes] = useState("");
  const [resultData, setResultData] = useState({
    value: "",
    unit: "",
    result_notes: "",
    is_abnormal: false,
    is_critical: false,
    reference_range: { low: "", high: "", unit: "" },
  });

  // API queries
  const { data: submittedOrders } = useLabOrders({ status: "submitted" });
  const { data: collectedOrders } = useLabOrders({ status: "collected" });
  const { data: receivedOrders } = useLabOrders({ status: "received" });
  const { data: processingOrders } = useLabOrders({ status: "processing" });

  // Mutations
  const collectOrder = useCollectLabOrder();
  const receiveOrder = useReceiveLabOrder();
  const startProcessing = useStartProcessingLabOrder();
  const completeOrder = useCompleteLabOrder();
  const createResult = useCreateLabResult();

  // Get orders for active tab
  const getActiveOrders = () => {
    switch (activeTab) {
      case "submitted":
        return submittedOrders?.results || [];
      case "collected":
        return collectedOrders?.results || [];
      case "received":
        return receivedOrders?.results || [];
      case "processing":
        return processingOrders?.results || [];
      default:
        return [];
    }
  };

  // Filter orders by search
  const filteredOrders = getActiveOrders().filter((order) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    const patientName =
      `${order.patient_details?.first_name} ${order.patient_details?.last_name}`.toLowerCase();
    const mrn = order.patient_details?.medical_record_number?.toLowerCase() || "";
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

        case "receive":
          await receiveOrder.mutateAsync(selectedOrder.id);
          toast.success("Specimen received", {
            description: `Order #${selectedOrder.order_number}`,
          });
          break;

        case "start":
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

  // Handle result entry
  const handleResultEntryClick = (order, test) => {
    setSelectedOrder(order);
    setSelectedTest(test);

    // Pre-populate reference range if available
    const refRange = test.test?.reference_range || {};
    setResultData({
      value: "",
      unit: test.test?.unit || "",
      result_notes: "",
      is_abnormal: false,
      is_critical: false,
      reference_range: {
        low: refRange.low || "",
        high: refRange.high || "",
        unit: refRange.unit || test.test?.unit || "",
      },
    });

    setResultDialogOpen(true);
  };

  // Handle result submit
  const handleResultSubmit = async () => {
    if (!selectedTest || !resultData.value) {
      toast.error("Please enter a result value");
      return;
    }

    try {
      await createResult.mutateAsync({
        order_test: selectedTest.id,
        value: resultData.value,
        unit: resultData.unit,
        result_notes: resultData.result_notes,
        is_abnormal: resultData.is_abnormal,
        is_critical: resultData.is_critical,
        reference_range: resultData.reference_range,
      });

      toast.success("Result recorded", {
        description: `Result for ${selectedTest.test?.name}`,
      });

      setResultDialogOpen(false);
      setSelectedTest(null);
      setSelectedOrder(null);
    } catch (error) {
      console.error("Error recording result:", error);
      toast.error("Failed to record result", {
        description: error.message || "Please try again",
      });
    }
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
    receive: {
      title: "Receive Specimen",
      description: "Confirm that the specimen has been received in the laboratory",
      needsBarcode: false,
      buttonLabel: "Receive Specimen",
      icon: CheckCircle2,
    },
    start: {
      title: "Start Processing",
      description: "Begin processing and analysis of the specimen",
      needsBarcode: false,
      buttonLabel: "Start Processing",
      icon: Play,
    },
  };

  // Get order counts for tabs
  const orderCounts = {
    submitted: submittedOrders?.count || 0,
    collected: collectedOrders?.count || 0,
    received: receivedOrders?.count || 0,
    processing: processingOrders?.count || 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-stone-900">
            Laboratory Worklist
          </h1>
          <p className="text-stone-600 mt-1">
            Manage specimen collection, processing, and results
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-stone-400" />
        <Input
          placeholder="Search by patient name, MRN, or order number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="submitted" className="relative">
            Submitted
            {orderCounts.submitted > 0 && (
              <Badge className="ml-2 bg-sky-600">{orderCounts.submitted}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="collected" className="relative">
            Collected
            {orderCounts.collected > 0 && (
              <Badge className="ml-2 bg-amber-600">{orderCounts.collected}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="received" className="relative">
            Received
            {orderCounts.received > 0 && (
              <Badge className="ml-2 bg-violet-600">{orderCounts.received}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="processing" className="relative">
            Processing
            {orderCounts.processing > 0 && (
              <Badge className="ml-2 bg-indigo-600">{orderCounts.processing}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Tab Content */}
        {["submitted", "collected", "received", "processing"].map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-6 space-y-4">
            {filteredOrders.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center text-stone-500">
                    <TestTube2 className="h-12 w-12 mx-auto mb-3 text-stone-300" />
                    <p className="font-medium">No orders in this category</p>
                    <p className="text-sm mt-1">
                      Orders will appear here as they progress through the workflow
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              filteredOrders.map((order) => {
                const priority = priorityConfig[order.priority];
                const PriorityIcon = priority.icon;

                return (
                  <Card key={order.id} className="border-stone-200">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg font-heading">
                            Order #{order.order_number}
                          </CardTitle>
                          <CardDescription className="mt-2 space-y-1">
                            <div className="flex items-center gap-4">
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {order.patient_details?.first_name}{" "}
                                {order.patient_details?.last_name}
                              </span>
                              {order.patient_details?.medical_record_number && (
                                <span className="font-mono text-stone-500">
                                  MRN: {order.patient_details.medical_record_number}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {format(new Date(order.created_at), "MMM dd, yyyy HH:mm")}
                              </span>
                            </div>
                          </CardDescription>
                        </div>
                        <Badge className={cn("gap-1", priority.color)}>
                          <PriorityIcon className="h-3 w-3" />
                          {priority.label}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Clinical Info */}
                      {order.indication && (
                        <div className="bg-stone-50 border border-stone-200 rounded-lg p-3">
                          <p className="text-xs font-medium text-stone-700 mb-1">
                            Clinical Indication:
                          </p>
                          <p className="text-sm text-stone-900">{order.indication}</p>
                        </div>
                      )}

                      {/* Tests */}
                      <div>
                        <p className="text-sm font-medium text-stone-700 mb-2">
                          Tests Ordered:
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {order.order_tests?.map((orderTest) => (
                            <div
                              key={orderTest.id}
                              className="flex items-center justify-between bg-white border border-stone-200 rounded-lg p-3"
                            >
                              <div className="flex items-center gap-2">
                                {orderTest.panel ? (
                                  <>
                                    <Package className="h-4 w-4 text-stone-500" />
                                    <span className="text-sm text-stone-900">
                                      {orderTest.panel.name}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <TestTube2 className="h-4 w-4 text-stone-500" />
                                    <span className="text-sm text-stone-900">
                                      {orderTest.test?.name}
                                    </span>
                                  </>
                                )}
                              </div>
                              {tab === "processing" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleResultEntryClick(order, orderTest)}
                                >
                                  <Beaker className="h-3 w-3 mr-1" />
                                  Enter Result
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Specimen Info */}
                      {order.specimens && order.specimens.length > 0 && (
                        <div className="bg-stone-50 border border-stone-200 rounded-lg p-3">
                          <p className="text-xs font-medium text-stone-700 mb-2">
                            Specimens:
                          </p>
                          <div className="space-y-1">
                            {order.specimens.map((specimen) => (
                              <div
                                key={specimen.id}
                                className="text-sm text-stone-900 font-mono"
                              >
                                {specimen.barcode_number}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2">
                        {tab === "submitted" && (
                          <Button
                            onClick={() => handleActionClick(order, "collect")}
                            className="bg-amber-600 hover:bg-amber-700"
                          >
                            <TestTube2 className="h-4 w-4 mr-2" />
                            Collect Specimen
                          </Button>
                        )}
                        {tab === "collected" && (
                          <Button
                            onClick={() => handleActionClick(order, "receive")}
                            className="bg-violet-600 hover:bg-violet-700"
                          >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            Receive in Lab
                          </Button>
                        )}
                        {tab === "received" && (
                          <Button
                            onClick={() => handleActionClick(order, "start")}
                            className="bg-indigo-600 hover:bg-indigo-700"
                          >
                            <Play className="h-4 w-4 mr-2" />
                            Start Processing
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Action Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionConfig[currentAction]?.title}</DialogTitle>
            <DialogDescription>
              {actionConfig[currentAction]?.description}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="py-4 space-y-4">
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-600">Order Number:</span>
                    <span className="font-semibold text-stone-900">
                      #{selectedOrder.order_number}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-stone-600">Patient:</span>
                    <span className="font-semibold text-stone-900">
                      {selectedOrder.patient_details?.first_name}{" "}
                      {selectedOrder.patient_details?.last_name}
                    </span>
                  </div>
                </div>
              </div>

              {actionConfig[currentAction]?.needsBarcode && (
                <div className="space-y-2">
                  <Label htmlFor="specimen_barcode">Specimen Barcode *</Label>
                  <Input
                    id="specimen_barcode"
                    placeholder="Scan or enter barcode..."
                    value={specimenBarcode}
                    onChange={(e) => setSpecimenBarcode(e.target.value)}
                    className="font-mono"
                  />
                </div>
              )}

              {currentAction === "collect" && (
                <div className="space-y-2">
                  <Label htmlFor="collection_notes">Collection Notes (Optional)</Label>
                  <Textarea
                    id="collection_notes"
                    placeholder="Any notes about the collection..."
                    value={collectionNotes}
                    onChange={(e) => setCollectionNotes(e.target.value)}
                    className="min-h-[80px]"
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
                receiveOrder.isPending ||
                startProcessing.isPending
              }
            >
              Cancel
            </Button>
            <Button
              onClick={handleActionSubmit}
              disabled={
                (actionConfig[currentAction]?.needsBarcode && !specimenBarcode) ||
                collectOrder.isPending ||
                receiveOrder.isPending ||
                startProcessing.isPending
              }
            >
              {collectOrder.isPending ||
              receiveOrder.isPending ||
              startProcessing.isPending
                ? "Processing..."
                : actionConfig[currentAction]?.buttonLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Result Entry Dialog */}
      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Enter Lab Result</DialogTitle>
            <DialogDescription>
              Record the result for {selectedTest?.test?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {/* Test Info */}
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-stone-600">Test:</span>
                  <span className="font-semibold text-stone-900">
                    {selectedTest?.test?.name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-600">Patient:</span>
                  <span className="font-semibold text-stone-900">
                    {selectedOrder?.patient_details?.first_name}{" "}
                    {selectedOrder?.patient_details?.last_name}
                  </span>
                </div>
              </div>
            </div>

            {/* Result Value */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="result_value">Result Value *</Label>
                <Input
                  id="result_value"
                  placeholder="Enter value..."
                  value={resultData.value}
                  onChange={(e) =>
                    setResultData((prev) => ({ ...prev, value: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="result_unit">Unit</Label>
                <Input
                  id="result_unit"
                  placeholder="e.g., mg/dL"
                  value={resultData.unit}
                  onChange={(e) =>
                    setResultData((prev) => ({ ...prev, unit: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* Reference Range */}
            <div className="space-y-2">
              <Label>Reference Range</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder="Low"
                  value={resultData.reference_range.low}
                  onChange={(e) =>
                    setResultData((prev) => ({
                      ...prev,
                      reference_range: {
                        ...prev.reference_range,
                        low: e.target.value,
                      },
                    }))
                  }
                />
                <Input
                  placeholder="High"
                  value={resultData.reference_range.high}
                  onChange={(e) =>
                    setResultData((prev) => ({
                      ...prev,
                      reference_range: {
                        ...prev.reference_range,
                        high: e.target.value,
                      },
                    }))
                  }
                />
                <Input
                  placeholder="Unit"
                  value={resultData.reference_range.unit}
                  onChange={(e) =>
                    setResultData((prev) => ({
                      ...prev,
                      reference_range: {
                        ...prev.reference_range,
                        unit: e.target.value,
                      },
                    }))
                  }
                />
              </div>
            </div>

            {/* Flags */}
            <div className="space-y-3">
              <Label>Result Flags</Label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resultData.is_abnormal}
                    onChange={(e) =>
                      setResultData((prev) => ({
                        ...prev,
                        is_abnormal: e.target.checked,
                      }))
                    }
                    className="rounded border-stone-300"
                  />
                  <span className="text-sm text-stone-700">Abnormal</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resultData.is_critical}
                    onChange={(e) =>
                      setResultData((prev) => ({
                        ...prev,
                        is_critical: e.target.checked,
                      }))
                    }
                    className="rounded border-stone-300"
                  />
                  <span className="text-sm text-rose-700 font-medium">Critical Value</span>
                </label>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="result_notes">Result Notes</Label>
              <Textarea
                id="result_notes"
                placeholder="Any additional notes about the result..."
                value={resultData.result_notes}
                onChange={(e) =>
                  setResultData((prev) => ({ ...prev, result_notes: e.target.value }))
                }
                className="min-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResultDialogOpen(false)}
              disabled={createResult.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleResultSubmit}
              disabled={createResult.isPending || !resultData.value}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {createResult.isPending ? "Recording..." : "Record Result"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LabTechnicianDashboard;
