import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Droplet from 'lucide-react/dist/esm/icons/droplet.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import format from "date-fns/format";
import { toast } from "sonner";
import { useCreateLabSpecimen, useCollectLabOrder } from "@/features/laboratory/hooks";

const SPECIMEN_TYPES = [
  { value: "blood", label: "Blood" },
  { value: "serum", label: "Serum" },
  { value: "plasma", label: "Plasma" },
  { value: "urine", label: "Urine" },
  { value: "stool", label: "Stool" },
  { value: "sputum", label: "Sputum" },
  { value: "csf", label: "Cerebrospinal Fluid (CSF)" },
  { value: "swab", label: "Swab" },
  { value: "tissue", label: "Tissue" },
  { value: "other", label: "Other" },
];

const CONTAINER_TYPES = [
  { value: "red_top", label: "Red Top (No Additive)" },
  { value: "lavender_top", label: "Lavender Top (EDTA)" },
  { value: "green_top", label: "Green Top (Heparin)" },
  { value: "blue_top", label: "Blue Top (Citrate)" },
  { value: "yellow_top", label: "Yellow Top (ACD)" },
  { value: "gray_top", label: "Gray Top (Oxalate/Fluoride)" },
  { value: "gold_top", label: "Gold/SST (Gel Separator)" },
  { value: "urine_cup", label: "Urine Cup" },
  { value: "sterile_container", label: "Sterile Container" },
  { value: "swab_transport", label: "Swab Transport" },
  { value: "other", label: "Other" },
];

function SpecimenCollectionHeader({ orderNumber }) {
  return (
    <DialogHeader>
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Droplet className="size-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <DialogTitle className="font-display text-xl">
            Collect Specimen
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {orderNumber}
          </DialogDescription>
        </div>
      </div>
    </DialogHeader>
  );
}

function OrderSummary({ order }) {
  return (
    <div className="bg-card/50 rounded-lg border border-border p-3 mb-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-display text-sm font-medium">{order?.patient_name}</p>
          <p className="font-mono text-xs text-muted-foreground">
            MRN: {order?.patient_mrn}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {order?.order_tests?.length || 0} test(s)
          </p>
        </div>
      </div>
      {order?.fasting_required && (
        <div className="flex items-center gap-1.5 text-amber-600 text-xs">
          <AlertCircle className="size-3" />
          <span>Fasting required - verify with patient</span>
        </div>
      )}
    </div>
  );
}

function RequiredMarker() {
  return <span className="text-rose-500">*</span>;
}

function FieldError({ message }) {
  if (!message) return null;

  return <p className="text-xs text-rose-500">{message}</p>;
}

function SpecimenSelectField({
  id,
  label,
  value,
  error,
  options,
  placeholder,
  onChange,
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label} <RequiredMarker />
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          className={cn(error && "border-rose-500")}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {options.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </div>
  );
}

function TextInputField({
  id,
  label,
  value,
  placeholder,
  description,
  onChange,
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="font-mono text-sm"
      />
      {description && (
        <p className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

function CollectionTimeField({ value, error, onChange }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="collected_at" className="text-sm font-medium">
        Collection Time <RequiredMarker />
      </Label>
      <Input
        id="collected_at"
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "font-mono text-sm",
          error && "border-rose-500"
        )}
      />
      <FieldError message={error} />
    </div>
  );
}

function SpecimenCollectionFields({ formData, errors, onChange }) {
  return (
    <div className="space-y-4">
      <SpecimenSelectField
        id="specimen_type"
        label="Specimen Type"
        value={formData.specimen_type}
        error={errors.specimen_type}
        options={SPECIMEN_TYPES}
        placeholder="Select specimen type"
        onChange={(value) => onChange("specimen_type", value)}
      />
      <SpecimenSelectField
        id="container_type"
        label="Container Type"
        value={formData.container_type}
        error={errors.container_type}
        options={CONTAINER_TYPES}
        placeholder="Select container type"
        onChange={(value) => onChange("container_type", value)}
      />
      <TextInputField
        id="collection_site"
        label="Collection Site"
        value={formData.collection_site}
        placeholder="e.g., Left antecubital fossa"
        description="Anatomical site where specimen was collected"
        onChange={(value) => onChange("collection_site", value)}
      />
      <TextInputField
        id="volume_collected"
        label="Volume Collected"
        value={formData.volume_collected}
        placeholder="e.g., 5 mL"
        onChange={(value) => onChange("volume_collected", value)}
      />
      <CollectionTimeField
        value={formData.collected_at}
        error={errors.collected_at}
        onChange={(value) => onChange("collected_at", value)}
      />
    </div>
  );
}

function SpecimenCollectionFooter({ isSubmitting, onCancel, onSubmit }) {
  return (
    <DialogFooter className="mt-6">
      <Button
        variant="outline"
        onClick={onCancel}
        disabled={isSubmitting}
      >
        Cancel
      </Button>
      <Button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="bg-amber-600 hover:bg-amber-700 text-white"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Collecting…
          </>
        ) : (
          <>
            <Droplet className="size-4 mr-2" />
            Collect Specimen
          </>
        )}
      </Button>
    </DialogFooter>
  );
}

/**
 * SpecimenCollectionDialog - Dialog for recording specimen collection
 *
 * Features:
 * - Specimen type selection based on ordered tests
 * - Container type selection
 * - Collection site input
 * - Volume collected
 * - Collection timestamp (defaults to now)
 * - Triggers order status change to "collected"
 */
const SpecimenCollectionDialog = ({
  open,
  onOpenChange,
  order,
  onSuccess,
}) => {
  const [formData, setFormData] = useState({
    specimen_type: "",
    container_type: "",
    collection_site: "",
    volume_collected: "",
    collected_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
  });
  const [errors, setErrors] = useState({});

  const createSpecimenMutation = useCreateLabSpecimen();
  const collectOrderMutation = useCollectLabOrder();

  // Validate form
  const validateForm = () => {
    const newErrors = {};

    if (!formData.specimen_type) {
      newErrors.specimen_type = "Specimen type is required";
    }

    if (!formData.container_type) {
      newErrors.container_type = "Container type is required";
    }

    if (!formData.collected_at) {
      newErrors.collected_at = "Collection time is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!validateForm()) return;

    try {
      // Create specimen
      await createSpecimenMutation.mutateAsync({
        order: order.id,
        specimen_type: formData.specimen_type,
        container_type: formData.container_type,
        collection_site: formData.collection_site || "",
        volume_collected: formData.volume_collected || "",
        collected_at: new Date(formData.collected_at).toISOString(),
      });

      // Update order status to collected
      await collectOrderMutation.mutateAsync(order.id);

      toast.success("Specimen collected successfully", {
        description: `Order ${order.order_number} marked as collected`,
      });

      // Reset form
      setFormData({
        specimen_type: "",
        container_type: "",
        collection_site: "",
        volume_collected: "",
        collected_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      });
      setErrors({});

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error("Failed to collect specimen", {
        description: error.message || "Please try again",
      });
    }
  };

  // Handle input change
  const updateSpecimenField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when field is updated
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const isSubmitting = createSpecimenMutation.isPending || collectOrderMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <SpecimenCollectionHeader orderNumber={order?.order_number} />
        <OrderSummary order={order} />
        <SpecimenCollectionFields
          formData={formData}
          errors={errors}
          onChange={updateSpecimenField}
        />
        <SpecimenCollectionFooter
          isSubmitting={isSubmitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
};

export { SpecimenCollectionDialog };
export default SpecimenCollectionDialog;
