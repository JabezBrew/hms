/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
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
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import { useCallback, useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

import format from "date-fns/format";
import { useAuth } from "@/lib/auth";
import {
  usePaginatedLabResults,
  useLabInterpretation,
  useVerifyLabResult,
  useBulkVerifyLabResults,
} from "@/features/laboratory/hooks";
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { toast } from "sonner";

const RESULTS_PAGE_SIZE = 100;

const RESULT_VERIFICATION_OPTIONS = [
  { value: "all", label: "All Results" },
  { value: "verified", label: "Verified" },
  { value: "pending", label: "Pending Verification" },
];

function isCriticalLabFlag(flag) {
  return ["critical_low", "critical_high"].includes(flag);
}

function formatLabResultDate(dateString) {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "MMM d, yyyy h:mm a");
  } catch {
    return "-";
  }
}

function getLabResultFlagConfig(flag) {
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
}

function getInterpretationConfidenceConfig(band) {
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
}

function useGroupedLabResults(results) {
  return useMemo(() => {
    const groups = {};

    results.forEach((result) => {
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

      if (isCriticalLabFlag(result.flag)) {
        groups[groupKey].hasCritical = true;
      }
    });

    return Object.values(groups).sort(
      (a, b) => new Date(b.performed_at) - new Date(a.performed_at)
    );
  }, [results]);
}

function useLabResultsStats(results, groupedResults, totalCount) {
  return useMemo(() => {
    const total = totalCount;
    const visible = results.length;
    const verified = results.filter((result) => result.is_verified).length;
    const pending = visible - verified;
    const critical = results.filter((result) => isCriticalLabFlag(result.flag)).length;
    const orders = groupedResults.length;

    return { total, visible, verified, pending, critical, orders };
  }, [results, groupedResults, totalCount]);
}

function useLabResultsMetrics(stats) {
  return useMemo(() => ([
    { label: "Total Results", value: stats.total, icon: TestTube2, color: "sky" },
    { label: "Visible", value: stats.visible, icon: CheckCircle2, color: "emerald" },
    { label: "Pending Page", value: stats.pending, icon: Clock, color: "amber", accentValue: stats.pending > 0 },
    { label: "Critical Page", value: stats.critical, icon: AlertTriangle, color: "rose", accentValue: stats.critical > 0 },
  ]), [stats]);
}

function useInterpretationDetails(activeInterpretation) {
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

  return {
    interpretationConfidence,
    interpretationConfidenceBand,
    interpretationPayload,
    interpretationResultItems,
    interpretationSuggestedChecks,
  };
}

function useLabResultVerification({ bulkVerifyMutation, verifyMutation }) {
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyMode, setVerifyMode] = useState("single");
  const [selectedResult, setSelectedResult] = useState(null);
  const selectedOrderIdRef = useRef(null);
  const selectedResultIdsRef = useRef([]);
  const [verificationNotes, setVerificationNotes] = useState("");

  const handleVerifyClick = useCallback((result) => {
    setVerifyMode("single");
    setSelectedResult(result);
    selectedOrderIdRef.current = null;
    setVerificationNotes("");
    setVerifyDialogOpen(true);
  }, []);

  const handleBatchVerifyClick = useCallback((group) => {
    setVerifyMode("order");
    setSelectedResult(null);
    selectedOrderIdRef.current = group.order_id;
    selectedResultIdsRef.current = group.results.reduce((resultIds, result) => {
      if (!result.is_verified) {
        resultIds.push(result.id);
      }
      return resultIds;
    }, []);
    setVerificationNotes("");
    setVerifyDialogOpen(true);
  }, []);

  const handleVerifySubmit = useCallback(async () => {
    try {
      if (verifyMode === "single" && selectedResult) {
        await verifyMutation.mutateAsync({
          id: selectedResult.id,
          verificationNotes: verificationNotes.trim() || undefined,
        });
        toast.success("Result verified successfully");
      } else if (verifyMode === "order") {
        const selectedOrderId = selectedOrderIdRef.current;
        const payload = selectedOrderId
          ? { order_id: selectedOrderId }
          : { result_ids: selectedResultIdsRef.current };

        if (verificationNotes.trim()) {
          payload.verification_notes = verificationNotes.trim();
        }

        const response = await bulkVerifyMutation.mutateAsync(payload);
        toast.success(response.message || "Results verified successfully");
      }

      setVerifyDialogOpen(false);
      setSelectedResult(null);
      selectedOrderIdRef.current = null;
      selectedResultIdsRef.current = [];
      setVerificationNotes("");
    } catch (err) {
      console.error("Failed to verify result:", err);
      toast.error(err.message || "Failed to verify result");
    }
  }, [bulkVerifyMutation, selectedResult, verificationNotes, verifyMode, verifyMutation]);

  return {
    handleBatchVerifyClick,
    handleVerifyClick,
    handleVerifySubmit,
    isSubmitting: verifyMutation.isPending || bulkVerifyMutation.isPending,
    selectedResult,
    setVerificationNotes,
    setVerifyDialogOpen,
    verificationNotes,
    verifyDialogOpen,
    verifyMode,
  };
}

function createResultGroupColumns({
  aiInterpretationAvailable,
  canVerify,
  expandedOrders,
  onBatchVerify,
  onOrderInterpretation,
  onToggleOrderExpansion,
}) {
  return [
    {
      key: "patient",
      header: "Patient",
      width: "240px",
      render: (group) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{group.patient_name || "Unknown Patient"}</p>
          <p className="font-mono text-xs text-muted-foreground">MRN: {group.patient_mrn || "No MRN"}</p>
        </div>
      ),
    },
    {
      key: "order",
      header: "Order",
      width: "180px",
      render: (group) => (
        <span className="font-mono text-sm font-medium text-primary">{group.order_number}</span>
      ),
    },
    {
      key: "provider",
      header: "Ordering Provider",
      width: "200px",
      render: (group) => (
        <span className="truncate text-sm text-muted-foreground">
          {group.ordering_provider || "Unknown"}
        </span>
      ),
    },
    {
      key: "panels",
      header: "Panels",
      width: "220px",
      render: (group) => <LabResultPanelBadges panels={group.panels} />,
    },
    {
      key: "summary",
      header: "Summary",
      width: "160px",
      render: (group) => {
        const unverifiedCount = group.results.filter((result) => !result.is_verified).length;
        return (
          <div className="space-y-1">
            <p className="text-sm text-foreground">{group.results.length} tests</p>
            <p className="text-xs text-muted-foreground">
              {unverifiedCount > 0 ? `${unverifiedCount} pending` : "All verified"}
            </p>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: "140px",
      render: (group) => <LabResultGroupStatus group={group} />,
    },
    {
      key: "performed",
      header: "Performed",
      width: "180px",
      render: (group) => (
        <span className="font-mono text-sm text-muted-foreground">
          {formatLabResultDate(group.performed_at)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "240px",
      render: (group) => (
        <LabResultGroupActions
          aiInterpretationAvailable={aiInterpretationAvailable}
          canVerify={canVerify}
          expandedOrders={expandedOrders}
          group={group}
          onBatchVerify={onBatchVerify}
          onOrderInterpretation={onOrderInterpretation}
          onToggleOrderExpansion={onToggleOrderExpansion}
        />
      ),
    },
  ];
}

function LabResultPanelBadges({ panels }) {
  const panelNames = Array.from(panels);
  if (!panelNames.length) {
    return <span className="text-sm text-muted-foreground">No panels</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {panelNames.slice(0, 2).map((panel) => (
        <Badge key={panel} variant="outline" className="border-sky-200 bg-sky-50 text-sky-700 text-xs">
          {panel}
        </Badge>
      ))}
      {panelNames.length > 2 ? (
        <Badge variant="outline" className="text-xs">
          +{panelNames.length - 2}
        </Badge>
      ) : null}
    </div>
  );
}

function LabResultGroupStatus({ group }) {
  const unverifiedCount = group.results.filter((result) => !result.is_verified).length;
  if (group.hasCritical) {
    return (
      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700 text-xs">
        Critical
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={unverifiedCount === 0
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 text-xs"
        : "border-amber-200 bg-amber-50 text-amber-700 text-xs"}
    >
      {unverifiedCount === 0 ? "Verified" : "Pending"}
    </Badge>
  );
}

function LabResultGroupActions({
  aiInterpretationAvailable,
  canVerify,
  expandedOrders,
  group,
  onBatchVerify,
  onOrderInterpretation,
  onToggleOrderExpansion,
}) {
  const unverifiedCount = group.results.filter((result) => !result.is_verified).length;

  return (
    <div className="flex items-center justify-end gap-2">
      {aiInterpretationAvailable ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            onOrderInterpretation(group);
          }}
        >
          <Sparkles className="mr-1 size-3" />
          Interpret
        </Button>
      ) : null}
      {canVerify && unverifiedCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            onBatchVerify(group);
          }}
        >
          Verify All
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={(event) => {
          event.stopPropagation();
          onToggleOrderExpansion(group._key);
        }}
      >
        {expandedOrders.has(group._key) ? "Hide" : "Details"}
      </Button>
    </div>
  );
}

function LabResultsHeader({ isFetching, metrics, onRefresh, stats }) {
  return (
    <PageHeader
      title="Lab Results"
      description={(
        <span>
          {stats.total} matching results
          <span className="ml-2 text-muted-foreground">
            ({stats.orders} orders on this page)
          </span>
          {stats.critical > 0 ? (
            <span className="text-rose-600 ml-2">
              ({stats.critical} critical on this page)
            </span>
          ) : null}
        </span>
      )}
      actions={(
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          className="flex items-center gap-2"
          disabled={isFetching}
        >
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      )}
    >
      <LabMetricGrid metrics={metrics} className="mt-4 sm:mt-6" />
    </PageHeader>
  );
}

function LabResultsTabs({ activeTab, onTabChange, stats }) {
  return (
    <LabToolbar className="py-3">
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList className="h-auto bg-muted/50 p-1">
          <TabsTrigger value="all" className="font-mono text-xs">
            All Results
          </TabsTrigger>
          <TabsTrigger value="critical" className="font-mono text-xs">
            <AlertTriangle className="size-4 mr-2" />
            Critical / Needs Review
            {stats.critical > 0 ? (
              <Badge variant="destructive" className="ml-2 h-5 px-1.5">
                {stats.critical}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </LabToolbar>
  );
}

function LabResultsFilters({
  hasActiveFilters,
  onClearFilters,
  onSearchChange,
  onVerificationFilterChange,
  searchQuery,
  verificationFilter,
}) {
  return (
    <LabToolbar>
      <div className="flex flex-col gap-3">
        <LabSearchField
          id="lab-results-search"
          placeholder="Search by patient name, MRN, order number, or test..."
          value={searchQuery}
          onChange={onSearchChange}
        />

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Select
            value={verificationFilter}
            onValueChange={onVerificationFilterChange}
          >
            <SelectTrigger className="w-full font-mono text-sm sm:w-[180px]">
              <SelectValue placeholder="Verification" />
            </SelectTrigger>
            <SelectContent>
              {RESULT_VERIFICATION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="ml-auto font-mono text-xs text-muted-foreground"
            >
              <X className="size-4 mr-1" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>
    </LabToolbar>
  );
}

function LabResultsContent({
  activeTab,
  aiInterpretationAvailable,
  canVerify,
  columns,
  expandedGroups,
  filteredGroups,
  hasActiveFilters,
  isLoading,
  onBatchVerify,
  onClearFilters,
  onOrderInterpretation,
  onResultInterpretation,
  onToggleOrderExpansion,
  onVerifyResult,
  searchQuery,
  verificationFilter,
}) {
  return (
    <main className="p-4 sm:p-6 space-y-4">
      {isLoading ? (
        <LabTableSkeleton rows={6} />
      ) : filteredGroups.length === 0 ? (
        <LabResultsEmptyState
          activeTab={activeTab}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={onClearFilters}
          searchQuery={searchQuery}
          verificationFilter={verificationFilter}
        />
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <VirtualizedTable
              rows={filteredGroups}
              rowKey={(group) => group._key}
              rowHeight={68}
              columns={columns}
              onRowClick={(group) => onToggleOrderExpansion(group._key)}
              rowClassName="hover:bg-muted/30"
              className={cn(labTableClassName, "min-w-[1480px]")}
              headerClassName={labTableHeaderClassName}
            />
          </div>

          <ExpandedResultGroups
            aiInterpretationAvailable={aiInterpretationAvailable}
            canVerify={canVerify}
            groups={expandedGroups}
            onBatchVerify={onBatchVerify}
            onOrderInterpretation={onOrderInterpretation}
            onResultInterpretation={onResultInterpretation}
            onToggleOrderExpansion={onToggleOrderExpansion}
            onVerifyResult={onVerifyResult}
          />
        </div>
      )}
    </main>
  );
}

function LabResultsEmptyState({
  activeTab,
  hasActiveFilters,
  onClearFilters,
  searchQuery,
  verificationFilter,
}) {
  return (
    <LabEmptyState
      icon={TestTube2}
      title="No results found"
      description={
        searchQuery || verificationFilter !== "all"
          ? "Try adjusting your filters to see more results."
          : activeTab === "critical"
            ? "No critical results require attention."
            : "No lab results have been entered yet."
      }
      action={hasActiveFilters ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onClearFilters}
          className="font-mono text-xs"
        >
          Clear Filters
        </Button>
      ) : null}
    />
  );
}

function ExpandedResultGroups({
  aiInterpretationAvailable,
  canVerify,
  groups,
  onBatchVerify,
  onOrderInterpretation,
  onResultInterpretation,
  onToggleOrderExpansion,
  onVerifyResult,
}) {
  return groups.map((group, groupIndex) => (
    <ExpandedResultGroupCard
      aiInterpretationAvailable={aiInterpretationAvailable}
      canVerify={canVerify}
      group={group}
      groupIndex={groupIndex}
      key={group._key}
      onBatchVerify={onBatchVerify}
      onOrderInterpretation={onOrderInterpretation}
      onResultInterpretation={onResultInterpretation}
      onToggleOrderExpansion={onToggleOrderExpansion}
      onVerifyResult={onVerifyResult}
    />
  ));
}

function ExpandedResultGroupCard({
  aiInterpretationAvailable,
  canVerify,
  group,
  groupIndex,
  onBatchVerify,
  onOrderInterpretation,
  onResultInterpretation,
  onToggleOrderExpansion,
  onVerifyResult,
}) {
  const unverifiedCount = group.results.filter((result) => !result.is_verified).length;
  const panelNames = Array.from(group.panels);

  return (
    <Card
      className={cn(
        "animate-chronicle-enter overflow-hidden",
        group.hasCritical && "border-rose-200 bg-rose-50/30"
      )}
      style={{ animationDelay: `${groupIndex * 40}ms` }}
    >
      <CardHeader className="pb-3">
        <ExpandedResultGroupHeader
          aiInterpretationAvailable={aiInterpretationAvailable}
          canVerify={canVerify}
          group={group}
          onBatchVerify={onBatchVerify}
          onOrderInterpretation={onOrderInterpretation}
          onToggleOrderExpansion={onToggleOrderExpansion}
          panelNames={panelNames}
          unverifiedCount={unverifiedCount}
        />
      </CardHeader>

      <CardContent className="pt-0">
        <ExpandedResultTable
          aiInterpretationAvailable={aiInterpretationAvailable}
          canVerify={canVerify}
          group={group}
          onResultInterpretation={onResultInterpretation}
          onVerifyResult={onVerifyResult}
        />
        <div className="mt-2 flex justify-end text-xs text-muted-foreground">
          {formatLabResultDate(group.performed_at)}
        </div>
      </CardContent>
    </Card>
  );
}

function ExpandedResultGroupHeader({
  aiInterpretationAvailable,
  canVerify,
  group,
  onBatchVerify,
  onOrderInterpretation,
  onToggleOrderExpansion,
  panelNames,
  unverifiedCount,
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1 min-w-0">
        <ExpandedResultPatientSummary group={group} panelNames={panelNames} unverifiedCount={unverifiedCount} />
      </div>

      <div className="flex items-center gap-2">
        {aiInterpretationAvailable ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOrderInterpretation(group)}
            disabled={!group.order_id}
            className="text-xs"
          >
            <Sparkles className="mr-1 size-3" />
            Interpret Order
          </Button>
        ) : null}
        {canVerify && unverifiedCount > 0 ? (
          <Button
            size="sm"
            onClick={() => onBatchVerify(group)}
            className="bg-emerald-600 text-xs text-white hover:bg-emerald-700"
          >
            <CheckCircle2 className="mr-1 size-3" />
            Verify All ({unverifiedCount})
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggleOrderExpansion(group._key)}
          className="text-muted-foreground"
        >
          <ChevronUp className="size-4" />
          <span className="ml-1 text-xs">Hide</span>
        </Button>
      </div>
    </div>
  );
}

function ExpandedResultPatientSummary({ group, panelNames, unverifiedCount }) {
  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Link
          to={`/patients/${group.patient_id}/chronicle`}
          className="truncate font-display text-lg text-foreground transition-colors hover:text-sky-600"
        >
          {group.patient_name || "Unknown Patient"}
        </Link>
        {group.hasCritical ? (
          <Badge variant="outline" className="border-rose-300 bg-rose-100 text-rose-700">
            <AlertTriangle className="mr-1 size-3" />
            Critical
          </Badge>
        ) : null}
        {unverifiedCount === 0 && group.results.length > 0 ? (
          <Badge variant="outline" className="border-emerald-300 bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="mr-1 size-3" />
            Verified
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1 font-mono">
          <User className="size-3" />
          {group.patient_mrn || "No MRN"}
        </span>
        <span className="font-mono text-xs">Order: {group.order_number}</span>
        {group.ordering_provider ? (
          <span className="flex items-center gap-1">
            <Stethoscope className="size-3" />
            {group.ordering_provider}
          </span>
        ) : null}
      </div>
      {panelNames.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {panelNames.map((panel) => (
            <Badge
              key={panel}
              variant="outline"
              className="border-sky-200 bg-sky-50 text-sky-700 text-xs"
            >
              <Package className="mr-1 size-3" />
              {panel}
            </Badge>
          ))}
        </div>
      ) : null}
    </>
  );
}

function ExpandedResultTable({
  aiInterpretationAvailable,
  canVerify,
  group,
  onResultInterpretation,
  onVerifyResult,
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr className="text-xs uppercase text-muted-foreground font-mono">
            <th className="px-4 py-2 text-left">Test</th>
            <th className="px-4 py-2 text-left">Result</th>
            <th className="px-4 py-2 text-left">Reference</th>
            <th className="px-4 py-2 text-left">Flag</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {group.results.map((result) => (
            <ExpandedResultRow
              aiInterpretationAvailable={aiInterpretationAvailable}
              canVerify={canVerify}
              group={group}
              key={result.id}
              onResultInterpretation={onResultInterpretation}
              onVerifyResult={onVerifyResult}
              result={result}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpandedResultRow({
  aiInterpretationAvailable,
  canVerify,
  group,
  onResultInterpretation,
  onVerifyResult,
  result,
}) {
  const flagConfig = getLabResultFlagConfig(result.flag);
  const FlagIcon = flagConfig.icon;

  return (
    <tr
      className={cn(
        "text-sm",
        isCriticalLabFlag(result.flag) && "bg-rose-50/50 dark:bg-rose-900/10"
      )}
    >
      <td className="px-4 py-2.5">
        <span className="font-medium">{result.test_name}</span>
        {result.test_code ? (
          <span className="ml-2 text-xs text-muted-foreground">
            ({result.test_code})
          </span>
        ) : null}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {FlagIcon ? <FlagIcon className={cn("size-4", flagConfig.className)} /> : null}
          <span className={cn("font-mono", flagConfig.className)}>
            {result.value} {result.unit}
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span className="font-mono text-xs text-muted-foreground">
          {result.reference_low || "-"} - {result.reference_high || "-"}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className={cn("text-xs", flagConfig.className)}>{flagConfig.label}</span>
      </td>
      <td className="px-4 py-2.5">
        <LabResultVerificationBadge isVerified={result.is_verified} />
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          {aiInterpretationAvailable ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onResultInterpretation(result, group)}
              className="h-7 text-xs"
            >
              <Sparkles className="mr-1 size-3" />
              Interpret
            </Button>
          ) : null}
          {canVerify && !result.is_verified ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onVerifyResult(result)}
              className="h-7 text-xs"
            >
              <CheckCircle2 className="mr-1 size-3" />
              Verify
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function LabResultVerificationBadge({ isVerified }) {
  if (isVerified) {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs">
        <CheckCircle2 className="mr-1 size-3" />
        Verified
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs">
      <Clock className="mr-1 size-3" />
      Pending
    </Badge>
  );
}

function LabResultsPagination({ onPageChange, page, totalCount }) {
  if (totalCount <= RESULTS_PAGE_SIZE) return null;

  return (
    <div className="px-4 sm:px-6 pb-6">
      <TablePagination
        currentPage={page}
        totalCount={totalCount}
        pageSize={RESULTS_PAGE_SIZE}
        onPageChange={onPageChange}
        itemLabel="results"
      />
    </div>
  );
}

function LabInterpretationDialog({
  activeInterpretation,
  interpretationConfidence,
  interpretationConfidenceBand,
  interpretationPayload,
  interpretationResultItems,
  interpretationSuggestedChecks,
  interpretAudience,
  interpretContext,
  interpretDialogOpen,
  onAudienceChange,
  onClose,
  onOpenChange,
}) {
  return (
    <Dialog open={interpretDialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Sparkles className="size-5 text-amber-600" />
            AI Lab Interpretation
          </DialogTitle>
          <DialogDescription>
            Advisory output only. Clinical review is required before treatment
            or ordering decisions.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <InterpretationContextBadges interpretContext={interpretContext} />

          <Tabs value={interpretAudience} onValueChange={onAudienceChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="clinician">Clinician View</TabsTrigger>
              <TabsTrigger value="patient">Patient View</TabsTrigger>
            </TabsList>
          </Tabs>

          <InterpretationBody
            activeInterpretation={activeInterpretation}
            interpretationConfidence={interpretationConfidence}
            interpretationConfidenceBand={interpretationConfidenceBand}
            interpretationPayload={interpretationPayload}
            interpretationResultItems={interpretationResultItems}
            interpretationSuggestedChecks={interpretationSuggestedChecks}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InterpretationContextBadges({ interpretContext }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {interpretContext?.patientName ? (
        <Badge variant="outline" className="text-xs">
          {interpretContext.patientName}
        </Badge>
      ) : null}
      {interpretContext?.orderNumber ? (
        <Badge variant="outline" className="text-xs font-mono">
          {interpretContext.orderNumber}
        </Badge>
      ) : null}
      {interpretContext?.testName ? (
        <Badge variant="outline" className="text-xs">
          {interpretContext.testName}
        </Badge>
      ) : null}
    </div>
  );
}

function InterpretationBody({
  activeInterpretation,
  interpretationConfidence,
  interpretationConfidenceBand,
  interpretationPayload,
  interpretationResultItems,
  interpretationSuggestedChecks,
}) {
  if (activeInterpretation.isLoading) {
    return (
      <div className="space-y-2 pt-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (activeInterpretation.isError) {
    return (
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
    );
  }

  if (!interpretationPayload) return null;

  return (
    <div className="space-y-3 pt-1">
      <InterpretationSummary
        activeInterpretation={activeInterpretation}
        interpretationConfidence={interpretationConfidence}
        interpretationConfidenceBand={interpretationConfidenceBand}
        interpretationPayload={interpretationPayload}
      />
      <InterpretationSuggestedChecks checks={interpretationSuggestedChecks} />
      <InterpretationResultBreakdown items={interpretationResultItems} />
      <InterpretationEvidence citations={activeInterpretation.data?.citations || []} />
    </div>
  );
}

function InterpretationSummary({
  activeInterpretation,
  interpretationConfidence,
  interpretationConfidenceBand,
  interpretationPayload,
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn("text-xs", getInterpretationConfidenceConfig(interpretationConfidenceBand).className)}
        >
          {getInterpretationConfidenceConfig(interpretationConfidenceBand).label}
        </Badge>
        {interpretationConfidence !== null ? (
          <Badge variant="outline" className="text-xs font-mono">
            Confidence {interpretationConfidence}%
          </Badge>
        ) : null}
        {activeInterpretation.data?.requires_human_review ? (
          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
            Human Review Required
          </Badge>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-foreground">
        {interpretationPayload.summary || "No summary available."}
      </p>
    </>
  );
}

function InterpretationSuggestedChecks({ checks }) {
  if (checks.length === 0) return null;

  return (
    <div className="rounded-lg border bg-background p-3">
      <h4 className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-2">
        Suggested Next Checks
      </h4>
      <ul className="space-y-1">
        {checks.slice(0, 4).map((item) => (
          <li key={item} className="text-sm text-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InterpretationResultBreakdown({ items }) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border bg-background p-3">
      <h4 className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-2">
        Result Breakdown
      </h4>
      <div className="space-y-2">
        {items.slice(0, 6).map((item) => (
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
  );
}

function InterpretationEvidence({ citations }) {
  if (citations.length === 0) return null;

  return (
    <div className="rounded-lg border bg-background p-3">
      <h4 className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-2">
        Evidence
      </h4>
      <div className="space-y-1">
        {citations.slice(0, 3).map((citation) => (
          <div
            key={`${citation.source}:${citation.result_id}:${citation.field}`}
            className="text-xs text-muted-foreground"
          >
            {citation.test_name}: {citation.value}
          </div>
        ))}
      </div>
    </div>
  );
}

function LabVerifyDialog({
  isSubmitting,
  onNotesChange,
  onOpenChange,
  onSubmit,
  selectedResult,
  verificationNotes,
  verifyDialogOpen,
  verifyMode,
}) {
  return (
    <AlertDialog open={verifyDialogOpen} onOpenChange={onOpenChange}>
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

        {verifyMode === "single" && selectedResult ? (
          <VerifySingleResultSummary selectedResult={selectedResult} />
        ) : null}

        {verifyMode === "order" ? (
          <div className="bg-muted/50 rounded-lg p-4 my-4">
            <p className="text-sm text-muted-foreground">
              This will verify all pending results for this order.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="verify-notes" className="text-sm font-medium">
            Verification Notes (Optional)
          </Label>
          <Textarea
            id="verify-notes"
            placeholder="Add any notes about this verification..."
            value={verificationNotes}
            onChange={(event) => onNotesChange(event.target.value)}
            className="min-h-[80px] resize-none"
          />
        </div>

        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onSubmit}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Verifying…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4 mr-2" />
                {verifyMode === "order" ? "Verify All" : "Verify Result"}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function VerifySingleResultSummary({ selectedResult }) {
  return (
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
        <span className={getLabResultFlagConfig(selectedResult.flag).className}>
          {selectedResult.flag_display || selectedResult.flag}
        </span>
      </div>
    </div>
  );
}

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
  const aiInterpretationAvailable = !isRustV2ApiMode();

  // Can verify results
  const canVerify = ["admin", "lab_technician", "doctor", "physician"].includes(
    userRole
  );

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [verificationFilter, setVerificationFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");
  const [expandedOrders, setExpandedOrders] = useState(new Set());
  const [page, setPage] = useState(1);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // AI interpretation dialog state
  const [interpretDialogOpen, setInterpretDialogOpen] = useState(false);
  const [interpretAudience, setInterpretAudience] = useState("clinician");
  const [interpretContext, setInterpretContext] = useState(null);

  // Build query filters
  const queryFilters = useMemo(() => {
    const filters = {
      page,
      page_size: RESULTS_PAGE_SIZE,
    };

    if (debouncedSearchQuery.trim()) {
      filters.search = debouncedSearchQuery.trim();
    }

    if (verificationFilter !== "all") {
      filters.is_verified = verificationFilter === "verified";
    }

    if (activeTab === "critical") {
      filters.critical_only = true;
    }

    return filters;
  }, [verificationFilter, activeTab, debouncedSearchQuery, page]);

  // Fetch results
  const { data: resultsData, isLoading, isFetching, refetch } = usePaginatedLabResults(queryFilters);

  // Mutations
  const verifyMutation = useVerifyLabResult();
  const bulkVerifyMutation = useBulkVerifyLabResults();
  const {
    handleBatchVerifyClick,
    handleVerifyClick,
    handleVerifySubmit,
    isSubmitting,
    selectedResult,
    setVerificationNotes,
    setVerifyDialogOpen,
    verificationNotes,
    verifyDialogOpen,
    verifyMode,
  } = useLabResultVerification({ bulkVerifyMutation, verifyMutation });

  const interpretationResultId =
    interpretContext?.mode === "result" ? interpretContext.sourceId : null;
  const interpretationOrderId =
    interpretContext?.mode === "order" ? interpretContext.sourceId : null;

  const clinicianInterpretation = useLabInterpretation({
    resultId: interpretationResultId,
    orderId: interpretationOrderId,
    audience: "clinician",
    enabled: aiInterpretationAvailable && interpretDialogOpen && Boolean(interpretContext) && interpretAudience === "clinician",
  });

  const patientInterpretation = useLabInterpretation({
    resultId: interpretationResultId,
    orderId: interpretationOrderId,
    audience: "patient",
    enabled: aiInterpretationAvailable && interpretDialogOpen && Boolean(interpretContext) && interpretAudience === "patient",
  });

  // Process results data
  const results = useMemo(() => {
    const data = resultsData?.results || [];
    return Array.isArray(data) ? data : [];
  }, [resultsData]);
  const totalCount = resultsData?.count || 0;

  const groupedResults = useGroupedLabResults(results);

  const filteredGroups = groupedResults;

  const stats = useLabResultsStats(results, groupedResults, totalCount);
  const metrics = useLabResultsMetrics(stats);

  const activeInterpretation =
    interpretAudience === "patient" ? patientInterpretation : clinicianInterpretation;

  const {
    interpretationConfidence,
    interpretationConfidenceBand,
    interpretationPayload,
    interpretationResultItems,
    interpretationSuggestedChecks,
  } = useInterpretationDetails(activeInterpretation);

  // Toggle order expansion
  const toggleOrderExpansion = useCallback((orderId) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const expandedGroups = useMemo(
    () => filteredGroups.filter((group) => expandedOrders.has(group._key)),
    [expandedOrders, filteredGroups]
  );

  const openResultInterpretation = useCallback((result, group) => {
    setInterpretAudience("clinician");
    setInterpretContext({
      mode: "result",
      sourceId: result.id,
      testName: result.test_name,
      orderNumber: group.order_number,
      patientName: group.patient_name,
    });
    setInterpretDialogOpen(true);
  }, []);

  const openOrderInterpretation = useCallback((group) => {
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
  }, []);

  const resultGroupColumns = useMemo(() => createResultGroupColumns({
    aiInterpretationAvailable,
    canVerify,
    expandedOrders,
    onBatchVerify: handleBatchVerifyClick,
    onOrderInterpretation: openOrderInterpretation,
    onToggleOrderExpansion: toggleOrderExpansion,
  }), [
    aiInterpretationAvailable,
    canVerify,
    expandedOrders,
    handleBatchVerifyClick,
    openOrderInterpretation,
    toggleOrderExpansion,
  ]);

  // Handle clear filters
  const handleTabChange = (value) => {
    setActiveTab(value);
    setPage(1);
  };

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value);
    setPage(1);
  };

  const handleVerificationFilterChange = (value) => {
    setVerificationFilter(value);
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setVerificationFilter("all");
    setPage(1);
  };

  const hasActiveFilters = searchQuery.trim() || verificationFilter !== "all";

  const closeInterpretationDialog = () => {
    setInterpretDialogOpen(false);
    setInterpretAudience("clinician");
    setInterpretContext(null);
  };

  const handleInterpretationDialogOpenChange = (nextOpen) => {
    setInterpretDialogOpen(nextOpen);
    if (!nextOpen) {
      setInterpretAudience("clinician");
      setInterpretContext(null);
    }
  };

  return (
    <PageShell>
      <LabResultsHeader
        isFetching={isFetching}
        metrics={metrics}
        onRefresh={refetch}
        stats={stats}
      />

      <LabResultsTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        stats={stats}
      />

      <LabResultsFilters
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
        onSearchChange={handleSearchChange}
        onVerificationFilterChange={handleVerificationFilterChange}
        searchQuery={searchQuery}
        verificationFilter={verificationFilter}
      />

      <LabResultsContent
        activeTab={activeTab}
        aiInterpretationAvailable={aiInterpretationAvailable}
        canVerify={canVerify}
        columns={resultGroupColumns}
        expandedGroups={expandedGroups}
        filteredGroups={filteredGroups}
        hasActiveFilters={hasActiveFilters}
        isLoading={isLoading}
        onBatchVerify={handleBatchVerifyClick}
        onClearFilters={handleClearFilters}
        onOrderInterpretation={openOrderInterpretation}
        onResultInterpretation={openResultInterpretation}
        onToggleOrderExpansion={toggleOrderExpansion}
        onVerifyResult={handleVerifyClick}
        searchQuery={searchQuery}
        verificationFilter={verificationFilter}
      />

      <LabResultsPagination
        onPageChange={setPage}
        page={page}
        totalCount={totalCount}
      />

      <LabInterpretationDialog
        activeInterpretation={activeInterpretation}
        interpretationConfidence={interpretationConfidence}
        interpretationConfidenceBand={interpretationConfidenceBand}
        interpretationPayload={interpretationPayload}
        interpretationResultItems={interpretationResultItems}
        interpretationSuggestedChecks={interpretationSuggestedChecks}
        interpretAudience={interpretAudience}
        interpretContext={interpretContext}
        interpretDialogOpen={interpretDialogOpen}
        onAudienceChange={setInterpretAudience}
        onClose={closeInterpretationDialog}
        onOpenChange={handleInterpretationDialogOpenChange}
      />

      <LabVerifyDialog
        isSubmitting={isSubmitting}
        onNotesChange={setVerificationNotes}
        onOpenChange={setVerifyDialogOpen}
        onSubmit={handleVerifySubmit}
        selectedResult={selectedResult}
        verificationNotes={verificationNotes}
        verifyDialogOpen={verifyDialogOpen}
        verifyMode={verifyMode}
      />
    </PageShell>
  );
}
