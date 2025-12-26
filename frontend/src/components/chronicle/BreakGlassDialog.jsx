import { AlertTriangle, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BreakGlassDialog = ({
  open,
  onOpenChange,
  patientName,
  patientMrn,
  reason,
  onReasonChange,
  onSubmit,
  isSubmitting,
  ttlMinutes = 30,
}) => {
  const reasonCount = reason?.length || 0;
  const isValid = reasonCount >= 6;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border-border/70 bg-card/95 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.6)] backdrop-blur">
        <DialogHeader className="text-left space-y-3">
          <div className="flex items-center gap-2">
            <span className="badge-chronicle-rose text-[10px] uppercase tracking-[0.2em]">
              Break Glass
            </span>
            <span className="text-xs text-muted-foreground">Emergency access</span>
          </div>
          <DialogTitle className="font-display text-2xl text-foreground">
            Temporary clinical access required
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            This action grants time-limited access for urgent care and is fully audited.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border/70 bg-background/60 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-chronicle-rose">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Patient
              </p>
              <p className="text-sm text-foreground">
                {patientName || "Unknown Patient"}
              </p>
              {patientMrn && (
                <p className="text-xs text-muted-foreground">MRN {patientMrn}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Reason for access
            </p>
            <Textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Explain the clinical need for access."
              maxLength={500}
              className="min-h-[110px] bg-background/80 text-sm"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className={cn(reasonCount < 6 && "text-chronicle-rose")}>
                Minimum 6 characters required.
              </span>
              <span>{reasonCount}/500</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>Access expires automatically in about {ttlMinutes} minutes.</span>
        </div>

        <DialogFooter className="gap-3 sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!isValid || isSubmitting}
            className="bg-[oklch(0.65_0.22_15)] text-white hover:bg-[oklch(0.60_0.22_15)]"
          >
            {isSubmitting ? "Granting Access..." : "Grant Access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BreakGlassDialog;
