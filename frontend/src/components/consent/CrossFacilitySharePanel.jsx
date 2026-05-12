import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import ClipboardCopy from 'lucide-react/dist/esm/icons/clipboard-copy.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isRustV2ApiMode } from "@/lib/api/v2/runtime";

import {
  useCreateConsentGrant,
  useCreateCrossFacilityReferral,
  useIssueConsentToken,
} from "@/hooks/useConsentQueries";
import { useCreateRecordExport } from "@/hooks/useInteropQueries";

const STEP_CONFIG = [
  {
    id: "referral",
    title: "Referral Request",
    description: "Notify the receiving facility and establish intent.",
    icon: Send,
  },
  {
    id: "consent",
    title: "Consent Grant",
    description: "Document patient consent for cross-facility access.",
    icon: Shield,
  },
  {
    id: "token",
    title: "Access Token",
    description: "Issue a time-bound token for record sharing.",
    icon: KeyRound,
  },
];

const CrossFacilitySharePanel = ({ open, onClose, patient, patientIdentityId }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetFacilityCode, setTargetFacilityCode] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [consentReason, setConsentReason] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [referral, setReferral] = useState(null);
  const [consent, setConsent] = useState(null);
  const [issuedToken, setIssuedToken] = useState(null);
  const [exportJob, setExportJob] = useState(null);

  const referralMutation = useCreateCrossFacilityReferral();
  const consentMutation = useCreateConsentGrant();
  const tokenMutation = useIssueConsentToken();
  const exportMutation = useCreateRecordExport();
  const rustV2Mode = isRustV2ApiMode();
  const workflowSteps = useMemo(
    () => (rustV2Mode ? STEP_CONFIG.filter((step) => step.id === "consent") : STEP_CONFIG),
    [rustV2Mode]
  );

  const patientName = useMemo(() => {
    if (!patient) return "Patient";
    const details = patient?.local_data?.user_details || patient?.user_details;
    if (details) {
      return `${details.first_name || ""} ${details.last_name || ""}`.trim() || "Patient";
    }
    return patient?.name || patient?.full_name || "Patient";
  }, [patient]);

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
      setTargetFacilityCode("");
      setReasonCode("");
      setConsentReason("");
      setExpiresInDays("");
      setReferral(null);
      setConsent(null);
      setIssuedToken(null);
      setExportJob(null);
    }
  }, [open]);

  const safeStepIndex = Math.min(stepIndex, workflowSteps.length - 1);
  const currentStep = workflowSteps[safeStepIndex];
  const patientShareId = patientIdentityId || (rustV2Mode ? patient?.id || patient?.local_data?.id : null);
  const identityMissing = !patientShareId;

  const handleCreateReferral = async () => {
    if (!patientShareId) {
      toast.error("Missing MPI identity", { description: "Patient identity is required." });
      return;
    }
    if (!targetFacilityCode.trim()) {
      toast.error("Target facility required");
      return;
    }

    try {
      const created = await referralMutation.mutateAsync({
        patient_identity_id: patientShareId,
        target_facility_code: targetFacilityCode.trim().toUpperCase(),
        reason_code: reasonCode.trim(),
      });
      setReferral(created);
      setStepIndex((prev) => Math.min(prev + 1, workflowSteps.length - 1));
      toast.success("Referral requested", {
        description: `Referral sent to ${created.target_facility_code}.`,
      });
    } catch (error) {
      toast.error("Referral failed", { description: error.message || "Please try again." });
    }
  };

  const handleGrantConsent = async () => {
    if (!patientShareId) {
      toast.error("Missing MPI identity", { description: "Patient identity is required." });
      return;
    }
    if (!targetFacilityCode.trim()) {
      toast.error("Target facility required");
      return;
    }

    let expiresAt = null;
    if (expiresInDays) {
      const days = Number(expiresInDays);
      if (Number.isFinite(days) && days > 0) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        expiresAt = date.toISOString();
      }
    }

    try {
      const created = await consentMutation.mutateAsync({
        patient_id: rustV2Mode ? patientShareId : undefined,
        patient_identity_id: patientShareId,
        target_facility_code: targetFacilityCode.trim().toUpperCase(),
        scope: "full_record",
        reason: consentReason.trim(),
        expires_at: expiresAt,
      });
      setConsent(created);
      setStepIndex((prev) => Math.min(prev + 1, workflowSteps.length - 1));
      toast.success("Consent granted", {
        description: `Consent active for ${created.target_facility_code}.`,
      });
    } catch (error) {
      toast.error("Consent failed", { description: error.message || "Please try again." });
    }
  };

  const handleIssueToken = async () => {
    if (!consent?.id) {
      toast.error("Consent required", { description: "Create a consent grant first." });
      return;
    }

    try {
      const response = await tokenMutation.mutateAsync({
        consentId: consent.id,
        payload: {
          target_facility_code: consent.target_facility_code,
          ttl_seconds: 3600,
        },
      });
      setIssuedToken(response.token);
      toast.success("Access token issued");
    } catch (error) {
      toast.error("Token issuance failed", { description: error.message || "Please try again." });
    }
  };

  const handleCreateExport = async () => {
    if (!issuedToken) {
      toast.error("Token required", { description: "Issue an access token first." });
      return;
    }
    if (!patientShareId) {
      toast.error("Missing MPI identity");
      return;
    }

    try {
      const response = await exportMutation.mutateAsync({
        patient_identity_id: patientShareId,
        target_facility_code: consent?.target_facility_code || targetFacilityCode.trim().toUpperCase(),
        consent_token: issuedToken,
      });
      setExportJob(response);
      toast.success("Export queued", {
        description: `Export job ${response.id} created.`,
      });
    } catch (error) {
      toast.error("Export failed", { description: error.message || "Please try again." });
    }
  };

  const handleCopyExportId = async () => {
    if (!exportJob?.id) return;
    try {
      await navigator.clipboard.writeText(exportJob.id);
      toast.success("Export ID copied");
    } catch {
      toast.error("Copy failed", { description: "Please copy manually." });
    }
  };

  const handleCopyToken = async () => {
    if (!issuedToken) return;
    try {
      await navigator.clipboard.writeText(issuedToken);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Copy failed", { description: "Please copy manually." });
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-100 text-amber-700">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">Cross-Facility Share</h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {identityMissing && (
          <Card className="border border-rose-200 bg-rose-50">
            <CardContent className="p-4 text-sm text-rose-700">
              {rustV2Mode
                ? "Patient record id is missing. Open a valid patient before sharing records."
                : "MPI identity is missing for this patient. Create the patient identity before sharing records."}
            </CardContent>
          </Card>
        )}
        <Card className="border border-border">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="font-heading text-sm text-muted-foreground">Workflow step</p>
                <p className="font-display text-lg text-foreground">{currentStep.title}</p>
              </div>
              <Badge variant="secondary" className="font-mono text-xs">
                Step {safeStepIndex + 1} of {workflowSteps.length}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{currentStep.description}</p>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          {workflowSteps.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = index === safeStepIndex;
            const isDone = index < safeStepIndex;
            return (
              <div
                key={step.id}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1.5 border text-xs font-mono",
                  isActive && "border-amber-400 text-amber-700 bg-amber-50",
                  isDone && "border-emerald-400 text-emerald-700 bg-emerald-50",
                  !isActive && !isDone && "border-border text-muted-foreground"
                )}
              >
                <StepIcon className="h-3.5 w-3.5" />
                {step.title}
              </div>
            );
          })}
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase text-muted-foreground">
              Target Facility Code
            </Label>
            <div className="relative">
              <Building2 className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={targetFacilityCode}
                onChange={(event) => setTargetFacilityCode(event.target.value.toUpperCase())}
                placeholder="E.g. REGIONAL-01"
                className="pl-9 font-mono"
              />
            </div>
          </div>

          {currentStep.id === "referral" && (
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">
                Referral Reason Code
              </Label>
              <Input
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value)}
                placeholder="E.g. CARDIO, TRANSFER"
                className="font-mono"
              />
            </div>
          )}

          {currentStep.id === "consent" && (
            <>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">
                  Consent Summary
                </Label>
                <Textarea
                  value={consentReason}
                  onChange={(event) => setConsentReason(event.target.value)}
                  placeholder="Document the patient consent discussion..."
                  className="min-h-[120px]"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">
                  Expiration (days)
                </Label>
                <Input
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(event.target.value)}
                  placeholder="Leave blank for no expiration"
                  className="font-mono"
                />
              </div>
            </>
          )}

          {currentStep.id === "token" && (
            <div className="space-y-3">
              <Label className="font-mono text-xs uppercase text-muted-foreground">
                Access Token
              </Label>
              <div className="rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs break-all">
                {issuedToken || "Issue a token to share with the receiving facility."}
              </div>
              {issuedToken && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopyToken} className="font-mono text-xs">
                    <ClipboardCopy className="h-3.5 w-3.5 mr-2" />
                    Copy Token
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleIssueToken}
                    className="font-mono text-xs"
                    disabled={tokenMutation.isPending}
                  >
                    Re-issue Token
                  </Button>
                </div>
              )}

              <div className="border-t border-border pt-3 space-y-3">
                <Label className="font-mono text-xs uppercase text-muted-foreground">
                  Export Bundle
                </Label>
                {exportJob ? (
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">Job ID</span>
                      <span className="font-mono text-foreground">{exportJob.id}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono">Status</span>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {exportJob.status}
                      </Badge>
                    </div>
                    {exportJob.expires_at && (
                      <div className="flex items-center justify-between">
                        <span className="font-mono">Expires</span>
                        <span className="font-mono">
                          {new Date(exportJob.expires_at).toLocaleString()}
                        </span>
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyExportId}
                      className="font-mono text-xs"
                    >
                      <ClipboardCopy className="h-3.5 w-3.5 mr-2" />
                      Copy Export ID
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Queue a record export bundle after issuing the token.
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Share the token and export job ID with the receiving facility to retrieve the bundle.
              </p>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-border p-4 flex items-center justify-between">
        <Button variant="ghost" onClick={onClose} className="font-mono text-xs">
          Cancel
        </Button>
        <div className="flex items-center gap-2">
          {safeStepIndex > 0 && (
            <Button
              variant="outline"
              onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
              className="font-mono text-xs"
            >
              Back
            </Button>
          )}

          {currentStep.id === "referral" && (
            <Button
              onClick={handleCreateReferral}
              className="font-mono text-xs"
              disabled={identityMissing || referralMutation.isPending}
            >
              {referralMutation.isPending ? "Sending..." : "Send Referral"}
            </Button>
          )}

          {currentStep.id === "consent" && (
            <Button
              onClick={handleGrantConsent}
              className="font-mono text-xs"
              disabled={identityMissing || consentMutation.isPending}
            >
              {consentMutation.isPending ? "Saving..." : "Grant Consent"}
            </Button>
          )}

          {currentStep.id === "token" && (
            <Button
              onClick={issuedToken ? handleCreateExport : handleIssueToken}
              className="font-mono text-xs"
              disabled={tokenMutation.isPending || exportMutation.isPending || identityMissing}
            >
              {tokenMutation.isPending
                ? "Issuing..."
                : exportMutation.isPending
                ? "Queueing..."
                : issuedToken
                ? "Queue Export Bundle"
                : "Issue Token"}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
};

export default CrossFacilitySharePanel;
