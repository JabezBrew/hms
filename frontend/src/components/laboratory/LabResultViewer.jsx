import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  TestTube2,
  AlertTriangle,
  Check,
  Clock,
  User,
  FileText,
  TrendingUp,
  TrendingDown,
  Calendar,
  Package,
} from "lucide-react";
import { format } from "date-fns";
import { useLabOrder, useLabResults, useVerifyLabResult } from "@/hooks/useLabQueries";
import { toast } from "sonner";

/**
 * LabResultViewer - Comprehensive lab results display
 *
 * Features:
 * - Results grouped by order with test details
 * - Abnormal value highlighting (high/low/critical)
 * - Reference ranges display
 * - Verification workflow for supervisors
 * - Historical trending indicators
 * - Panel grouping with individual test results
 * - Chronicle design system styling
 */
const LabResultViewer = ({ orderId, compact = false, allowVerification = false }) => {
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [selectedResult, setSelectedResult] = useState(null);
  const [verificationNotes, setVerificationNotes] = useState("");

  // API queries
  const { data: order, isLoading: orderLoading } = useLabOrder(orderId, {
    enabled: !!orderId,
  });
  const { data: resultsData, isLoading: resultsLoading } = useLabResults({
    order: orderId,
  });
  const verifyResult = useVerifyLabResult();

  // Get result status
  const getResultStatus = (result) => {
    if (result.is_critical) return "critical";
    if (result.is_abnormal) return "abnormal";
    return "normal";
  };

  // Get status config
  const statusConfig = {
    normal: {
      label: "Normal",
      color: "text-emerald-700 bg-emerald-50 border-emerald-200",
      icon: Check,
    },
    abnormal: {
      label: "Abnormal",
      color: "text-amber-700 bg-amber-50 border-amber-200",
      icon: AlertTriangle,
    },
    critical: {
      label: "Critical",
      color: "text-rose-700 bg-rose-50 border-rose-200",
      icon: AlertTriangle,
    },
  };

  // Get trending indicator
  const getTrendIndicator = (result) => {
    if (!result.reference_range) return null;

    const value = parseFloat(result.value);
    const { low, high } = result.reference_range;

    if (low && value < low) {
      return {
        icon: TrendingDown,
        color: "text-rose-600",
        label: "Below normal",
      };
    }
    if (high && value > high) {
      return {
        icon: TrendingUp,
        color: "text-amber-600",
        label: "Above normal",
      };
    }

    return null;
  };

  // Handle verify click
  const handleVerifyClick = (result) => {
    setSelectedResult(result);
    setVerificationNotes("");
    setVerifyDialogOpen(true);
  };

  // Handle verify submit
  const handleVerifySubmit = async () => {
    if (!selectedResult) return;

    try {
      await verifyResult.mutateAsync({
        id: selectedResult.id,
        verificationNotes: verificationNotes,
      });

      toast.success("Result verified", {
        description: `Result for ${selectedResult.order_test?.test?.name} has been verified`,
      });

      setVerifyDialogOpen(false);
      setSelectedResult(null);
      setVerificationNotes("");
    } catch (error) {
      console.error("Error verifying result:", error);
      toast.error("Failed to verify result", {
        description: error.message || "Please try again",
      });
    }
  };

  // Loading state
  if (orderLoading || resultsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-stone-500">Loading results...</div>
      </div>
    );
  }

  // No order found
  if (!order) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-stone-500">Order not found</div>
      </div>
    );
  }

  const results = resultsData?.results || [];

  // Group results by panel if applicable
  const groupedResults = results.reduce((acc, result) => {
    const panelId = result.order_test?.panel?.id || "individual";
    if (!acc[panelId]) {
      acc[panelId] = {
        panel: result.order_test?.panel || null,
        results: [],
      };
    }
    acc[panelId].results.push(result);
    return acc;
  }, {});

  // Order status badge
  const orderStatusConfig = {
    draft: { label: "Draft", color: "bg-stone-100 text-stone-700" },
    submitted: { label: "Submitted", color: "bg-sky-100 text-sky-700" },
    collected: { label: "Collected", color: "bg-amber-100 text-amber-700" },
    received: { label: "Received", color: "bg-violet-100 text-violet-700" },
    processing: { label: "Processing", color: "bg-indigo-100 text-indigo-700" },
    completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700" },
    cancelled: { label: "Cancelled", color: "bg-rose-100 text-rose-700" },
  };

  const priorityConfig = {
    routine: { label: "Routine", color: "bg-stone-100 text-stone-700" },
    urgent: { label: "Urgent", color: "bg-amber-100 text-amber-700" },
    stat: { label: "STAT", color: "bg-rose-100 text-rose-700" },
  };

  // Compact view
  if (compact) {
    return (
      <div className="space-y-3">
        {Object.entries(groupedResults).map(([panelId, group]) => (
          <Card key={panelId} className="border-stone-200">
            {group.panel && (
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-stone-500" />
                  <CardTitle className="text-base">{group.panel.name}</CardTitle>
                </div>
              </CardHeader>
            )}
            <CardContent className={group.panel ? "pt-0" : ""}>
              <div className="space-y-2">
                {group.results.map((result) => {
                  const status = getResultStatus(result);
                  const config = statusConfig[status];
                  const TrendIcon = getTrendIndicator(result)?.icon;

                  return (
                    <div
                      key={result.id}
                      className="flex items-center justify-between py-2 border-b border-stone-100 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", config.color)} />
                        <span className="text-sm font-medium text-stone-900">
                          {result.order_test?.test?.short_name ||
                            result.order_test?.test?.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {TrendIcon && (
                          <TrendIcon
                            className={cn("h-4 w-4", getTrendIndicator(result).color)}
                          />
                        )}
                        <span className="text-sm font-semibold text-stone-900">
                          {result.value} {result.unit}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Full view
  return (
    <div className="space-y-6">
      {/* Order Header */}
      <Card className="border-stone-200">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-xl font-heading">
                Laboratory Order #{order.order_number}
              </CardTitle>
              <CardDescription className="mt-2 flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(order.created_at), "MMM dd, yyyy")}
                </span>
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {order.ordering_provider?.first_name}{" "}
                  {order.ordering_provider?.last_name}
                </span>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={priorityConfig[order.priority]?.color}>
                {priorityConfig[order.priority]?.label}
              </Badge>
              <Badge className={orderStatusConfig[order.status]?.color}>
                {orderStatusConfig[order.status]?.label}
              </Badge>
            </div>
          </div>
        </CardHeader>
        {order.indication && (
          <CardContent>
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
              <p className="text-sm font-medium text-stone-700 mb-1">
                Clinical Indication:
              </p>
              <p className="text-sm text-stone-900">{order.indication}</p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Results */}
      {results.length === 0 ? (
        <Card className="border-stone-200">
          <CardContent className="py-12">
            <div className="text-center text-stone-500">
              <Clock className="h-12 w-12 mx-auto mb-3 text-stone-300" />
              <p className="font-medium">No results available yet</p>
              <p className="text-sm mt-1">Results will appear here once processed</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedResults).map(([panelId, group]) => (
            <Card key={panelId} className="border-stone-200">
              {group.panel && (
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-stone-500" />
                    <CardTitle className="text-lg font-heading">
                      {group.panel.name}
                    </CardTitle>
                  </div>
                  {group.panel.description && (
                    <CardDescription>{group.panel.description}</CardDescription>
                  )}
                </CardHeader>
              )}
              <CardContent className={group.panel ? "pt-0" : ""}>
                <div className="space-y-4">
                  {group.results.map((result) => {
                    const status = getResultStatus(result);
                    const config = statusConfig[status];
                    const StatusIcon = config.icon;
                    const trend = getTrendIndicator(result);

                    return (
                      <div
                        key={result.id}
                        className={cn(
                          "border rounded-lg p-4 transition-colors",
                          config.color
                        )}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-start gap-3">
                            <div
                              className={cn(
                                "mt-1 p-2 rounded-full",
                                config.color.replace("border-", "bg-")
                              )}
                            >
                              <TestTube2 className="h-4 w-4" />
                            </div>
                            <div>
                              <h4 className="font-semibold text-stone-900">
                                {result.order_test?.test?.name}
                              </h4>
                              {result.order_test?.test?.loinc_code && (
                                <p className="text-xs font-mono text-stone-600 mt-1">
                                  LOINC: {result.order_test.test.loinc_code}
                                </p>
                              )}
                            </div>
                          </div>
                          <Badge variant="outline" className={cn("gap-1", config.color)}>
                            <StatusIcon className="h-3 w-3" />
                            {config.label}
                          </Badge>
                        </div>

                        {/* Result Value */}
                        <div className="flex items-baseline gap-4 mb-3">
                          <div>
                            <p className="text-xs text-stone-600 mb-1">Result</p>
                            <div className="flex items-center gap-2">
                              <p className="text-2xl font-bold text-stone-900">
                                {result.value}
                              </p>
                              {result.unit && (
                                <p className="text-sm text-stone-600">{result.unit}</p>
                              )}
                              {trend && (
                                <div className="flex items-center gap-1">
                                  <trend.icon
                                    className={cn("h-5 w-5", trend.color)}
                                  />
                                  <span className={cn("text-xs font-medium", trend.color)}>
                                    {trend.label}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {result.reference_range && (
                            <div>
                              <p className="text-xs text-stone-600 mb-1">
                                Reference Range
                              </p>
                              <p className="text-sm text-stone-900">
                                {result.reference_range.low || "—"} -{" "}
                                {result.reference_range.high || "—"}{" "}
                                {result.reference_range.unit}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Result Notes */}
                        {result.result_notes && (
                          <div className="mb-3">
                            <p className="text-xs text-stone-600 mb-1">Notes</p>
                            <p className="text-sm text-stone-900">
                              {result.result_notes}
                            </p>
                          </div>
                        )}

                        {/* Metadata */}
                        <div className="flex items-center justify-between pt-3 border-t border-stone-200">
                          <div className="flex items-center gap-4 text-xs text-stone-600">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {format(new Date(result.result_date), "MMM dd, yyyy HH:mm")}
                            </span>
                            {result.performed_by && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {result.performed_by.first_name}{" "}
                                {result.performed_by.last_name}
                              </span>
                            )}
                          </div>

                          {/* Verification */}
                          <div className="flex items-center gap-2">
                            {result.verified ? (
                              <Badge variant="outline" className="gap-1 text-emerald-700">
                                <Check className="h-3 w-3" />
                                Verified
                                {result.verified_by && (
                                  <span className="ml-1">
                                    by {result.verified_by.first_name}{" "}
                                    {result.verified_by.last_name}
                                  </span>
                                )}
                              </Badge>
                            ) : allowVerification ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleVerifyClick(result)}
                              >
                                Verify Result
                              </Button>
                            ) : (
                              <Badge variant="outline" className="text-amber-700">
                                Pending Verification
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Verification Dialog */}
      <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify Lab Result</DialogTitle>
            <DialogDescription>
              You are about to verify the result for{" "}
              {selectedResult?.order_test?.test?.name}. This action confirms the
              accuracy and validity of the result.
            </DialogDescription>
          </DialogHeader>

          {selectedResult && (
            <div className="py-4 space-y-4">
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-stone-600">Test</p>
                    <p className="font-semibold text-stone-900">
                      {selectedResult.order_test?.test?.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-stone-600">Result</p>
                    <p className="font-semibold text-stone-900">
                      {selectedResult.value} {selectedResult.unit}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="verification_notes">Verification Notes (Optional)</Label>
                <Textarea
                  id="verification_notes"
                  placeholder="Add any notes about the verification..."
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  className="min-h-[100px]"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVerifyDialogOpen(false)}
              disabled={verifyResult.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleVerifySubmit}
              disabled={verifyResult.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {verifyResult.isPending ? (
                "Verifying..."
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Verify Result
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LabResultViewer;
