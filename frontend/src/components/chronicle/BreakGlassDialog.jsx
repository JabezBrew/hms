
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  nativeMode = false,
  category = 'urgent_clinical_continuity',
  onCategoryChange,
  confirmed = false,
  onConfirmedChange,
  error,
  reauthRequired,
  onSignInAgain,
}) => {
  const reasonCount = reason?.trim().length || 0;
  const isValid = reasonCount >= 6 && reasonCount <= 500 && (!nativeMode || confirmed);

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
              <AlertTriangle className="size-4" />
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

          {nativeMode && <div className="space-y-2">
            <Label htmlFor="break-glass-category">Emergency category</Label>
            <Select value={category} onValueChange={onCategoryChange} disabled={isSubmitting}>
              <SelectTrigger id="break-glass-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="life_threatening_emergency">Life-threatening emergency</SelectItem>
                <SelectItem value="patient_unconscious_or_unidentified">Patient unconscious or unidentified</SelectItem>
                <SelectItem value="handover_or_assignment_gap">Handover or assignment gap</SelectItem>
                <SelectItem value="urgent_clinical_continuity">Urgent clinical continuity</SelectItem>
                <SelectItem value="other_emergency">Other emergency</SelectItem>
              </SelectContent>
            </Select>
          </div>}
          <div className="space-y-2">
            <Label htmlFor="break-glass-reason" className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Reason for access
            </Label>
            <Textarea
              id="break-glass-reason"
              value={reason}
              disabled={isSubmitting}
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
          {nativeMode && <div className="flex items-start gap-3">
            <Checkbox id="break-glass-confirm" checked={confirmed} onCheckedChange={(value) => onConfirmedChange(value === true)} disabled={isSubmitting} />
            <Label htmlFor="break-glass-confirm" className="text-sm leading-relaxed">I confirm this access is required for urgent clinical care and will be audited.</Label>
          </div>}
          {error && <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            {reauthRequired && onSignInAgain && <Button variant="outline" onClick={onSignInAgain}>Sign out to verify identity</Button>}
          </div>}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          <span>{nativeMode ? 'The server limits emergency access to two hours. You can end it earlier.' : `Access expires automatically in about ${ttlMinutes} minutes.`}</span>
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
