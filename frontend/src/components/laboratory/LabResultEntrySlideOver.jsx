import X from 'lucide-react/dist/esm/icons/x.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js';
import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

import { toast } from "sonner";
import { useBulkCreateLabResults } from "@/hooks/useLabQueries";

/**
 * LabResultEntrySlideOver - Chronicle-styled slide-over for bulk lab result entry
 *
 * Features:
 * - Inline table entry for all tests in an order
 * - Pre-populated units and reference ranges from test catalog
 * - Auto-flag calculation based on reference ranges
 * - Tab/Enter navigation between value cells
 * - Progress indicator showing completion status
 * - Keyboard shortcuts for efficient data entry
 */
const LabResultEntrySlideOver = ({
  open,
  onClose,
  order,
  specimen,
  onSuccess,
}) => {
  // State for test results
  const [results, setResults] = useState([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRefs = useRef([]);

  // Mutation
  const bulkCreateMutation = useBulkCreateLabResults();

  // Initialize results from order tests
  useEffect(() => {
    if (order?.order_tests && open) {
      const initialResults = order.order_tests.map((orderTest) => {
        // Parse reference ranges from test catalog
        const refRanges = orderTest.test?.reference_ranges || {};
        // Default to adult_male or first available population
        const defaultPopulation = refRanges.adult_male || refRanges.adult || Object.values(refRanges)[0] || {};

        return {
          order_test_id: orderTest.id,
          test_name: orderTest.test?.name || orderTest.test?.short_name || "Unknown",
          test_code: orderTest.test?.code || "",
          value: "",
          unit: defaultPopulation.unit || orderTest.test?.unit || "",
          reference_low: defaultPopulation.low || defaultPopulation.min || null,
          reference_high: defaultPopulation.high || defaultPopulation.max || null,
          flag: null,
          hasExistingResult: orderTest.result != null,
        };
      }).filter(r => !r.hasExistingResult); // Only show tests without existing results

      setResults(initialResults);
      setFocusedIndex(0);
    }
  }, [order, open]);

  // Calculate flag based on value and reference range
  const calculateFlag = useCallback((value, refLow, refHigh) => {
    if (!value || value.trim() === "") return null;

    const numValue = parseFloat(value);
    if (isNaN(numValue)) return null;

    // Critical thresholds (50% outside range)
    if (refLow !== null && numValue < refLow * 0.5) return "critical_low";
    if (refHigh !== null && numValue > refHigh * 1.5) return "critical_high";

    // Abnormal thresholds
    if (refLow !== null && numValue < refLow) return "low";
    if (refHigh !== null && numValue > refHigh) return "high";

    return "normal";
  }, []);

  // Update a result value
  const handleValueChange = (index, value) => {
    setResults((prev) => {
      const updated = [...prev];
      const result = updated[index];
      result.value = value;
      result.flag = calculateFlag(value, result.reference_low, result.reference_high);
      return updated;
    });
  };

  // Handle Enter key - move to next row
  const handleKeyDown = (e, index) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const nextIndex = index + 1;
      if (nextIndex < results.length) {
        setFocusedIndex(nextIndex);
        inputRefs.current[nextIndex]?.focus();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = Math.min(index + 1, results.length - 1);
      setFocusedIndex(nextIndex);
      inputRefs.current[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = Math.max(index - 1, 0);
      setFocusedIndex(prevIndex);
      inputRefs.current[prevIndex]?.focus();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  // Calculate progress
  const enteredCount = results.filter((r) => r.value && r.value.trim() !== "").length;
  const totalCount = results.length;
  const progressPercent = totalCount > 0 ? (enteredCount / totalCount) * 100 : 0;

  // Check for critical values
  const criticalResults = results.filter(
    (r) => r.flag === "critical_low" || r.flag === "critical_high"
  );

  // Handle save
  const handleSave = async () => {
    // Validate - at least one result entered
    const validResults = results.filter((r) => r.value && r.value.trim() !== "");

    if (validResults.length === 0) {
      toast.error("No results to save", {
        description: "Enter at least one result value before saving",
      });
      return;
    }

    // Warn about critical values
    if (criticalResults.length > 0) {
      const proceed = window.confirm(
        `${criticalResults.length} critical value(s) detected. Are you sure you want to save?`
      );
      if (!proceed) return;
    }

    try {
      await bulkCreateMutation.mutateAsync({
        order_id: order.id,
        specimen_id: specimen.id,
        performed_at: new Date().toISOString(),
        results: validResults.map((r) => ({
          order_test_id: r.order_test_id,
          value: r.value,
          unit: r.unit,
          reference_low: r.reference_low,
          reference_high: r.reference_high,
          flag: r.flag || "normal",
        })),
      });

      toast.success("Results saved successfully", {
        description: `Recorded ${validResults.length} result(s) for order ${order.order_number}`,
      });

      onSuccess?.();
      onClose();
    } catch (error) {
      toast.error("Failed to save results", {
        description: error.message || "Please try again",
      });
    }
  };

  // Get flag display
  const getFlagDisplay = (flag) => {
    const configs = {
      normal: { label: "Normal", className: "bg-emerald-100 text-emerald-700 border-emerald-300" },
      low: { label: "Low", className: "bg-amber-100 text-amber-700 border-amber-300", icon: ArrowDown },
      high: { label: "High", className: "bg-amber-100 text-amber-700 border-amber-300", icon: ArrowUp },
      critical_low: { label: "Critical Low", className: "bg-rose-100 text-rose-700 border-rose-300", icon: ArrowDown },
      critical_high: { label: "Critical High", className: "bg-rose-100 text-rose-700 border-rose-300", icon: ArrowUp },
    };
    return configs[flag] || null;
  };

  const isSubmitting = bulkCreateMutation.isPending;

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-2/3 xl:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
            <TestTube2 className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              Enter Lab Results
            </h2>
            {order && (
              <p className="font-mono text-xs text-muted-foreground mt-0.5">
                {order.order_number} &middot; {order.patient_name}
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
          <X className="h-4 w-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Progress Bar */}
      <div className="px-6 py-3 border-b border-border bg-card/50">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs text-muted-foreground">
            Progress: {enteredCount} of {totalCount} entered
          </span>
          {criticalResults.length > 0 && (
            <Badge variant="outline" className="bg-rose-100 text-rose-700 border-rose-300 text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {criticalResults.length} critical
            </Badge>
          )}
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Content - Results Table */}
      <div className="flex-1 overflow-y-auto chronicle-scrollbar">
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mb-4 text-emerald-500" />
            <p className="font-medium">All results already entered</p>
            <p className="text-sm">No pending tests for this order</p>
          </div>
        ) : (
          <div className="min-w-0">
            {/* Table Header */}
            <div className="sticky top-0 z-10 bg-card border-b border-border">
              <div className="grid grid-cols-12 gap-2 px-6 py-3 text-xs font-mono uppercase text-muted-foreground">
                <div className="col-span-4">Test</div>
                <div className="col-span-2">Value</div>
                <div className="col-span-2">Unit</div>
                <div className="col-span-2">Ref Range</div>
                <div className="col-span-2">Flag</div>
              </div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-border">
              {results.map((result, index) => {
                const flagConfig = getFlagDisplay(result.flag);
                const isActive = focusedIndex === index;

                return (
                  <div
                    key={result.order_test_id}
                    className={cn(
                      "grid grid-cols-12 gap-2 px-6 py-3 items-center transition-colors",
                      "animate-chronicle-enter",
                      isActive && "bg-sky-50/50 dark:bg-sky-900/10",
                      result.flag?.includes("critical") && "bg-rose-50/50 dark:bg-rose-900/10"
                    )}
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    {/* Test Name */}
                    <div className="col-span-4 min-w-0">
                      <p className="font-medium text-sm truncate">{result.test_name}</p>
                      {result.test_code && (
                        <p className="font-mono text-xs text-muted-foreground">
                          {result.test_code}
                        </p>
                      )}
                    </div>

                    {/* Value Input */}
                    <div className="col-span-2">
                      <Input
                        ref={(el) => (inputRefs.current[index] = el)}
                        type="text"
                        inputMode="decimal"
                        value={result.value}
                        onChange={(e) => handleValueChange(index, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        onFocus={() => setFocusedIndex(index)}
                        placeholder="--"
                        className={cn(
                          "font-mono text-sm h-9 text-center",
                          result.flag?.includes("critical") && "border-rose-300 focus:ring-rose-500"
                        )}
                        autoFocus={index === 0}
                      />
                    </div>

                    {/* Unit */}
                    <div className="col-span-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {result.unit || "-"}
                      </span>
                    </div>

                    {/* Reference Range */}
                    <div className="col-span-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {result.reference_low !== null && result.reference_high !== null
                          ? `${result.reference_low} - ${result.reference_high}`
                          : result.reference_low !== null
                          ? `> ${result.reference_low}`
                          : result.reference_high !== null
                          ? `< ${result.reference_high}`
                          : "-"}
                      </span>
                    </div>

                    {/* Flag */}
                    <div className="col-span-2">
                      {flagConfig ? (
                        <Badge variant="outline" className={cn("text-xs", flagConfig.className)}>
                          {flagConfig.icon && <flagConfig.icon className="h-3 w-3 mr-1" />}
                          {flagConfig.label}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground font-mono">
            <span className="hidden sm:inline">Tab/Enter: next &middot; </span>
            <span className="hidden sm:inline">Arrows: navigate &middot; </span>
            <span className="hidden sm:inline">Esc: close</span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSubmitting || enteredCount === 0}
              className="bg-sky-600 hover:bg-sky-700 text-white font-mono text-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save {enteredCount > 0 ? `${enteredCount} Result${enteredCount > 1 ? "s" : ""}` : "Results"}
                </>
              )}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export { LabResultEntrySlideOver };
export default LabResultEntrySlideOver;
