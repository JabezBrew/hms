import X from 'lucide-react/dist/esm/icons/x.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  useCustomizeLabTest,
  useResetLabTestToDefaults,
  useCustomizeLabPanel,
  useResetLabPanelToDefaults,
} from "@/hooks/useLabQueries";

/**
 * LabTestCustomizeSlideOver - Chronicle-styled slide-over for customizing lab tests
 *
 * Features:
 * - Edit price, reference ranges, TAT, and active status
 * - Shows original system values for comparison
 * - Reset to defaults functionality
 * - Works for both tests and panels
 */
const LabTestCustomizeSlideOver = ({
  open,
  onClose,
  item, // test or panel object
  type = "test", // 'test' or 'panel'
  onSuccess,
}) => {
  const isPanel = type === "panel";

  // Mutations
  const customizeTest = useCustomizeLabTest();
  const resetTest = useResetLabTestToDefaults();
  const customizePanel = useCustomizeLabPanel();
  const resetPanel = useResetLabPanelToDefaults();

  const customizeMutation = isPanel ? customizePanel : customizeTest;
  const resetMutation = isPanel ? resetPanel : resetTest;

  // Form state
  const [formData, setFormData] = useState({
    price: "",
    tat_hours: "",
    is_active: true,
    reference_ranges: {},
  });

  const [errors, setErrors] = useState({});

  // Reference range editing state (for tests only)
  const [referenceRangeText, setReferenceRangeText] = useState("");

  // Initialize form when item changes
  useEffect(() => {
    if (item) {
      setFormData({
        price: item.price || "",
        tat_hours: item.tat_hours || "",
        is_active: item.is_active !== false,
        reference_ranges: item.reference_ranges || {},
      });

      // Convert reference ranges to editable text format
      if (item.reference_ranges && !isPanel) {
        const rangeText = Object.entries(item.reference_ranges)
          .map(([key, value]) => {
            if (typeof value === "object") {
              return `${key}: ${value.min || ""}-${value.max || ""} ${value.unit || ""}`;
            }
            return `${key}: ${value}`;
          })
          .join("\n");
        setReferenceRangeText(rangeText);
      } else {
        setReferenceRangeText("");
      }

      setErrors({});
    }
  }, [item, isPanel]);

  // Handle input change
  const handleChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  // Validate form
  const validate = () => {
    const newErrors = {};

    if (formData.price && isNaN(parseFloat(formData.price))) {
      newErrors.price = "Price must be a valid number";
    }

    if (formData.price && parseFloat(formData.price) < 0) {
      newErrors.price = "Price cannot be negative";
    }

    if (formData.tat_hours && isNaN(parseInt(formData.tat_hours))) {
      newErrors.tat_hours = "TAT must be a valid number";
    }

    if (formData.tat_hours && parseInt(formData.tat_hours) < 1) {
      newErrors.tat_hours = "TAT must be at least 1 hour";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Parse reference ranges from text with improved handling
  const parseReferenceRanges = (text = referenceRangeText) => {
    if (!text || !text.trim()) return { parsed: {}, errors: [], valid: true };

    const ranges = {};
    const errors = [];
    const lines = text.split("\n").filter((l) => l.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const colonIndex = line.indexOf(":");

      if (colonIndex === -1) {
        errors.push({ line: i + 1, message: "Missing colon separator" });
        continue;
      }

      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();

      if (!key) {
        errors.push({ line: i + 1, message: "Missing population name" });
        continue;
      }

      if (!value) {
        errors.push({ line: i + 1, message: "Missing value" });
        continue;
      }

      // Try different formats:
      // 1. Range format: "4.5-11.0 K/uL" or "4.5 - 11.0 K/uL"
      // 2. Open-ended: ">5.0 K/uL" or "<10 K/uL"
      // 3. Single value with unit: "7.0 pH"

      // Range format with optional spaces
      const rangeMatch = value.match(/^([\d.]+)?\s*[-–]\s*([\d.]+)?\s*(.*)$/);
      if (rangeMatch) {
        const min = rangeMatch[1] ? parseFloat(rangeMatch[1]) : null;
        const max = rangeMatch[2] ? parseFloat(rangeMatch[2]) : null;
        const unit = rangeMatch[3]?.trim() || "";

        if (min !== null && isNaN(min)) {
          errors.push({ line: i + 1, message: "Invalid minimum value" });
          continue;
        }
        if (max !== null && isNaN(max)) {
          errors.push({ line: i + 1, message: "Invalid maximum value" });
          continue;
        }

        ranges[key] = { min, max, unit };
        continue;
      }

      // Open-ended format: >5.0 or <10
      const openEndedMatch = value.match(/^([<>])\s*([\d.]+)\s*(.*)$/);
      if (openEndedMatch) {
        const operator = openEndedMatch[1];
        const num = parseFloat(openEndedMatch[2]);
        const unit = openEndedMatch[3]?.trim() || "";

        if (isNaN(num)) {
          errors.push({ line: i + 1, message: "Invalid numeric value" });
          continue;
        }

        ranges[key] = {
          min: operator === ">" ? num : null,
          max: operator === "<" ? num : null,
          unit,
        };
        continue;
      }

      // Fallback: store as plain string
      ranges[key] = value;
    }

    return {
      parsed: ranges,
      errors,
      valid: errors.length === 0,
    };
  };

  // Get live preview of parsed ranges
  const parsedPreview = parseReferenceRanges();

  // Population labels for display
  const populationLabels = {
    adult_male: "Adult Male",
    adult_female: "Adult Female",
    adult: "Adult",
    pediatric: "Pediatric",
    child: "Child",
    infant: "Infant",
    elderly: "Elderly",
    pregnant: "Pregnant",
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!validate()) return;

    const data = {};

    // Only include changed values
    if (formData.price !== "") {
      data.price = parseFloat(formData.price);
    }

    if (!isPanel && formData.tat_hours !== "") {
      data.tat_hours = parseInt(formData.tat_hours);
    }

    data.is_active = formData.is_active;

    // Parse and include reference ranges for tests
    if (!isPanel && referenceRangeText.trim()) {
      const result = parseReferenceRanges();
      if (!result.valid) {
        toast.error("Invalid reference ranges format", {
          description: result.errors.map(e => `Line ${e.line}: ${e.message}`).join(", "),
        });
        return;
      }
      data.reference_ranges = result.parsed;
    }

    try {
      await customizeMutation.mutateAsync({
        id: item.id,
        data,
      });

      toast.success(
        `${isPanel ? "Panel" : "Test"} customized successfully`
      );
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error("Failed to customize:", err);
      toast.error(err.message || `Failed to customize ${isPanel ? "panel" : "test"}`);
    }
  };

  // Handle reset to defaults
  const handleReset = async () => {
    if (!item.is_system_default) {
      toast.error("Only system tests/panels can be reset");
      return;
    }

    try {
      await resetMutation.mutateAsync(item.id);
      toast.success("Reset to system defaults");
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error("Failed to reset:", err);
      toast.error(err.message || "Failed to reset to defaults");
    }
  };

  // Get system default values for comparison
  const systemDefaults = item?.system_defaults || {};

  // Format price for display
  const formatPrice = (price) => {
    if (!price && price !== 0) return "Not set";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(price);
  };

  if (!item) return null;

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "p-2 rounded-lg",
              isPanel
                ? "bg-amber-100 dark:bg-amber-900/30"
                : "bg-sky-100 dark:bg-sky-900/30"
            )}
          >
            <TestTube2
              className={cn(
                "h-5 w-5",
                isPanel
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-sky-600 dark:text-sky-400"
              )}
            />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              Customize {isPanel ? "Panel" : "Test"}
            </h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
              {item.name}
            </p>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="h-4 w-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        <div className="space-y-6">
          {/* System vs Modified indicator */}
          {item.is_system_default && (
            <Alert className="bg-muted/50 border-border">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                This is a system {isPanel ? "panel" : "test"}.{" "}
                {item.is_facility_modified
                  ? "Your facility has customized it. You can reset to defaults anytime."
                  : "Customize it for your facility's needs."}
              </AlertDescription>
            </Alert>
          )}

          {/* Price */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-sky-600" />
              Price
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="Enter price"
              value={formData.price}
              onChange={(e) => handleChange("price", e.target.value)}
              className={cn("font-mono", errors.price && "border-red-500")}
            />
            {systemDefaults.price !== undefined && (
              <p className="text-xs text-muted-foreground">
                System default: {formatPrice(systemDefaults.price)}
              </p>
            )}
            {errors.price && (
              <p className="text-xs text-red-500">{errors.price}</p>
            )}
          </div>

          {/* TAT (tests only) */}
          {!isPanel && (
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-sky-600" />
                Turnaround Time (hours)
              </Label>
              <Input
                type="number"
                min="1"
                placeholder="Enter TAT in hours"
                value={formData.tat_hours}
                onChange={(e) => handleChange("tat_hours", e.target.value)}
                className={cn(
                  "font-mono",
                  errors.tat_hours && "border-red-500"
                )}
              />
              {systemDefaults.tat_hours !== undefined && (
                <p className="text-xs text-muted-foreground">
                  System default: {systemDefaults.tat_hours}h
                </p>
              )}
              {errors.tat_hours && (
                <p className="text-xs text-red-500">{errors.tat_hours}</p>
              )}
            </div>
          )}

          {/* Reference Ranges (tests only) */}
          {!isPanel && (
            <div className="space-y-3">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Reference Ranges
              </Label>
              <Textarea
                placeholder={`Enter reference ranges, one per line:
adult_male: 4.5-5.5 M/uL
adult_female: 4.0-5.0 M/uL
pediatric: 3.8-5.2 M/uL`}
                value={referenceRangeText}
                onChange={(e) => setReferenceRangeText(e.target.value)}
                className={cn(
                  "font-mono min-h-[120px] text-sm",
                  !parsedPreview.valid && "border-amber-500"
                )}
              />

              {/* Help text */}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  Format guide
                </summary>
                <div className="mt-2 p-3 bg-muted/50 rounded-lg space-y-2 text-[11px]">
                  <p className="font-medium">Supported formats:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li><code className="bg-muted px-1 rounded">population: min-max unit</code> - Range (e.g., adult: 4.5-5.5 mg/dL)</li>
                    <li><code className="bg-muted px-1 rounded">population: &gt;value unit</code> - Greater than (e.g., adult: &gt;5.0 mg/dL)</li>
                    <li><code className="bg-muted px-1 rounded">population: &lt;value unit</code> - Less than (e.g., adult: &lt;10 mg/dL)</li>
                  </ul>
                  <p className="font-medium mt-2">Common population keys:</p>
                  <p className="ml-2">adult_male, adult_female, pediatric, infant, elderly, pregnant</p>
                </div>
              </details>

              {/* Live Preview Panel */}
              {referenceRangeText.trim() && (
                <div className={cn(
                  "rounded-lg border p-3",
                  parsedPreview.valid
                    ? "bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
                    : "bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800"
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    {parsedPreview.valid ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                          Parsed successfully
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                        <span className="font-mono text-xs text-amber-700 dark:text-amber-400">
                          {parsedPreview.errors.length} error(s)
                        </span>
                      </>
                    )}
                  </div>

                  {/* Errors */}
                  {parsedPreview.errors.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {parsedPreview.errors.map((err, idx) => (
                        <p key={idx} className="text-xs text-amber-700 dark:text-amber-400">
                          Line {err.line}: {err.message}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Parsed Values */}
                  {Object.keys(parsedPreview.parsed).length > 0 && (
                    <div className="space-y-1.5">
                      {Object.entries(parsedPreview.parsed).map(([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between py-1 px-2 bg-background/50 rounded text-xs"
                        >
                          <span className="font-medium text-foreground">
                            {populationLabels[key] || key}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            {typeof value === "object"
                              ? value.min !== null && value.max !== null
                                ? `${value.min} - ${value.max} ${value.unit}`
                                : value.min !== null
                                ? `> ${value.min} ${value.unit}`
                                : value.max !== null
                                ? `< ${value.max} ${value.unit}`
                                : value.unit
                              : value}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* System defaults */}
              {systemDefaults.reference_ranges && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">
                    View system defaults
                  </summary>
                  <pre className="mt-2 p-2 bg-muted rounded text-[10px] overflow-x-auto">
                    {JSON.stringify(systemDefaults.reference_ranges, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* Active Status */}
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
            <div>
              <Label className="font-mono text-sm font-medium">
                Active Status
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Inactive tests won't appear in lab order forms
              </p>
            </div>
            <Switch
              checked={formData.is_active}
              onCheckedChange={(checked) => handleChange("is_active", checked)}
            />
          </div>

          {/* Current item info */}
          <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
            <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Current Values
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">LOINC Code:</span>
                <span className="font-mono">{item.loinc_code || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category:</span>
                <span className="font-mono capitalize">{item.category || "—"}</span>
              </div>
              {!isPanel && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Specimen:</span>
                  <span className="font-mono">{item.specimen_type || "—"}</span>
                </div>
              )}
              {isPanel && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tests:</span>
                  <span className="font-mono">
                    {item.tests?.length || item.tests_count || 0}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border bg-card">
        <div className="flex items-center justify-between">
          {/* Reset button (only for modified system items) */}
          <div>
            {item.is_system_default && item.is_facility_modified && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={resetMutation.isPending}
                className="font-mono text-xs"
              >
                {resetMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Reset to Defaults
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={customizeMutation.isPending}
              className="font-mono text-xs"
            >
              {customizeMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LabTestCustomizeSlideOver;
export { LabTestCustomizeSlideOver };
