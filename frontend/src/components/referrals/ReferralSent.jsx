import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  User,
  Calendar,
  Clock,
  Building2,
  FileText,
  Search,
  AlertCircle,
  Send,
  Eye,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useReferralsSent } from "@/hooks/useReferralQueries";

/**
 * ReferralSent - Track referrals sent by current user
 *
 * Features:
 * - List of sent referrals with status tracking
 * - Filter by patient or department
 * - View detailed referral information
 * - Status indicators (pending, accepted, declined, completed)
 * - Specialist responses and recommendations
 * - Chronicle design system styling
 */
const ReferralSent = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  // API query
  const { data: sentData, isLoading } = useReferralsSent();

  // Filter referrals by search
  const filteredReferrals = (sentData?.results || []).filter((referral) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    const patientName =
      `${referral.patient_details?.first_name} ${referral.patient_details?.last_name}`.toLowerCase();
    const mrn = referral.patient_details?.medical_record_number?.toLowerCase() || "";
    const referralNumber = referral.referral_number?.toLowerCase() || "";
    const department = referral.department?.toLowerCase() || "";
    const reason = referral.reason?.toLowerCase() || "";

    return (
      patientName.includes(query) ||
      mrn.includes(query) ||
      referralNumber.includes(query) ||
      department.includes(query) ||
      reason.includes(query)
    );
  });

  // Handle view details
  const handleViewDetails = (referral) => {
    setSelectedReferral(referral);
    setDetailDialogOpen(true);
  };

  // Status config
  const statusConfig = {
    draft: {
      label: "Draft",
      color: "bg-stone-100 text-stone-700",
      icon: FileText,
      description: "Not yet submitted",
    },
    submitted: {
      label: "Pending Review",
      color: "bg-sky-100 text-sky-700",
      icon: Clock,
      description: "Waiting for specialist response",
    },
    accepted: {
      label: "Accepted",
      color: "bg-emerald-100 text-emerald-700",
      icon: CheckCircle,
      description: "Specialist has accepted",
    },
    declined: {
      label: "Declined",
      color: "bg-rose-100 text-rose-700",
      icon: XCircle,
      description: "Specialist declined",
    },
    scheduled: {
      label: "Scheduled",
      color: "bg-violet-100 text-violet-700",
      icon: Calendar,
      description: "Appointment scheduled",
    },
    completed: {
      label: "Completed",
      color: "bg-emerald-100 text-emerald-700",
      icon: CheckCircle,
      description: "Consultation completed",
    },
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

  // Get status counts
  const statusCounts = (sentData?.results || []).reduce((acc, referral) => {
    acc[referral.status] = (acc[referral.status] || 0) + 1;
    return acc;
  }, {});

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
            Sent Referrals
          </h1>
          <p className="text-stone-600 mt-1">
            Track the status of referrals you've sent to specialists
          </p>
        </div>
        <Badge className="text-base px-3 py-1">
          {filteredReferrals.length} Referrals
        </Badge>
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Object.entries(statusConfig).map(([status, config]) => {
          const count = statusCounts[status] || 0;
          return (
            <Card key={status} className="border-stone-200">
              <CardContent className="pt-4 pb-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-stone-900 mb-1">
                    {count}
                  </div>
                  <Badge variant="outline" className={cn("text-xs", config.color)}>
                    {config.label}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-stone-400" />
        <Input
          placeholder="Search by patient name, MRN, department, or reason..."
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
              <Send className="h-12 w-12 mx-auto mb-3 text-stone-300" />
              <p className="font-medium">No referrals found</p>
              <p className="text-sm mt-1">
                {searchQuery
                  ? "Try adjusting your search"
                  : "Referrals you send will appear here"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredReferrals.map((referral) => {
            const status = statusConfig[referral.status];
            const urgency = urgencyConfig[referral.urgency];
            const StatusIcon = status.icon;
            const UrgencyIcon = urgency.icon;

            return (
              <Card key={referral.id} className="border-stone-200">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <CardTitle className="text-lg font-heading">
                          Referral #{referral.referral_number}
                        </CardTitle>
                        <Badge className={cn("gap-1", status.color)}>
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </Badge>
                        <Badge className={cn("gap-1", urgency.color)}>
                          <UrgencyIcon className="h-3 w-3" />
                          {urgency.label}
                        </Badge>
                      </div>
                      <CardDescription className="space-y-1">
                        <div className="flex items-center gap-4 flex-wrap">
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
                        <div className="flex items-center gap-2">
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewDetails(referral)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Details
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Reason */}
                  <div>
                    <p className="text-sm font-medium text-stone-700 mb-1 flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      Reason:
                    </p>
                    <p className="text-sm text-stone-900">{referral.reason}</p>
                  </div>

                  {/* Status-specific messages */}
                  {referral.status === "submitted" && (
                    <div className="bg-sky-50 border border-sky-200 rounded-lg p-3">
                      <p className="text-xs text-sky-700">
                        <Clock className="inline h-3 w-3 mr-1" />
                        Awaiting specialist response
                      </p>
                    </div>
                  )}

                  {referral.status === "accepted" && referral.acceptance_notes && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-emerald-700 mb-1">
                        Specialist Response:
                      </p>
                      <p className="text-sm text-emerald-900">
                        {referral.acceptance_notes}
                      </p>
                    </div>
                  )}

                  {referral.status === "declined" && referral.decline_reason && (
                    <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-rose-700 mb-1">
                        Decline Reason:
                      </p>
                      <p className="text-sm text-rose-900">{referral.decline_reason}</p>
                    </div>
                  )}

                  {referral.status === "completed" && (
                    <div className="space-y-2">
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
                    </div>
                  )}

                  {/* Last Updated */}
                  <div className="text-xs text-stone-500">
                    Last updated: {format(new Date(referral.updated_at), "MMM dd, yyyy HH:mm")}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Referral #{selectedReferral?.referral_number}
            </DialogTitle>
            <DialogDescription>
              Complete referral details and specialist responses
            </DialogDescription>
          </DialogHeader>

          {selectedReferral && (
            <div className="space-y-6 py-4">
              {/* Status & Urgency */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={statusConfig[selectedReferral.status]?.color}>
                  {statusConfig[selectedReferral.status]?.label}
                </Badge>
                <Badge className={urgencyConfig[selectedReferral.urgency]?.color}>
                  {urgencyConfig[selectedReferral.urgency]?.label}
                </Badge>
              </div>

              {/* Patient Info */}
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
                <h3 className="font-heading font-semibold text-stone-900 mb-3">
                  Patient Information
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-600">Name:</span>
                    <span className="font-semibold text-stone-900">
                      {selectedReferral.patient_details?.first_name}{" "}
                      {selectedReferral.patient_details?.last_name}
                    </span>
                  </div>
                  {selectedReferral.patient_details?.medical_record_number && (
                    <div className="flex items-center justify-between">
                      <span className="text-stone-600">MRN:</span>
                      <span className="font-mono text-stone-900">
                        {selectedReferral.patient_details.medical_record_number}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-stone-600">Department:</span>
                    <span className="capitalize text-stone-900">
                      {selectedReferral.department?.replace(/_/g, " ")}
                    </span>
                  </div>
                  {selectedReferral.specialty && (
                    <div className="flex items-center justify-between">
                      <span className="text-stone-600">Specialty:</span>
                      <span className="text-stone-900">{selectedReferral.specialty}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Referral Details */}
              <div>
                <h3 className="font-heading font-semibold text-stone-900 mb-3">
                  Referral Details
                </h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-stone-700 mb-1">
                      Reason for Referral:
                    </p>
                    <p className="text-sm text-stone-900">{selectedReferral.reason}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-stone-700 mb-1">
                      Clinical Summary:
                    </p>
                    <p className="text-sm text-stone-900 whitespace-pre-wrap">
                      {selectedReferral.clinical_summary}
                    </p>
                  </div>
                  {selectedReferral.relevant_history && (
                    <div>
                      <p className="text-sm font-medium text-stone-700 mb-1">
                        Relevant Medical History:
                      </p>
                      <p className="text-sm text-stone-900 whitespace-pre-wrap">
                        {selectedReferral.relevant_history}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Specialist Response */}
              {(selectedReferral.acceptance_notes ||
                selectedReferral.decline_reason ||
                selectedReferral.specialist_notes) && (
                <div>
                  <h3 className="font-heading font-semibold text-stone-900 mb-3">
                    Specialist Response
                  </h3>
                  <div className="space-y-3">
                    {selectedReferral.acceptance_notes && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                        <p className="text-sm font-medium text-emerald-700 mb-2">
                          Acceptance Notes:
                        </p>
                        <p className="text-sm text-emerald-900">
                          {selectedReferral.acceptance_notes}
                        </p>
                      </div>
                    )}
                    {selectedReferral.decline_reason && (
                      <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
                        <p className="text-sm font-medium text-rose-700 mb-2">
                          Decline Reason:
                        </p>
                        <p className="text-sm text-rose-900">
                          {selectedReferral.decline_reason}
                        </p>
                      </div>
                    )}
                    {selectedReferral.specialist_notes && (
                      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
                        <p className="text-sm font-medium text-violet-700 mb-2">
                          Specialist Notes:
                        </p>
                        <p className="text-sm text-violet-900 whitespace-pre-wrap">
                          {selectedReferral.specialist_notes}
                        </p>
                      </div>
                    )}
                    {selectedReferral.recommendations && (
                      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
                        <p className="text-sm font-medium text-violet-700 mb-2">
                          Recommendations:
                        </p>
                        <p className="text-sm text-violet-900 whitespace-pre-wrap">
                          {selectedReferral.recommendations}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
                <h3 className="font-heading font-semibold text-stone-900 mb-3">
                  Timeline
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-600">Created:</span>
                    <span className="text-stone-900">
                      {format(new Date(selectedReferral.created_at), "MMM dd, yyyy HH:mm")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-stone-600">Last Updated:</span>
                    <span className="text-stone-900">
                      {format(new Date(selectedReferral.updated_at), "MMM dd, yyyy HH:mm")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReferralSent;
