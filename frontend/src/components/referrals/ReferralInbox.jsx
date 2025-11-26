import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
 *
 * Features:
 * - List of received referrals with filtering
 * - Accept/decline workflow
 * - Complete referral with specialist notes
 * - Status badges and priority indicators
 * - Patient and clinical information display
 * - Chronicle design system styling
 */
const ReferralInbox = () => {
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

  // Filter referrals by search
  const filteredReferrals = (inboxData?.results || []).filter((referral) => {
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

  // Status config
  const statusConfig = {
    draft: { label: "Draft", color: "bg-stone-100 text-stone-700" },
    submitted: { label: "Pending Review", color: "bg-sky-100 text-sky-700" },
    accepted: { label: "Accepted", color: "bg-emerald-100 text-emerald-700" },
    declined: { label: "Declined", color: "bg-rose-100 text-rose-700" },
    scheduled: { label: "Scheduled", color: "bg-violet-100 text-violet-700" },
    completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700" },
  };

  // Urgency config
  const urgencyConfig = {
    routine: {
      label: "Routine",
      color: "bg-stone-100 text-stone-700",
      icon: Clock,
    },
    urgent: {
      label: "Urgent",
      color: "bg-amber-100 text-amber-700",
      icon: AlertCircle,
    },
    emergency: {
      label: "Emergency",
      color: "bg-rose-100 text-rose-700",
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
      buttonClass: "bg-emerald-600 hover:bg-emerald-700",
      notesLabel: "Acceptance Notes (Optional)",
      notesPlaceholder:
        "Add notes about scheduling, what the patient should bring, or any pre-visit instructions...",
    },
    decline: {
      title: "Decline Referral",
      description: "Decline this referral and provide a reason",
      buttonLabel: "Decline Referral",
      buttonClass: "bg-rose-600 hover:bg-rose-700",
      notesLabel: "Reason for Declining *",
      notesPlaceholder:
        "Provide a clear reason for declining (e.g., patient needs different specialty, insufficient information, not appropriate for referral)...",
    },
    complete: {
      title: "Complete Referral",
      description: "Mark this referral as completed and provide your findings",
      buttonLabel: "Complete Referral",
      buttonClass: "bg-emerald-600 hover:bg-emerald-700",
      notesLabel: "Specialist Notes *",
      notesPlaceholder:
        "Document your findings, diagnosis, treatment plan, and any procedures performed...",
    },
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-stone-500">Loading referrals...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-stone-900">
            Referral Inbox
          </h1>
          <p className="text-stone-600 mt-1">
            Review and manage referrals sent to your department
          </p>
        </div>
        <Badge className="text-base px-3 py-1">
          {filteredReferrals.length} Referrals
        </Badge>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-stone-400" />
        <Input
          placeholder="Search by patient name, MRN, referral number, or reason..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Referrals List */}
      {filteredReferrals.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-stone-500">
              <Stethoscope className="h-12 w-12 mx-auto mb-3 text-stone-300" />
              <p className="font-medium">No referrals found</p>
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
            const status = statusConfig[referral.status];
            const urgency = urgencyConfig[referral.urgency];
            const UrgencyIcon = urgency.icon;

            return (
              <Card key={referral.id} className="border-stone-200">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-lg font-heading">
                          Referral #{referral.referral_number}
                        </CardTitle>
                        <Badge className={status.color}>{status.label}</Badge>
                        <Badge className={cn("gap-1", urgency.color)}>
                          <UrgencyIcon className="h-3 w-3" />
                          {urgency.label}
                        </Badge>
                      </div>
                      <CardDescription className="space-y-1">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {referral.patient_details?.first_name}{" "}
                            {referral.patient_details?.last_name}
                          </span>
                          {referral.patient_details?.medical_record_number && (
                            <span className="font-mono text-stone-500">
                              MRN: {referral.patient_details.medical_record_number}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(referral.created_at), "MMM dd, yyyy")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Building2 className="h-3 w-3" />
                          <span className="capitalize">
                            {referral.department?.replace(/_/g, " ")}
                          </span>
                          {referral.specialty && referral.specialty !== referral.department && (
                            <span className="text-stone-400">
                              • {referral.specialty}
                            </span>
                          )}
                        </div>
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Referring Provider */}
                  {referral.referring_provider && (
                    <div className="bg-stone-50 border border-stone-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-stone-700 mb-1">
                        Referring Provider:
                      </p>
                      <p className="text-sm text-stone-900">
                        Dr. {referral.referring_provider.first_name}{" "}
                        {referral.referring_provider.last_name}
                      </p>
                    </div>
                  )}

                  {/* Reason */}
                  <div>
                    <p className="text-sm font-medium text-stone-700 mb-1 flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      Reason for Referral:
                    </p>
                    <p className="text-sm text-stone-900">{referral.reason}</p>
                  </div>

                  {/* Clinical Summary */}
                  <div>
                    <p className="text-sm font-medium text-stone-700 mb-1">
                      Clinical Summary:
                    </p>
                    <p className="text-sm text-stone-900 whitespace-pre-wrap">
                      {referral.clinical_summary}
                    </p>
                  </div>

                  {/* Relevant History */}
                  {referral.relevant_history && (
                    <div>
                      <p className="text-sm font-medium text-stone-700 mb-1">
                        Relevant Medical History:
                      </p>
                      <p className="text-sm text-stone-900 whitespace-pre-wrap">
                        {referral.relevant_history}
                      </p>
                    </div>
                  )}

                  {/* Acceptance Notes */}
                  {referral.acceptance_notes && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-emerald-700 mb-1">
                        Acceptance Notes:
                      </p>
                      <p className="text-sm text-emerald-900">
                        {referral.acceptance_notes}
                      </p>
                    </div>
                  )}

                  {/* Decline Reason */}
                  {referral.decline_reason && (
                    <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-rose-700 mb-1">
                        Decline Reason:
                      </p>
                      <p className="text-sm text-rose-900">{referral.decline_reason}</p>
                    </div>
                  )}

                  {/* Specialist Notes */}
                  {referral.specialist_notes && (
                    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-violet-700 mb-1">
                        Specialist Notes:
                      </p>
                      <p className="text-sm text-violet-900 whitespace-pre-wrap">
                        {referral.specialist_notes}
                      </p>
                    </div>
                  )}

                  {/* Recommendations */}
                  {referral.recommendations && (
                    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-violet-700 mb-1">
                        Recommendations:
                      </p>
                      <p className="text-sm text-violet-900 whitespace-pre-wrap">
                        {referral.recommendations}
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2">
                    {referral.status === "submitted" && (
                      <>
                        <Button
                          onClick={() => handleActionClick(referral, "accept")}
                          className="bg-emerald-600 hover:bg-emerald-700"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Accept
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleActionClick(referral, "decline")}
                          className="border-rose-300 text-rose-700 hover:bg-rose-50"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Decline
                        </Button>
                      </>
                    )}
                    {(referral.status === "accepted" ||
                      referral.status === "scheduled") && (
                      <Button
                        onClick={() => handleActionClick(referral, "complete")}
                        className="bg-violet-600 hover:bg-violet-700"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Complete Referral
                      </Button>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{actionConfig[currentAction]?.title}</DialogTitle>
            <DialogDescription>
              {actionConfig[currentAction]?.description}
            </DialogDescription>
          </DialogHeader>

          {selectedReferral && (
            <div className="py-4 space-y-4">
              {/* Referral Info */}
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-600">Referral Number:</span>
                    <span className="font-semibold text-stone-900">
                      #{selectedReferral.referral_number}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-stone-600">Patient:</span>
                    <span className="font-semibold text-stone-900">
                      {selectedReferral.patient_details?.first_name}{" "}
                      {selectedReferral.patient_details?.last_name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-stone-600">Reason:</span>
                    <span className="font-semibold text-stone-900">
                      {selectedReferral.reason}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="action_notes">
                  {actionConfig[currentAction]?.notesLabel}
                </Label>
                <Textarea
                  id="action_notes"
                  placeholder={actionConfig[currentAction]?.notesPlaceholder}
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>

              {/* Recommendations (for complete action) */}
              {currentAction === "complete" && (
                <div className="space-y-2">
                  <Label htmlFor="recommendations">
                    Recommendations for Referring Provider (Optional)
                  </Label>
                  <Textarea
                    id="recommendations"
                    placeholder="Follow-up care, medication adjustments, further testing needed, etc..."
                    value={recommendations}
                    onChange={(e) => setRecommendations(e.target.value)}
                    className="min-h-[100px]"
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
              className={actionConfig[currentAction]?.buttonClass}
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
