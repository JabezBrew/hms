import X from 'lucide-react/dist/esm/icons/x.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import { useState } from "react";
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

function getInitialTestForm() {
  return {
    name: "",
    loinc_code: "",
    category: "chemistry",
    description: "",
    specimen_type: "blood",
    price: "",
    tat_hours: "",
    is_active: true,
  };
}

function getInitialPanelForm() {
  return {
    name: "",
    code: "",
    description: "",
    price: "",
    is_active: true,
    tests: [],
  };
}

const CATEGORIES = [
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

const SPECIMEN_TYPES = [
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

function FieldError({ message, className }) {
  if (!message) {
    return null;
  }

  return <p className={cn("text-xs text-red-500", className)}>{message}</p>;
}

function FieldLabel({ children, icon }) {
  return (
    <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
      {icon}
      {children}
    </Label>
  );
}

function TextInputField({
  label,
  value,
  onChange,
  placeholder,
  error,
  description,
  type,
  step,
  min,
  icon,
}) {
  return (
    <div className="space-y-2">
      <FieldLabel icon={icon}>{label}</FieldLabel>
      <Input
        type={type}
        step={step}
        min={min}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn("font-mono", error && "border-red-500")}
      />
      <FieldError message={error} />
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

function TextareaField({ label, value, onChange, placeholder }) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <Textarea
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono min-h-[80px]"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, placeholder, options, error }) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={cn("font-mono", error && "border-red-500")}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </div>
  );
}

function ActiveStatusField({ checked, onCheckedChange, entityLabel }) {
  return (
    <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
      <div>
        <Label className="font-mono text-sm font-medium">
          Active Status
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Inactive {entityLabel}s won't appear in lab order forms
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function PanelTestOption({ test, isSelected, onToggle }) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 p-3 border-b border-border/50 last:border-0",
        "hover:bg-muted/30 cursor-pointer",
        isSelected && "bg-amber-50 dark:bg-amber-900/20"
      )}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        aria-label={`Include ${test.name} in this panel`}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border border-input shadow-xs transition-colors",
          isSelected && "border-primary bg-primary text-primary-foreground"
        )}
      >
        {isSelected && <Check className="size-3.5" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{test.name}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {test.loinc_code || test.category}
        </p>
      </div>
    </label>
  );
}

function PanelTestSelector({ tests, selectedTestIds, error, onToggleTest }) {
  return (
    <div className="space-y-2">
      <FieldLabel>Select Tests *</FieldLabel>
      <FieldError message={error} className="mb-2" />
      <div className="border border-border rounded-lg max-h-[300px] overflow-y-auto">
        {tests.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No tests available. Create some tests first.
          </div>
        ) : (
          tests.map((test) => (
            <PanelTestOption
              key={test.id}
              test={test}
              isSelected={selectedTestIds.includes(test.id)}
              onToggle={() => onToggleTest(test.id)}
            />
          ))
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {selectedTestIds.length} test(s) selected
      </p>
    </div>
  );
}

function PanelForm({ form, errors, tests, onChange, onToggleTest }) {
  return (
    <div className="space-y-6">
      <TextInputField
        label="Panel Name *"
        placeholder="e.g., Complete Metabolic Panel"
        value={form.name}
        onChange={(value) => onChange("name", value)}
        error={errors.name}
      />
      <TextInputField
        label="Panel Code"
        placeholder="e.g., CMP"
        value={form.code}
        onChange={(value) => onChange("code", value)}
      />
      <TextareaField
        label="Description"
        placeholder="Brief description of the panel..."
        value={form.description}
        onChange={(value) => onChange("description", value)}
      />
      <TextInputField
        label="Price"
        type="number"
        step="0.01"
        min="0"
        placeholder="Enter price"
        value={form.price}
        onChange={(value) => onChange("price", value)}
        error={errors.price}
        icon={<DollarSign className="size-3.5 text-sky-600" />}
      />
      <PanelTestSelector
        tests={tests}
        selectedTestIds={form.tests}
        error={errors.tests}
        onToggleTest={onToggleTest}
      />
      <ActiveStatusField
        checked={form.is_active}
        onCheckedChange={(checked) => onChange("is_active", checked)}
        entityLabel="panel"
      />
    </div>
  );
}

function TestForm({ form, errors, onChange }) {
  return (
    <div className="space-y-6">
      <TextInputField
        label="Test Name *"
        placeholder="e.g., Complete Blood Count"
        value={form.name}
        onChange={(value) => onChange("name", value)}
        error={errors.name}
      />
      <TextInputField
        label="LOINC Code"
        placeholder="e.g., 58410-2"
        value={form.loinc_code}
        onChange={(value) => onChange("loinc_code", value)}
        description="Optional standardized code for interoperability"
      />
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label="Category *"
          value={form.category}
          onChange={(value) => onChange("category", value)}
          placeholder="Select category"
          options={CATEGORIES}
          error={errors.category}
        />
        <SelectField
          label="Specimen Type"
          value={form.specimen_type}
          onChange={(value) => onChange("specimen_type", value)}
          placeholder="Select specimen"
          options={SPECIMEN_TYPES}
        />
      </div>
      <TextareaField
        label="Description"
        placeholder="Brief description of the test..."
        value={form.description}
        onChange={(value) => onChange("description", value)}
      />
      <div className="grid grid-cols-2 gap-4">
        <TextInputField
          label="Price"
          type="number"
          step="0.01"
          min="0"
          placeholder="Enter price"
          value={form.price}
          onChange={(value) => onChange("price", value)}
          error={errors.price}
          icon={<DollarSign className="size-3.5 text-sky-600" />}
        />
        <TextInputField
          label="TAT (hours)"
          type="number"
          min="1"
          placeholder="Turnaround time"
          value={form.tat_hours}
          onChange={(value) => onChange("tat_hours", value)}
          error={errors.tat_hours}
          icon={<Clock className="size-3.5 text-sky-600" />}
        />
      </div>
      <ActiveStatusField
        checked={form.is_active}
        onCheckedChange={(checked) => onChange("is_active", checked)}
        entityLabel="test"
      />
    </div>
  );
}

function AddLabTestHeader({ isPanel, onClose }) {
  return (
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
  );
}

function AddLabTestFooter({ isPanel, isPending, onClose, onSubmit }) {
  return (
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
          onClick={onSubmit}
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
  );
}

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
  return (
    <>
      {open ? (
        <AddLabTestSlideOverContent
          key={type}
          type={type}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      ) : null}
    </>
  );
}

function AddLabTestSlideOverContent({
  type = "test",
  onClose,
  onSuccess,
}) {
  const isPanel = type === "panel";

  // Mutations
  const createTest = useCreateLabTest();
  const createPanel = useCreateLabPanel();

  // Get tests for panel creation
  const { data: testsData } = useLabTests({ enabled: isPanel, page_size: 500 });
  const tests = Array.isArray(testsData) ? testsData : (testsData?.results || []);

  // Form state for test
  const [testForm, setTestForm] = useState(getInitialTestForm);

  // Form state for panel
  const [panelForm, setPanelForm] = useState(getInitialPanelForm);

  const [errors, setErrors] = useState({});

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
        "translate-x-0"
      )}
    >
      <AddLabTestHeader isPanel={isPanel} onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        {isPanel ? (
          <PanelForm
            form={panelForm}
            errors={errors}
            tests={tests}
            onChange={handlePanelChange}
            onToggleTest={handleTestToggle}
          />
        ) : (
          <TestForm
            form={testForm}
            errors={errors}
            onChange={handleTestChange}
          />
        )}
      </div>
      <AddLabTestFooter
        isPanel={isPanel}
        isPending={isPending}
        onClose={onClose}
        onSubmit={handleSubmit}
      />
    </div>
  );
};

export default AddLabTestSlideOver;
export { AddLabTestSlideOver };
