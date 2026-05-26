import X from 'lucide-react/dist/esm/icons/x.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
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

import { toast } from "sonner";
import {
  useCreateLabTest,
  useCreateLabPanel,
  useLabTests,
} from "@/features/laboratory/hooks";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * AddLabTestSlideOver - Chronicle-styled slide-over for adding new lab tests or panels
 *
 * Features:
 * - Add custom tests with all required fields
 * - Add custom panels with test selection
 * - Chronicle design system styling
 */
const AddLabTestSlideOver = ({
  open,
  onClose,
  type = "test", // 'test' or 'panel'
  onSuccess,
}) => {
  const isPanel = type === "panel";

  // Mutations
  const createTest = useCreateLabTest();
  const createPanel = useCreateLabPanel();

  // Get tests for panel creation
  const { data: testsData } = useLabTests({ enabled: open, page_size: 500 });
  const tests = Array.isArray(testsData) ? testsData : (testsData?.results || []);

  // Form state for test
  const [testForm, setTestForm] = useState({
    name: "",
    loinc_code: "",
    category: "chemistry",
    description: "",
    specimen_type: "blood",
    price: "",
    tat_hours: "",
    is_active: true,
  });

  // Form state for panel
  const [panelForm, setPanelForm] = useState({
    name: "",
    code: "",
    description: "",
    price: "",
    is_active: true,
    tests: [],
  });

  const [errors, setErrors] = useState({});

  // Categories
  const categories = [
    { value: "hematology", label: "Hematology" },
    { value: "chemistry", label: "Chemistry" },
    { value: "microbiology", label: "Microbiology" },
    { value: "immunology", label: "Immunology" },
    { value: "urinalysis", label: "Urinalysis" },
    { value: "coagulation", label: "Coagulation" },
    { value: "serology", label: "Serology" },
    { value: "molecular", label: "Molecular/PCR" },
    { value: "pathology", label: "Pathology" },
    { value: "toxicology", label: "Toxicology" },
    { value: "endocrine", label: "Endocrine" },
    { value: "cardiac", label: "Cardiac Markers" },
    { value: "other", label: "Other" },
  ];

  // Specimen types
  const specimenTypes = [
    { value: "blood", label: "Blood" },
    { value: "serum", label: "Serum" },
    { value: "plasma", label: "Plasma" },
    { value: "urine", label: "Urine" },
    { value: "stool", label: "Stool" },
    { value: "csf", label: "CSF (Cerebrospinal Fluid)" },
    { value: "swab", label: "Swab" },
    { value: "tissue", label: "Tissue" },
    { value: "sputum", label: "Sputum" },
    { value: "other", label: "Other" },
  ];

  // Reset form when panel closes or type changes
  useEffect(() => {
    if (!open) {
      setTestForm({
        name: "",
        loinc_code: "",
        category: "chemistry",
        description: "",
        specimen_type: "blood",
        price: "",
        tat_hours: "",
        is_active: true,
      });
      setPanelForm({
        name: "",
        code: "",
        description: "",
        price: "",
        is_active: true,
        tests: [],
      });
      setErrors({});
    }
  }, [open, type]);

  // Handle test form change
  const handleTestChange = (field, value) => {
    setTestForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  // Handle panel form change
  const handlePanelChange = (field, value) => {
    setPanelForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  // Handle test selection for panel
  const handleTestToggle = (testId) => {
    setPanelForm((prev) => ({
      ...prev,
      tests: prev.tests.includes(testId)
        ? prev.tests.filter((id) => id !== testId)
        : [...prev.tests, testId],
    }));
  };

  // Validate test form
  const validateTestForm = () => {
    const newErrors = {};

    if (!testForm.name.trim()) {
      newErrors.name = "Test name is required";
    }

    if (!testForm.category) {
      newErrors.category = "Category is required";
    }

    if (testForm.price && isNaN(parseFloat(testForm.price))) {
      newErrors.price = "Price must be a valid number";
    }

    if (testForm.tat_hours && isNaN(parseInt(testForm.tat_hours))) {
      newErrors.tat_hours = "TAT must be a valid number";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Validate panel form
  const validatePanelForm = () => {
    const newErrors = {};

    if (!panelForm.name.trim()) {
      newErrors.name = "Panel name is required";
    }

    if (panelForm.tests.length === 0) {
      newErrors.tests = "Select at least one test for the panel";
    }

    if (panelForm.price && isNaN(parseFloat(panelForm.price))) {
      newErrors.price = "Price must be a valid number";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle submit
  const handleSubmit = async () => {
    if (isPanel) {
      if (!validatePanelForm()) return;

      const data = {
        name: panelForm.name.trim(),
        code: panelForm.code.trim() || undefined,
        description: panelForm.description.trim() || undefined,
        price: panelForm.price ? parseFloat(panelForm.price) : undefined,
        is_active: panelForm.is_active,
        tests: panelForm.tests,
      };

      try {
        await createPanel.mutateAsync(data);
        toast.success("Panel created successfully");
        onSuccess?.();
        onClose();
      } catch (err) {
        console.error("Failed to create panel:", err);
        toast.error(err.message || "Failed to create panel");
      }
    } else {
      if (!validateTestForm()) return;

      const data = {
        name: testForm.name.trim(),
        loinc_code: testForm.loinc_code.trim() || undefined,
        category: testForm.category,
        description: testForm.description.trim() || undefined,
        specimen_type: testForm.specimen_type,
        price: testForm.price ? parseFloat(testForm.price) : undefined,
        tat_hours: testForm.tat_hours ? parseInt(testForm.tat_hours) : undefined,
        is_active: testForm.is_active,
      };

      try {
        await createTest.mutateAsync(data);
        toast.success("Test created successfully");
        onSuccess?.();
        onClose();
      } catch (err) {
        console.error("Failed to create test:", err);
        toast.error(err.message || "Failed to create test");
      }
    }
  };

  const isPending = createTest.isPending || createPanel.isPending;

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
            {isPanel ? (
              <FlaskConical className="size-5 text-amber-600 dark:text-amber-400" />
            ) : (
              <TestTube2 className="size-5 text-sky-600 dark:text-sky-400" />
            )}
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              Add New {isPanel ? "Panel" : "Test"}
            </h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              Create a custom {isPanel ? "panel" : "test"} for your facility
            </p>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="size-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        {isPanel ? (
          // Panel Form
          <div className="space-y-6">
            {/* Panel Name */}
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Panel Name *
              </Label>
              <Input
                placeholder="e.g., Complete Metabolic Panel"
                value={panelForm.name}
                onChange={(e) => handlePanelChange("name", e.target.value)}
                className={cn("font-mono", errors.name && "border-red-500")}
              />
              {errors.name && (
                <p className="text-xs text-red-500">{errors.name}</p>
              )}
            </div>

            {/* Panel Code */}
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Panel Code
              </Label>
              <Input
                placeholder="e.g., CMP"
                value={panelForm.code}
                onChange={(e) => handlePanelChange("code", e.target.value)}
                className="font-mono"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Description
              </Label>
              <Textarea
                placeholder="Brief description of the panel..."
                value={panelForm.description}
                onChange={(e) => handlePanelChange("description", e.target.value)}
                className="font-mono min-h-[80px]"
              />
            </div>

            {/* Price */}
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <DollarSign className="size-3.5 text-sky-600" />
                Price
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Enter price"
                value={panelForm.price}
                onChange={(e) => handlePanelChange("price", e.target.value)}
                className={cn("font-mono", errors.price && "border-red-500")}
              />
              {errors.price && (
                <p className="text-xs text-red-500">{errors.price}</p>
              )}
            </div>

            {/* Select Tests */}
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Select Tests *
              </Label>
              {errors.tests && (
                <p className="text-xs text-red-500 mb-2">{errors.tests}</p>
              )}
              <div className="border border-border rounded-lg max-h-[300px] overflow-y-auto">
                {tests.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    No tests available. Create some tests first.
                  </div>
                ) : (
                  tests.map((test) => (
                    <div
                      key={test.id}
                      className={cn(
                        "flex items-center gap-3 p-3 border-b border-border/50 last:border-0",
                        "hover:bg-muted/30 cursor-pointer",
                        panelForm.tests.includes(test.id) && "bg-amber-50 dark:bg-amber-900/20"
                      )}
                      onClick={() => handleTestToggle(test.id)}
                    >
                      <Checkbox
                        checked={panelForm.tests.includes(test.id)}
                        onCheckedChange={() => handleTestToggle(test.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{test.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {test.loinc_code || test.category}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {panelForm.tests.length} test(s) selected
              </p>
            </div>

            {/* Active Status */}
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
              <div>
                <Label className="font-mono text-sm font-medium">
                  Active Status
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Inactive panels won't appear in lab order forms
                </p>
              </div>
              <Switch
                checked={panelForm.is_active}
                onCheckedChange={(checked) => handlePanelChange("is_active", checked)}
              />
            </div>
          </div>
        ) : (
          // Test Form
          <div className="space-y-6">
            {/* Test Name */}
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Test Name *
              </Label>
              <Input
                placeholder="e.g., Complete Blood Count"
                value={testForm.name}
                onChange={(e) => handleTestChange("name", e.target.value)}
                className={cn("font-mono", errors.name && "border-red-500")}
              />
              {errors.name && (
                <p className="text-xs text-red-500">{errors.name}</p>
              )}
            </div>

            {/* LOINC Code */}
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                LOINC Code
              </Label>
              <Input
                placeholder="e.g., 58410-2"
                value={testForm.loinc_code}
                onChange={(e) => handleTestChange("loinc_code", e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Optional standardized code for interoperability
              </p>
            </div>

            {/* Category and Specimen Type */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Category *
                </Label>
                <Select
                  value={testForm.category}
                  onValueChange={(value) => handleTestChange("category", value)}
                >
                  <SelectTrigger className={cn("font-mono", errors.category && "border-red-500")}>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {categories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category && (
                  <p className="text-xs text-red-500">{errors.category}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Specimen Type
                </Label>
                <Select
                  value={testForm.specimen_type}
                  onValueChange={(value) => handleTestChange("specimen_type", value)}
                >
                  <SelectTrigger className="font-mono">
                    <SelectValue placeholder="Select specimen" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {specimenTypes.map((spec) => (
                      <SelectItem key={spec.value} value={spec.value}>
                        {spec.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Description
              </Label>
              <Textarea
                placeholder="Brief description of the test..."
                value={testForm.description}
                onChange={(e) => handleTestChange("description", e.target.value)}
                className="font-mono min-h-[80px]"
              />
            </div>

            {/* Price and TAT */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <DollarSign className="size-3.5 text-sky-600" />
                  Price
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Enter price"
                  value={testForm.price}
                  onChange={(e) => handleTestChange("price", e.target.value)}
                  className={cn("font-mono", errors.price && "border-red-500")}
                />
                {errors.price && (
                  <p className="text-xs text-red-500">{errors.price}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Clock className="size-3.5 text-sky-600" />
                  TAT (hours)
                </Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="Turnaround time"
                  value={testForm.tat_hours}
                  onChange={(e) => handleTestChange("tat_hours", e.target.value)}
                  className={cn("font-mono", errors.tat_hours && "border-red-500")}
                />
                {errors.tat_hours && (
                  <p className="text-xs text-red-500">{errors.tat_hours}</p>
                )}
              </div>
            </div>

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
                checked={testForm.is_active}
                onCheckedChange={(checked) => handleTestChange("is_active", checked)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border bg-card">
        <div className="flex items-center justify-end gap-2">
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
            disabled={isPending}
            className="font-mono text-xs"
          >
            {isPending ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Check className="size-3.5 mr-1.5" />
                Create {isPanel ? "Panel" : "Test"}
              </>
            )}
          </Button>
        </div>
      </footer>
    </div>
  );
};

export default AddLabTestSlideOver;
export { AddLabTestSlideOver };
