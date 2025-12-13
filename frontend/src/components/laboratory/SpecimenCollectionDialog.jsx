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
import { Loader2, Droplet, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useCreateLabSpecimen, useCollectLabOrder } from "@/hooks/useLabQueries";

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

  // Common specimen types
  const specimenTypes = [
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

  // Common container types
  const containerTypes = [
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
  const handleChange = (field, value) => {
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
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Droplet className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <DialogTitle className="font-display text-xl">
                Collect Specimen
              </DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {order?.order_number}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Order Summary */}
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
              <AlertCircle className="h-3 w-3" />
              <span>Fasting required - verify with patient</span>
            </div>
          )}
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Specimen Type */}
          <div className="space-y-2">
            <Label htmlFor="specimen_type" className="text-sm font-medium">
              Specimen Type <span className="text-rose-500">*</span>
            </Label>
            <Select
              value={formData.specimen_type}
              onValueChange={(value) => handleChange("specimen_type", value)}
            >
              <SelectTrigger
                id="specimen_type"
                className={cn(errors.specimen_type && "border-rose-500")}
              >
                <SelectValue placeholder="Select specimen type" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {specimenTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.specimen_type && (
              <p className="text-xs text-rose-500">{errors.specimen_type}</p>
            )}
          </div>

          {/* Container Type */}
          <div className="space-y-2">
            <Label htmlFor="container_type" className="text-sm font-medium">
              Container Type <span className="text-rose-500">*</span>
            </Label>
            <Select
              value={formData.container_type}
              onValueChange={(value) => handleChange("container_type", value)}
            >
              <SelectTrigger
                id="container_type"
                className={cn(errors.container_type && "border-rose-500")}
              >
                <SelectValue placeholder="Select container type" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {containerTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.container_type && (
              <p className="text-xs text-rose-500">{errors.container_type}</p>
            )}
          </div>

          {/* Collection Site */}
          <div className="space-y-2">
            <Label htmlFor="collection_site" className="text-sm font-medium">
              Collection Site
            </Label>
            <Input
              id="collection_site"
              value={formData.collection_site}
              onChange={(e) => handleChange("collection_site", e.target.value)}
              placeholder="e.g., Left antecubital fossa"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Anatomical site where specimen was collected
            </p>
          </div>

          {/* Volume Collected */}
          <div className="space-y-2">
            <Label htmlFor="volume_collected" className="text-sm font-medium">
              Volume Collected
            </Label>
            <Input
              id="volume_collected"
              value={formData.volume_collected}
              onChange={(e) => handleChange("volume_collected", e.target.value)}
              placeholder="e.g., 5 mL"
              className="font-mono text-sm"
            />
          </div>

          {/* Collection Time */}
          <div className="space-y-2">
            <Label htmlFor="collected_at" className="text-sm font-medium">
              Collection Time <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="collected_at"
              type="datetime-local"
              value={formData.collected_at}
              onChange={(e) => handleChange("collected_at", e.target.value)}
              className={cn(
                "font-mono text-sm",
                errors.collected_at && "border-rose-500"
              )}
            />
            {errors.collected_at && (
              <p className="text-xs text-rose-500">{errors.collected_at}</p>
            )}
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Collecting...
              </>
            ) : (
              <>
                <Droplet className="h-4 w-4 mr-2" />
                Collect Specimen
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { SpecimenCollectionDialog };
export default SpecimenCollectionDialog;
