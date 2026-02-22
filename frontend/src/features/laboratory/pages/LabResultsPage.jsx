import Search from 'lucide-react/dist/esm/icons/search.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import VirtualizedList from '@/components/ui/VirtualizedList';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/dashboard";

import format from "date-fns/format";
import { useAuth } from "@/lib/auth";
import {
  useLabResults,
  useLabInterpretation,
  useVerifyLabResult,
  useBulkVerifyLabResults,
} from "@/features/laboratory/hooks";
import { toast } from "sonner";

/**
 * LabResultsPage - Lab results grouped by order with patient context
 *
 * Features:
 * - Results grouped by order (panel-centric view)
 * - Patient info and ordering provider visible
 * - Batch verification by order
 * - Individual result verification
 * - Filter by verification status, critical values
 */
export default function LabResultsPage() {
  const { user } = useAuth();
  const userRole = user?.role || "";

  // Can verify results
  const canVerify = ["admin", "lab_technician", "doctor", "physician"].includes(
    userRole
  );

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [verificationFilter, setVerificationFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");
  const [expandedOrders, setExpandedOrders] = useState(new Set());

  // Verify dialog state
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyMode, setVerifyMode] = useState("single"); // 'single' or 'order'
  const [selectedResult, setSelectedResult] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectedResultIds, setSelectedResultIds] = useState([]);
  const [verificationNotes, setVerificationNotes] = useState("");

  // AI interpretation dialog state
  const [interpretDialogOpen, setInterpretDialogOpen] = useState(false);
  const [interpretAudience, setInterpretAudience] = useState("clinician");
  const [interpretContext, setInterpretContext] = useState(null);

  // Build query filters
  const queryFilters = useMemo(() => {
    const filters = {};

    if (verificationFilter !== "all") {
      filters.is_verified = verificationFilter === "verified";
    }

    if (activeTab === "critical") {
      filters.critical_only = true;
    }

    return filters;
  }, [verificationFilter, activeTab]);

  // Fetch results
  const { data: resultsData, isLoading, refetch } = useLabResults(queryFilters);

  // Mutations
  const verifyMutation = useVerifyLabResult();
  const bulkVerifyMutation = useBulkVerifyLabResults();

  const interpretationResultId =
    interpretContext?.mode === "result" ? interpretContext.sourceId : null;
  const interpretationOrderId =
    interpretContext?.mode === "order" ? interpretContext.sourceId : null;

  const clinicianInterpretation = useLabInterpretation({
    resultId: interpretationResultId,
    orderId: interpretationOrderId,
    audience: "clinician",
    enabled: interpretDialogOpen && Boolean(interpretContext) && interpretAudience === "clinician",
  });

  const patientInterpretation = useLabInterpretation({
    resultId: interpretationResultId,
    orderId: interpretationOrderId,
    audience: "patient",
    enabled: interpretDialogOpen && Boolean(interpretContext) && interpretAudience === "patient",
  });

  // Process results data
  const results = useMemo(() => {
    const data = resultsData?.results || resultsData || [];
    return Array.isArray(data) ? data : [];
  }, [resultsData]);

  // Group results by order
  const groupedResults = useMemo(() => {
    const groups = {};

    results.forEach((result) => {
      // Use order_id if available, otherwise fall back to order_number
      const groupKey = result.order_id || result.order_number;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          order_id: result.order_id,
          order_number: result.order_number,
          patient_name: result.patient_name,
          patient_mrn: result.patient_mrn,
          patient_id: result.patient_id,
          ordering_provider: result.ordering_provider,
          results: [],
          panels: new Set(),
          performed_at: result.performed_at,
          hasUnverified: false,
          hasCritical: false,
          // Use order_number as fallback key for React
          _key: result.order_id || result.order_number,
        };
      }

      groups[groupKey].results.push(result);

      if (result.panel_name) {
        groups[groupKey].panels.add(result.panel_name);
      }

      if (!result.is_verified) {
        groups[groupKey].hasUnverified = true;
      }

      if (["critical_low", "critical_high"].includes(result.flag)) {
        groups[groupKey].hasCritical = true;
      }
    });

    // Convert to array and sort by performed_at descending
    return Object.values(groups).sort(
      (a, b) => new Date(b.performed_at) - new Date(a.performed_at)
    );
  }, [results]);

  // Client-side search filtering
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedResults;

    const query = searchQuery.toLowerCase();
    return groupedResults.filter((group) => {
      return (
        group.order_number?.toLowerCase().includes(query) ||
        group.patient_name?.toLowerCase().includes(query) ||
        group.patient_mrn?.toLowerCase().includes(query) ||
        group.results.some((r) => r.test_name?.toLowerCase().includes(query))
      );
    });
  }, [groupedResults, searchQuery]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = results.length;
    const verified = results.filter((r) => r.is_verified).length;
    const pending = total - verified;
    const critical = results.filter((r) =>
      ["critical_low", "critical_high"].includes(r.flag)
    ).length;
    const orders = groupedResults.length;

    return { total, verified, pending, critical, orders };
  }, [results, groupedResults]);

  const activeInterpretation =
    interpretAudience === "patient" ? patientInterpretation : clinicianInterpretation;

  const interpretationPayload = activeInterpretation.data?.result || null;
  const interpretationConfidenceBand =
    activeInterpretation.data?.confidence_band || "needs_review";
  const interpretationConfidence =
    typeof activeInterpretation.data?.confidence === "number"
      ? Math.round(activeInterpretation.data.confidence * 100)
      : null;

  const interpretationResultItems = useMemo(() => {
    if (!interpretationPayload) return [];
    if (interpretationPayload.mode === "order") {
      return interpretationPayload.results || [];
    }
    if (interpretationPayload.result) {
      return [interpretationPayload.result];
    }
    return [];
  }, [interpretationPayload]);

  const interpretationSuggestedChecks = useMemo(() => {
    if (!interpretationPayload) return [];
    if (Array.isArray(interpretationPayload.suggested_next_checks)) {
      return interpretationPayload.suggested_next_checks;
    }
    if (Array.isArray(interpretationPayload.result?.suggested_next_checks)) {
      return interpretationPayload.result.suggested_next_checks;
    }
    return [];
  }, [interpretationPayload]);

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy h:mm a");
    } catch {
      return "-";
    }
  };

  // Get flag styling
  const getFlagConfig = (flag) => {
    const configs = {
      normal: { label: "Normal", className: "text-emerald-600", icon: null },
      low: { label: "Low", className: "text-amber-600", icon: TrendingDown },
      high: { label: "High", className: "text-amber-600", icon: TrendingUp },
      critical_low: {
        label: "Critical Low",
        className: "text-rose-600 font-semibold",
        icon: AlertTriangle,
      },
      critical_high: {
        label: "Critical High",
        className: "text-rose-600 font-semibold",
        icon: AlertTriangle,
      },
      abnormal: {
        label: "Abnormal",
        className: "text-amber-600",
        icon: AlertTriangle,
      },
    };
    return configs[flag] || configs.normal;
  };

  const getConfidenceConfig = (band) => {
    const configs = {
      normal: {
        label: "Normal",
        className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      },
      advisory: {
        label: "Advisory",
        className: "bg-amber-50 text-amber-700 border-amber-200",
      },
      needs_review: {
        label: "Needs Review",
        className: "bg-rose-50 text-rose-700 border-rose-200",
      },
      fallback: {
        label: "Fallback",
        className: "bg-rose-50 text-rose-700 border-rose-200",
      },
    };
    return configs[band] || configs.needs_review;
  };

  // Toggle order expansion
  const toggleOrderExpansion = (orderId) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const openResultInterpretation = (result, group) => {
    setInterpretAudience("clinician");
    setInterpretContext({
      mode: "result",
      sourceId: result.id,
      testName: result.test_name,
      orderNumber: group.order_number,
      patientName: group.patient_name,
    });
    setInterpretDialogOpen(true);
  };

  const openOrderInterpretation = (group) => {
    if (!group.order_id) {
      toast.error("Order interpretation requires an order ID.");
      return;
    }

    setInterpretAudience("clinician");
    setInterpretContext({
      mode: "order",
      sourceId: group.order_id,
      orderNumber: group.order_number,
      patientName: group.patient_name,
      resultCount: group.results.length,
    });
    setInterpretDialogOpen(true);
  };

  // Handle single result verify click
  const handleVerifyClick = (result) => {
    setVerifyMode("single");
    setSelectedResult(result);
    setSelectedOrderId(null);
    setVerificationNotes("");
    setVerifyDialogOpen(true);
  };

  // Handle batch verify for order
  const handleBatchVerifyClick = (group) => {
    setVerifyMode("order");
    setSelectedResult(null);
    // Store the group for batch verification
    setSelectedOrderId(group.order_id);
    // Store result IDs as fallback when order_id is not available
    setSelectedResultIds(group.results.filter(r => !r.is_verified).map(r => r.id));
    setVerificationNotes("");
    setVerifyDialogOpen(true);
  };

  // Handle verify submit
  const handleVerifySubmit = async () => {
    try {
      if (verifyMode === "single" && selectedResult) {
        await verifyMutation.mutateAsync({
          id: selectedResult.id,
          verificationNotes: verificationNotes.trim() || undefined,
        });
        toast.success("Result verified successfully");
      } else if (verifyMode === "order") {
        // Use order_id if available, otherwise fall back to result_ids
        const payload = selectedOrderId
          ? { order_id: selectedOrderId }
          : { result_ids: selectedResultIds };

        if (verificationNotes.trim()) {
          payload.verification_notes = verificationNotes.trim();
        }

        const response = await bulkVerifyMutation.mutateAsync(payload);
        toast.success(response.message || "Results verified successfully");
      }

      setVerifyDialogOpen(false);
      setSelectedResult(null);
      setSelectedOrderId(null);
      setSelectedResultIds([]);
      setVerificationNotes("");
    } catch (err) {
      console.error("Failed to verify result:", err);
      toast.error(err.message || "Failed to verify result");
    }
  };

  // Handle clear filters
  const handleClearFilters = () => {
    setSearchQuery("");
    setVerificationFilter("all");
  };

  const hasActiveFilters = searchQuery || verificationFilter !== "all";

  // Filter options
  const verificationOptions = [
    { value: "all", label: "All Results" },
    { value: "verified", label: "Verified" },
    { value: "pending", label: "Pending Verification" },
  ];

  const isSubmitting = verifyMutation.isPending || bulkVerifyMutation.isPending;

  return (
    <PageShell>
      <PageHeader
        title="Lab Results"
        description={(
          <span>
            {stats.orders} orders · {stats.total} results
            {stats.critical > 0 && (
              <span className="text-rose-600 ml-2">
                ({stats.critical} critical)
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-4 sm:mt-6">
          <StatCard
            title="Total Results"
            value={stats.total}
            icon={TestTube2}
            color="sky"
          />
          <StatCard
            title="Verified"
            value={stats.verified}
            icon={CheckCircle2}
            color="emerald"
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={Clock}
            color="amber"
          />
          <StatCard
            title="Critical"
            value={stats.critical}
            icon={AlertTriangle}
            color="rose"
          />
        </div>
      </PageHeader>

      {/* Tabs */}
      <div className="bg-card/50 border-b border-border px-4 sm:px-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-transparent border-none h-auto p-0 gap-0">
            <TabsTrigger
              value="all"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-sky-500 data-[state=active]:bg-transparent px-4 py-3"
            >
              All Results
            </TabsTrigger>
            <TabsTrigger
              value="critical"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-rose-500 data-[state=active]:bg-transparent px-4 py-3"
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Critical / Needs Review
              {stats.critical > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 px-1.5">
                  {stats.critical}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Filter Bar */}
      <div className="bg-card/50 border-b border-border px-4 sm:px-6 py-3">
        <div className="flex flex-col gap-3">
          {/* Search row */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by patient name, MRN, order number, or test..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 font-mono text-sm"
            />
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Verification filter */}
            <Select
              value={verificationFilter}
              onValueChange={setVerificationFilter}
            >
              <SelectTrigger className="w-[160px] sm:w-[180px] text-sm">
                <SelectValue placeholder="Verification" />
              </SelectTrigger>
              <SelectContent>
                {verificationOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Clear filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="text-muted-foreground ml-auto"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="p-4 sm:p-6 space-y-4">
        {isLoading ? (
          // Loading skeleton
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20 ml-auto" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, j) => (
                      <Skeleton key={j} className="h-10 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <TestTube2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-display text-lg text-foreground mb-2">
              No results found
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {searchQuery || verificationFilter !== "all"
                ? "Try adjusting your filters to see more results."
                : activeTab === "critical"
                ? "No critical results require attention."
                : "No lab results have been entered yet."}
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
          <VirtualizedList
            items={filteredGroups}
            estimateSize={260}
            gap={16}
            getItemKey={(group) => group._key}
            renderItem={(group, groupIndex) => {
              const isExpanded = expandedOrders.has(group._key);
              const unverifiedCount = group.results.filter(
                (r) => !r.is_verified
              ).length;
              const panelNames = Array.from(group.panels);

              return (
                <Card
                  className={cn(
                    "animate-chronicle-enter overflow-hidden",
                    group.hasCritical && "border-rose-200 bg-rose-50/30"
                  )}
                  style={{ animationDelay: `${groupIndex * 50}ms` }}
                >
                  {/* Order Header */}
                  <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      {/* Patient & Order Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Link
                            to={`/patients/${group.patient_id}/chronicle`}
                            className="font-display text-lg text-foreground hover:text-sky-600 transition-colors truncate"
                          >
                            {group.patient_name || "Unknown Patient"}
                          </Link>
                          {group.hasCritical && (
                            <Badge
                              variant="outline"
                              className="bg-rose-100 text-rose-700 border-rose-300"
                            >
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Critical
                            </Badge>
                          )}
                          {unverifiedCount === 0 && group.results.length > 0 && (
                            <Badge
                              variant="outline"
                              className="bg-emerald-100 text-emerald-700 border-emerald-300"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Verified
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1 font-mono">
                            <User className="h-3 w-3" />
                            {group.patient_mrn || "No MRN"}
                          </span>
                          <span className="font-mono text-xs">
                            Order: {group.order_number}
                          </span>
                          {group.ordering_provider && (
                            <span className="flex items-center gap-1">
                              <Stethoscope className="h-3 w-3" />
                              {group.ordering_provider}
                            </span>
                          )}
                        </div>
                        {panelNames.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {panelNames.map((panel) => (
                              <Badge
                                key={panel}
                                variant="outline"
                                className="bg-sky-50 text-sky-700 border-sky-200 text-xs"
                              >
                                <Package className="h-3 w-3 mr-1" />
                                {panel}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openOrderInterpretation(group)}
                          disabled={!group.order_id}
                          className="text-xs"
                        >
                          <Sparkles className="h-3 w-3 mr-1" />
                          Interpret Order
                        </Button>
                        {canVerify && unverifiedCount > 0 && (
                          <Button
                            size="sm"
                            onClick={() => handleBatchVerifyClick(group)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Verify All ({unverifiedCount})
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleOrderExpansion(group._key)}
                          className="text-muted-foreground"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                          <span className="ml-1 text-xs">
                            {group.results.length} tests
                          </span>
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  {/* Results Table */}
                  {isExpanded && (
                    <CardContent className="pt-0">
                      <div className="border border-border rounded-lg overflow-hidden">
                        <table className="w-full">
                          <thead className="bg-muted/50">
                            <tr className="text-xs font-mono uppercase text-muted-foreground">
                              <th className="text-left px-4 py-2">Test</th>
                              <th className="text-left px-4 py-2">Result</th>
                              <th className="text-left px-4 py-2">Reference</th>
                              <th className="text-left px-4 py-2">Flag</th>
                              <th className="text-left px-4 py-2">Status</th>
                              <th className="text-right px-4 py-2">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {group.results.map((result) => {
                              const flagConfig = getFlagConfig(result.flag);
                              const FlagIcon = flagConfig.icon;

                              return (
                                <tr
                                  key={result.id}
                                  className={cn(
                                    "text-sm",
                                    [
                                      "critical_low",
                                      "critical_high",
                                    ].includes(result.flag) &&
                                      "bg-rose-50/50 dark:bg-rose-900/10"
                                  )}
                                >
                                  <td className="px-4 py-2.5">
                                    <span className="font-medium">
                                      {result.test_name}
                                    </span>
                                    {result.test_code && (
                                      <span className="text-xs text-muted-foreground ml-2">
                                        ({result.test_code})
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      {FlagIcon && (
                                        <FlagIcon
                                          className={cn(
                                            "h-4 w-4",
                                            flagConfig.className
                                          )}
                                        />
                                      )}
                                      <span
                                        className={cn(
                                          "font-mono",
                                          flagConfig.className
                                        )}
                                      >
                                        {result.value} {result.unit}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {result.reference_low || "-"} -{" "}
                                      {result.reference_high || "-"}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span
                                      className={cn(
                                        "text-xs",
                                        flagConfig.className
                                      )}
                                    >
                                      {flagConfig.label}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {result.is_verified ? (
                                      <Badge
                                        variant="outline"
                                        className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs"
                                      >
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                        Verified
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
                                      >
                                        <Clock className="h-3 w-3 mr-1" />
                                        Pending
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openResultInterpretation(result, group)}
                                        className="text-xs h-7"
                                      >
                                        <Sparkles className="h-3 w-3 mr-1" />
                                        Interpret
                                      </Button>
                                      {canVerify && !result.is_verified && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleVerifyClick(result)}
                                          className="text-xs h-7"
                                        >
                                          <CheckCircle2 className="h-3 w-3 mr-1" />
                                          Verify
                                        </Button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex justify-end mt-2 text-xs text-muted-foreground">
                        {formatDate(group.performed_at)}
                      </div>
                    </CardContent>
                  )}

                  {/* Collapsed Summary */}
                  {!isExpanded && (
                    <CardContent className="pt-0">
                      <div className="flex flex-wrap gap-2">
                        {group.results.slice(0, 6).map((result) => {
                          return (
                            <Badge
                              key={result.id}
                              variant="outline"
                              className={cn(
                                "text-xs",
                                result.flag === "normal"
                                  ? "bg-stone-50 border-stone-200"
                                  : result.flag?.includes("critical")
                                  ? "bg-rose-50 border-rose-200 text-rose-700"
                                  : "bg-amber-50 border-amber-200 text-amber-700"
                              )}
                            >
                              {result.test_name}:{" "}
                              <span className="font-mono ml-1">
                                {result.value}
                              </span>
                            </Badge>
                          );
                        })}
                        {group.results.length > 6 && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-stone-50 border-stone-200"
                          >
                            +{group.results.length - 6} more
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            }}
          />
        )}
      </main>

      <Dialog
        open={interpretDialogOpen}
        onOpenChange={(nextOpen) => {
          setInterpretDialogOpen(nextOpen);
          if (!nextOpen) {
            setInterpretAudience("clinician");
            setInterpretContext(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-600" />
              AI Lab Interpretation
            </DialogTitle>
            <DialogDescription>
              Advisory output only. Clinical review is required before treatment
              or ordering decisions.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {interpretContext?.patientName && (
                <Badge variant="outline" className="text-xs">
                  {interpretContext.patientName}
                </Badge>
              )}
              {interpretContext?.orderNumber && (
                <Badge variant="outline" className="text-xs font-mono">
                  {interpretContext.orderNumber}
                </Badge>
              )}
              {interpretContext?.testName && (
                <Badge variant="outline" className="text-xs">
                  {interpretContext.testName}
                </Badge>
              )}
            </div>

            <Tabs value={interpretAudience} onValueChange={setInterpretAudience}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="clinician">Clinician View</TabsTrigger>
                <TabsTrigger value="patient">Patient View</TabsTrigger>
              </TabsList>
            </Tabs>

            {activeInterpretation.isLoading && (
              <div className="space-y-2 pt-2">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}

            {activeInterpretation.isError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="text-sm text-rose-700">
                  {activeInterpretation.error?.message || "Failed to load interpretation."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => activeInterpretation.refetch()}
                  className="mt-2"
                >
                  Retry
                </Button>
              </div>
            )}

            {!activeInterpretation.isLoading &&
              !activeInterpretation.isError &&
              interpretationPayload && (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn("text-xs", getConfidenceConfig(interpretationConfidenceBand).className)}
                    >
                      {getConfidenceConfig(interpretationConfidenceBand).label}
                    </Badge>
                    {interpretationConfidence !== null && (
                      <Badge variant="outline" className="text-xs font-mono">
                        Confidence {interpretationConfidence}%
                      </Badge>
                    )}
                    {activeInterpretation.data?.requires_human_review && (
                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                        Human Review Required
                      </Badge>
                    )}
                  </div>

                  <p className="text-sm leading-relaxed text-foreground">
                    {interpretationPayload.summary || "No summary available."}
                  </p>

                  {interpretationSuggestedChecks.length > 0 && (
                    <div className="rounded-lg border bg-background p-3">
                      <h4 className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-2">
                        Suggested Next Checks
                      </h4>
                      <ul className="space-y-1">
                        {interpretationSuggestedChecks.slice(0, 4).map((item) => (
                          <li key={item} className="text-sm text-foreground">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {interpretationResultItems.length > 0 && (
                    <div className="rounded-lg border bg-background p-3">
                      <h4 className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-2">
                        Result Breakdown
                      </h4>
                      <div className="space-y-2">
                        {interpretationResultItems.slice(0, 6).map((item) => (
                          <div
                            key={item.result_id || `${item.test_code}:${item.performed_at}`}
                            className="rounded-md border border-border/70 p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {item.test_name}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {item.flag}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.summary}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(activeInterpretation.data?.citations || []).length > 0 && (
                    <div className="rounded-lg border bg-background p-3">
                      <h4 className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-2">
                        Evidence
                      </h4>
                      <div className="space-y-1">
                        {(activeInterpretation.data?.citations || []).slice(0, 3).map((citation) => (
                          <div
                            key={`${citation.source}:${citation.result_id}:${citation.field}`}
                            className="text-xs text-muted-foreground"
                          >
                            {citation.test_name}: {citation.value}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setInterpretDialogOpen(false);
                setInterpretAudience("clinician");
                setInterpretContext(null);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verify Dialog */}
      <AlertDialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">
              {verifyMode === "order"
                ? "Verify All Results"
                : "Verify Lab Result"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {verifyMode === "order"
                ? "Confirm that you have reviewed all results for this order and they are accurate."
                : "Confirm that you have reviewed this result and it is accurate."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {verifyMode === "single" && selectedResult && (
            <div className="bg-muted/50 rounded-lg p-4 my-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Test:</span>
                <span className="font-medium">{selectedResult.test_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Result:</span>
                <span className="font-mono">
                  {selectedResult.value} {selectedResult.unit}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Flag:</span>
                <span className={getFlagConfig(selectedResult.flag).className}>
                  {selectedResult.flag_display || selectedResult.flag}
                </span>
              </div>
            </div>
          )}

          {verifyMode === "order" && (
            <div className="bg-muted/50 rounded-lg p-4 my-4">
              <p className="text-sm text-muted-foreground">
                This will verify all pending results for this order.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="verify-notes" className="text-sm font-medium">
              Verification Notes (Optional)
            </Label>
            <Textarea
              id="verify-notes"
              placeholder="Add any notes about this verification..."
              value={verificationNotes}
              onChange={(e) => setVerificationNotes(e.target.value)}
              className="min-h-[80px] resize-none"
            />
          </div>

          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVerifySubmit}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {verifyMode === "order" ? "Verify All" : "Verify Result"}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
