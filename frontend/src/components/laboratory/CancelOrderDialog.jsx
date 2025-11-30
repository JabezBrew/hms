import { useState } from "react";
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
import { AlertTriangle, Loader2 } from "lucide-react";
import { useCancelLabOrder } from "@/hooks/useLabQueries";
import { toast } from "sonner";

/**
 * CancelOrderDialog - Confirmation dialog for cancelling lab orders
 *
 * Features:
 * - Warning message about cancellation
 * - Required reason textarea
 * - Shows order summary
 * - Calls cancel mutation on confirm
 */
const CancelOrderDialog = ({
  open,
  onOpenChange,
  order,
  onSuccess,
}) => {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const cancelMutation = useCancelLabOrder();

  const handleCancel = async () => {
    // Validate reason
    if (!reason.trim()) {
      setError("Please provide a reason for cancellation");
      return;
    }

    if (reason.trim().length < 10) {
      setError("Reason must be at least 10 characters");
      return;
    }

    try {
      await cancelMutation.mutateAsync({
        id: order.id,
        cancellationReason: reason.trim(),
      });

      toast.success("Lab order cancelled successfully");
      setReason("");
      setError("");
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to cancel order:", err);
      toast.error(err.message || "Failed to cancel order");
    }
  };

  const handleClose = () => {
    setReason("");
    setError("");
    onOpenChange(false);
  };

  if (!order) return null;

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-full bg-rose-100 dark:bg-rose-900/30">
              <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
            </div>
            <AlertDialogTitle className="font-display text-xl">
              Cancel Lab Order
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-muted-foreground">
            Are you sure you want to cancel this lab order? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Order Summary */}
        <div className="bg-muted/50 rounded-lg p-4 my-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Order Number:</span>
            <span className="font-mono">{order.order_number}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Patient:</span>
            <span className="font-medium">{order.patient_name || "Unknown"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tests:</span>
            <span>{order.test_count || 0} test(s)</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Status:</span>
            <span>{order.status_display || order.status}</span>
          </div>
        </div>

        {/* Cancellation Reason */}
        <div className="space-y-2">
          <Label htmlFor="cancel-reason" className="text-sm font-medium">
            Reason for Cancellation <span className="text-rose-500">*</span>
          </Label>
          <Textarea
            id="cancel-reason"
            placeholder="Please provide a detailed reason for cancelling this order..."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError("");
            }}
            className="min-h-[100px] resize-none"
          />
          {error && (
            <p className="text-xs text-rose-600">{error}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Minimum 10 characters required
          </p>
        </div>

        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel onClick={handleClose}>
            Keep Order
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancel}
            className="bg-rose-600 hover:bg-rose-700 text-white"
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Cancelling...
              </>
            ) : (
              "Cancel Order"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export { CancelOrderDialog };
export default CancelOrderDialog;
