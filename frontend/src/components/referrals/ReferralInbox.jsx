import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  User,
  Calendar,
  Clock,
  Building2,
  FileText,
  CheckCircle,
  XCircle,
  Search,
  AlertCircle,
  Stethoscope,
  PlayCircle,
  MessageSquare,
} from "lucide-react";
import { format } from "date-fns";
import {
  useReferralInbox,
  useAcceptReferral,
  useDeclineReferral,
  useCompleteReferral,
} from "@/hooks/useReferralQueries";
import { toast } from "sonner";

/**
 * ReferralInbox - Received referrals management for specialists
 * Uses Chronicle Design System for consistent dark mode support
 */
const ReferralInbox = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState(null);
  const [actionNotes, setActionNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");

  // API queries
  const { data: inboxData, isLoading } = useReferralInbox();
  const acceptReferral = useAcceptReferral();
  const declineReferral = useDeclineReferral();
  const completeReferral = useCompleteReferral();

  // Handle starting consultation from referral - navigates to patient page with add note open
  const handleStartConsultation = (referral) => {
    // referral.patient is the patient UUID from the serializer
    const patientId = referral.patient;
    if (!patientId) {
      toast.error("Unable to navigate", { description: "Patient ID not found" });
      return;
    }
    // Navigate to patient chronicle with action=add_note to auto-open the note slide-over
    navigate(`/patients/${patientId}?action=add_note&referral_id=${referral.id}`);
  };

  // Filter referrals by search
  const filteredReferrals = (inboxData?.referrals || []).filter((referral) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    const patientName =
      `${referral.patient_details?.first_name} ${referral.patient_details?.last_name}`.toLowerCase();
    const mrn = referral.patient_details?.medical_record_number?.toLowerCase() || "";
    const referralNumber = referral.referral_number?.toLowerCase() || "";
    const reason = referral.reason?.toLowerCase() || "";

    return (
      patientName.includes(query) ||
      mrn.includes(query) ||
      referralNumber.includes(query) ||
      reason.includes(query)
    );
  });

  // Handle action click
  const handleActionClick = (referral, action) => {
    setSelectedReferral(referral);
    setCurrentAction(action);
    setActionNotes("");
    setRecommendations("");
    setActionDialogOpen(true);
  };

  // Handle action submit
  const handleActionSubmit = async () => {
    if (!selectedReferral) return;

    try {
      switch (currentAction) {
        case "accept":
          await acceptReferral.mutateAsync({
            id: selectedReferral.id,
            acceptanceNotes: actionNotes,
          });
          toast.success("Referral accepted", {
            description: `Referral #${selectedReferral.referral_number} has been accepted`,
          });
          break;

        case "decline":
          if (!actionNotes || actionNotes.trim() === "") {
            toast.error("Please provide a reason for declining");
            return;
          }
          await declineReferral.mutateAsync({
            id: selectedReferral.id,
            declineReason: actionNotes,
          });
          toast.success("Referral declined", {
            description: `Referral #${selectedReferral.referral_number} has been declined`,
          });
          break;

        case "complete":
          if (!actionNotes || actionNotes.trim() === "") {
            toast.error("Please provide specialist notes");
            return;
          }
          await completeReferral.mutateAsync({
            id: selectedReferral.id,
            specialistNotes: actionNotes,
            recommendations: recommendations,
          });
          toast.success("Referral completed", {
            description: `Referral #${selectedReferral.referral_number} has been completed`,
          });
          break;

        default:
          break;
      }

      setActionDialogOpen(false);
      setSelectedReferral(null);
      setCurrentAction(null);
    } catch (error) {
      console.error("Error performing action:", error);
      toast.error("Action failed", {
        description: error.message || "Please try again",
      });
    }
  };

  // Status config using Chronicle badge classes
  const statusConfig = {
    draft: { label: "Draft", badgeClass: "bg-muted text-muted-foreground" },
    pending: { label: "Pending Review", badgeClass: "badge-chronicle-amber" },
    accepted: { label: "Accepted", badgeClass: "badge-chronicle-emerald" },
    declined: { label: "Declined", badgeClass: "badge-chronicle-rose" },
    scheduled: { label: "Scheduled", badgeClass: "badge-chronicle-sky" },
    completed: { label: "Completed", badgeClass: "badge-chronicle-emerald" },
  };

  // Urgency config
  const urgencyConfig = {
    routine: {
      label: "Routine",
      badgeClass: "bg-muted text-muted-foreground",
      icon: Clock,
    },
    urgent: {
      label: "Urgent",
      badgeClass: "badge-chronicle-amber",
      icon: AlertCircle,
    },
    emergency: {
      label: "Emergency",
      badgeClass: "badge-chronicle-rose",
      icon: AlertCircle,
    },
  };

  // Action config
  const actionConfig = {
    accept: {
      title: "Accept Referral",
      description:
        "Accept this referral and add any notes about scheduling or next steps",
      buttonLabel: "Accept Referral",
      buttonClass: "bg-[oklch(0.70_0.17_155)] hover:bg-[oklch(0.65_0.17_155)] text-white",
      notesLabel: "Acceptance Notes (Optional)",
      notesPlaceholder:
        "Add notes about scheduling, what the patient should bring, or any pre-visit instructions...",
    },
    decline: {
      title: "Decline Referral",
      description: "Decline this referral and provide a reason",
      buttonLabel: "Decline Referral",
      buttonClass: "bg-[oklch(0.65_0.22_15)] hover:bg-[oklch(0.60_0.22_15)] text-white",
      notesLabel: "Reason for Declining *",
      notesPlaceholder:
        "Provide a clear reason for declining (e.g., patient needs different specialty, insufficient information, not appropriate for referral)...",
    },
    complete: {
      title: "Complete Referral",
      description: "Mark this referral as completed and provide your findings",
      buttonLabel: "Complete Referral",
      buttonClass: "bg-[oklch(0.70_0.17_155)] hover:bg-[oklch(0.65_0.17_155)] text-white",
      notesLabel: "Specialist Notes *",
      notesPlaceholder:
        "Document your findings, diagnosis, treatment plan, and any procedures performed...",
    },
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading referrals...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">
            Referral Inbox
          </h1>
          <p className="text-muted-foreground mt-1">
            Review and manage referrals sent to your department
          </p>
        </div>
        <span className="badge-chronicle-amber text-base px-3 py-1">
          {filteredReferrals.length} Referrals
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by patient name, MRN, referral number, or reason..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-card border-border"
        />
      </div>

      {/* Referrals List */}
      {filteredReferrals.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Stethoscope className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-heading font-medium">No referrals found</p>
              <p className="text-sm mt-1">
                {searchQuery
                  ? "Try adjusting your search"
                  : "Referrals will appear here when sent to your department"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredReferrals.map((referral) => {
            const status = statusConfig[referral.status] || statusConfig.draft;
            const urgency = urgencyConfig[referral.urgency] || urgencyConfig.routine;
            const UrgencyIcon = urgency.icon;

            return (
              <Card key={referral.id} className="bg-card border-border animate-chronicle-enter">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <CardTitle className="font-heading text-lg text-foreground">
                          Referral #{referral.referral_number}
                        </CardTitle>
                        <span className={cn("text-xs px-2 py-0.5 rounded-full", status.badgeClass)}>
                          {status.label}
                        </span>
                        <span className={cn("gap-1 inline-flex items-center text-xs px-2 py-0.5 rounded-full", urgency.badgeClass)}>
                          <UrgencyIcon className="h-3 w-3" />
                          {urgency.label}
                        </span>
                      </div>
                      <CardDescription className="space-y-1">
                        <div className="flex items-center gap-4 flex-wrap text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {referral.patient_details?.first_name}{" "}
                            {referral.patient_details?.last_name}
                          </span>
                          {referral.patient_details?.medical_record_number && (
                            <span className="font-mono">
                              MRN: {referral.patient_details.medical_record_number}
                            </span>
                          )}
                          {referral.created_at && (
                            <span className="flex items-center gap-1 font-mono text-xs">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(referral.created_at), "MMM dd, yyyy")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                          <Building2 className="h-3 w-3" />
                          <span className="capitalize">
                            {referral.referred_to_department?.replace(/_/g, " ")}
                          </span>
                          {referral.referred_to_specialty && referral.referred_to_specialty !== referral.referred_to_department && (
                            <span className="opacity-60">
                              • {referral.referred_to_specialty}
                            </span>
                          )}
                        </div>
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Referring Provider */}
                  {referral.referring_provider_details && (
                    <div className="bg-muted border border-border rounded-lg p-3">
                      <p className="text-xs font-heading font-medium text-muted-foreground mb-1">
                        Referring Provider:
                      </p>
                      <p className="text-sm text-foreground">
                        Dr. {referral.referring_provider_details.first_name}{" "}
                        {referral.referring_provider_details.last_name}
                      </p>
                    </div>
                  )}

                  {/* Reason */}
                  <div>
                    <p className="text-sm font-heading font-medium text-foreground mb-1 flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      Reason for Referral:
                    </p>
                    <p className="text-sm text-muted-foreground">{referral.reason}</p>
                  </div>

                  {/* Clinical Summary */}
                  {referral.clinical_summary && (
                    <div>
                      <p className="text-sm font-heading font-medium text-foreground mb-1">
                        Clinical Summary:
                      </p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {referral.clinical_summary}
                      </p>
                    </div>
                  )}

                  {/* Acceptance Notes */}
                  {referral.acceptance_notes && (
                    <div className="bg-[oklch(0.70_0.17_155_/_0.1)] border border-[oklch(0.70_0.17_155_/_0.3)] rounded-lg p-3">
                      <p className="text-xs font-heading font-medium text-[oklch(0.70_0.17_155)] mb-1">
                        Acceptance Notes:
                      </p>
                      <p className="text-sm text-foreground">
                        {referral.acceptance_notes}
                      </p>
                    </div>
                  )}

                  {/* Decline Reason */}
                  {referral.decline_reason && (
                    <div className="bg-[oklch(0.65_0.22_15_/_0.1)] border border-[oklch(0.65_0.22_15_/_0.3)] rounded-lg p-3">
                      <p className="text-xs font-heading font-medium text-[oklch(0.65_0.22_15)] mb-1">
                        Decline Reason:
                      </p>
                      <p className="text-sm text-foreground">{referral.decline_reason}</p>
                    </div>
                  )}

                  {/* Specialist Notes */}
                  {referral.specialist_notes && (
                    <div className="bg-[oklch(0.70_0.15_230_/_0.1)] border border-[oklch(0.70_0.15_230_/_0.3)] rounded-lg p-3">
                      <p className="text-xs font-heading font-medium text-[oklch(0.70_0.15_230)] mb-1">
                        Specialist Notes:
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {referral.specialist_notes}
                      </p>
                    </div>
                  )}

                  {/* Recommendations */}
                  {referral.recommendations && (
                    <div className="bg-[oklch(0.70_0.15_230_/_0.1)] border border-[oklch(0.70_0.15_230_/_0.3)] rounded-lg p-3">
                      <p className="text-xs font-heading font-medium text-[oklch(0.70_0.15_230)] mb-1">
                        Recommendations:
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {referral.recommendations}
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 flex-wrap">
                    {referral.status === "pending" && (
                      <>
                        <Button
                          onClick={() => handleActionClick(referral, "accept")}
                          className="bg-[oklch(0.70_0.17_155)] hover:bg-[oklch(0.65_0.17_155)] text-white font-mono text-xs"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Accept
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleActionClick(referral, "decline")}
                          className="border-[oklch(0.65_0.22_15_/_0.5)] text-[oklch(0.65_0.22_15)] hover:bg-[oklch(0.65_0.22_15_/_0.1)] font-mono text-xs"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Decline
                        </Button>
                      </>
                    )}
                    {referral.status === "accepted" && (
                      <>
                        {/* Path B: Full Consultation */}
                        <Button
                          onClick={() => handleStartConsultation(referral)}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground font-mono text-xs"
                        >
                          <PlayCircle className="h-4 w-4 mr-2" />
                          Start Consultation
                        </Button>
                        {/* Path A: Quick Response */}
                        <Button
                          variant="outline"
                          onClick={() => handleActionClick(referral, "complete")}
                          className="font-mono text-xs"
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Quick Response
                        </Button>
                      </>
                    )}
                    {referral.status === "scheduled" && (
                      <>
                        {/* View patient and complete referral */}
                        <Button
                          onClick={() => handleStartConsultation(referral)}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground font-mono text-xs"
                        >
                          <Stethoscope className="h-4 w-4 mr-2" />
                          View Patient
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleActionClick(referral, "complete")}
                          className="font-mono text-xs"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Complete Referral
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Action Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent className="max-w-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{actionConfig[currentAction]?.title}</DialogTitle>
            <DialogDescription>
              {actionConfig[currentAction]?.description}
            </DialogDescription>
          </DialogHeader>

          {selectedReferral && (
            <div className="py-4 space-y-4">
              {/* Referral Info */}
              <div className="bg-muted border border-border rounded-lg p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Referral Number:</span>
                    <span className="font-mono font-semibold text-foreground">
                      #{selectedReferral.referral_number}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Patient:</span>
                    <span className="font-semibold text-foreground">
                      {selectedReferral.patient_details?.first_name}{" "}
                      {selectedReferral.patient_details?.last_name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Reason:</span>
                    <span className="font-semibold text-foreground">
                      {selectedReferral.reason}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="action_notes" className="font-heading">
                  {actionConfig[currentAction]?.notesLabel}
                </Label>
                <Textarea
                  id="action_notes"
                  placeholder={actionConfig[currentAction]?.notesPlaceholder}
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  className="min-h-[120px] bg-background border-border"
                />
              </div>

              {/* Recommendations (for complete action) */}
              {currentAction === "complete" && (
                <div className="space-y-2">
                  <Label htmlFor="recommendations" className="font-heading">
                    Recommendations for Referring Provider (Optional)
                  </Label>
                  <Textarea
                    id="recommendations"
                    placeholder="Follow-up care, medication adjustments, further testing needed, etc..."
                    value={recommendations}
                    onChange={(e) => setRecommendations(e.target.value)}
                    className="min-h-[100px] bg-background border-border"
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActionDialogOpen(false)}
              disabled={
                acceptReferral.isPending ||
                declineReferral.isPending ||
                completeReferral.isPending
              }
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleActionSubmit}
              disabled={
                acceptReferral.isPending ||
                declineReferral.isPending ||
                completeReferral.isPending
              }
              className={cn("font-mono text-xs", actionConfig[currentAction]?.buttonClass)}
            >
              {acceptReferral.isPending ||
              declineReferral.isPending ||
              completeReferral.isPending
                ? "Processing..."
                : actionConfig[currentAction]?.buttonLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReferralInbox;
