import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { X, Send, AlertCircle, User, Building2, FileText, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreateReferral, useSubmitReferral } from "@/hooks/useReferralQueries";
import { toast } from "sonner";

/**
 * ReferralForm - Referral creation wizard
 *
 * Features:
 * - Department and specialty selection
 * - Urgency levels (routine, urgent, emergency)
 * - Clinical summary and reason
 * - Referring provider info
 * - Immediate submission workflow
 * - Chronicle design system styling
 */
const ReferralForm = ({ open, onClose, patient, encounter, onReferralCreated }) => {
  // Get patient and encounter IDs
  const patientId = patient?.local_data?.id || patient?.id;
  const encounterId = encounter?.local_data?.id || encounter?.id;

  // Form state
  const [formData, setFormData] = useState({
    department: "",
    specialty: "",
    urgency: "routine",
    reason: "",
  });

  const [errors, setErrors] = useState({});

  // API mutations
  const createReferral = useCreateReferral();
  const submitReferral = useSubmitReferral();

  // Reset form when panel closes
  useEffect(() => {
    if (!open) {
      setFormData({
        department: "",
        specialty: "",
        urgency: "routine",
        reason: "",
      });
      setErrors({});
    }
  }, [open]);

  // Department options
  const departments = [
    { value: "cardiology", label: "Cardiology" },
    { value: "dermatology", label: "Dermatology" },
    { value: "endocrinology", label: "Endocrinology" },
    { value: "gastroenterology", label: "Gastroenterology" },
    { value: "general_surgery", label: "General Surgery" },
    { value: "neurology", label: "Neurology" },
    { value: "obstetrics_gynecology", label: "Obstetrics & Gynecology" },
    { value: "oncology", label: "Oncology" },
    { value: "ophthalmology", label: "Ophthalmology" },
    { value: "orthopedics", label: "Orthopedics" },
    { value: "otolaryngology", label: "Otolaryngology (ENT)" },
    { value: "pediatrics", label: "Pediatrics" },
    { value: "psychiatry", label: "Psychiatry" },
    { value: "pulmonology", label: "Pulmonology" },
    { value: "radiology", label: "Radiology" },
    { value: "rheumatology", label: "Rheumatology" },
    { value: "urology", label: "Urology" },
  ];

  // Urgency config
  const urgencyConfig = {
    routine: {
      label: "Routine",
      color: "bg-muted text-muted-foreground",
      description: "Standard appointment within 2-4 weeks",
    },
    urgent: {
      label: "Urgent",
      color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
      description: "Needs to be seen within 1 week",
    },
    emergency: {
      label: "Emergency",
      color: "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400",
      description: "Requires immediate attention within 24-48 hours",
    },
  };

  // Validation
  const validate = () => {
    const newErrors = {};

    if (!formData.department) {
      newErrors.department = "Department is required";
    }
    if (!formData.urgency) {
      newErrors.urgency = "Urgency level is required";
    }
    if (!formData.reason || formData.reason.trim() === "") {
      newErrors.reason = "Reason for referral is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Determine if this is an inpatient referral based on encounter type
  const isInpatientReferral = () => {
    const encounterType = encounter?.local_data?.encounter_type || encounter?.encounter_type;
    // Check if encounter is inpatient (admission, inpatient, etc.)
    if (encounterType) {
      const inpatientTypes = ['inpatient', 'admission', 'emergency', 'hospitalization'];
      return inpatientTypes.includes(encounterType.toLowerCase());
    }
    return false;
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!validate()) return;

    try {
      // Determine referral type based on encounter
      const referralType = isInpatientReferral() ? 'inpatient' : 'opd';

      // Create referral
      const referralData = {
        patient: patientId,
        encounter: encounterId || null,
        referred_to_department: formData.department,
        referred_to_specialty: formData.specialty || formData.department,
        urgency: formData.urgency,
        reason: formData.reason,
        referral_type: referralType,
      };

      const createdReferral = await createReferral.mutateAsync(referralData);

      // Submit referral immediately
      await submitReferral.mutateAsync(createdReferral.id);

      toast.success("Referral submitted", {
        description: `Referral #${createdReferral.referral_number} has been sent to ${formData.department}`,
      });

      if (onReferralCreated) {
        onReferralCreated(createdReferral);
      }

      onClose();
    } catch (error) {
      console.error("Error creating referral:", error);
      toast.error("Failed to create referral", {
        description: error.message || "Please try again",
      });
    }
  };

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.local_data?.first_name
    ? `${patient.local_data.first_name} ${patient.local_data.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
            <Send className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              Request Consult
            </h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName}
            </p>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="h-4 w-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-6">
          {/* Urgency Alert */}
          {formData.urgency === "emergency" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Emergency referrals require immediate attention. Please ensure all
                critical information is included and consider direct communication
                with the specialist.
              </AlertDescription>
            </Alert>
          )}

          {/* Department & Specialty */}
          <Card className="border-border">
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="department">
                  Department *
                  <Building2 className="inline h-3 w-3 ml-1 text-muted-foreground" />
                </Label>
                <Select
                  value={formData.department}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, department: value }))
                  }
                >
                  <SelectTrigger
                    className={cn(errors.department && "border-rose-500")}
                  >
                    <SelectValue placeholder="Select department..." />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {departments.map((dept) => (
                      <SelectItem key={dept.value} value={dept.value}>
                        {dept.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.department && (
                  <p className="text-sm text-rose-600">{errors.department}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="specialty">Specific Specialty (Optional)</Label>
                <Input
                  id="specialty"
                  placeholder="e.g., Interventional Cardiology, Pediatric Neurology"
                  value={formData.specialty}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, specialty: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  If different from department
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Urgency */}
          <Card className="border-border">
            <CardContent className="pt-6 space-y-3">
              <Label>
                Urgency Level *
                <Clock className="inline h-3 w-3 ml-1 text-muted-foreground" />
              </Label>
              <div className="space-y-2">
                {Object.entries(urgencyConfig).map(([key, config]) => (
                  <div
                    key={key}
                    className={cn(
                      "border-2 rounded-lg p-4 cursor-pointer transition-colors",
                      formData.urgency === key
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                        : "border-border hover:border-muted-foreground/50"
                    )}
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, urgency: key }))
                    }
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          checked={formData.urgency === key}
                          onChange={() =>
                            setFormData((prev) => ({ ...prev, urgency: key }))
                          }
                          className="mt-1"
                        />
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={config.color}>{config.label}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {config.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {errors.urgency && (
                <p className="text-sm text-rose-600">{errors.urgency}</p>
              )}
            </CardContent>
          </Card>

          {/* Reason for Referral */}
          <Card className="border-border">
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reason">
                  Reason for Referral *
                  <FileText className="inline h-3 w-3 ml-1 text-muted-foreground" />
                </Label>
                <Textarea
                  id="reason"
                  placeholder="Brief statement of why the patient needs specialist consultation (e.g., 'Evaluation of persistent chest pain', 'Management of uncontrolled diabetes')"
                  value={formData.reason}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, reason: e.target.value }))
                  }
                  className={cn(
                    "min-h-[100px]",
                    errors.reason && "border-rose-500"
                  )}
                />
                {errors.reason && (
                  <p className="text-sm text-rose-600">{errors.reason}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  The consulted specialist will have access to the patient's full chronicle.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Information Notice */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This referral will be sent to the {formData.department || "selected"}{" "}
              department for review. You will be notified when the specialist
              responds.
            </AlertDescription>
          </Alert>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card px-6 py-4 flex items-center justify-between">
        <Button variant="ghost" onClick={onClose} className="font-mono text-xs">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={createReferral.isPending || submitReferral.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 font-mono text-xs"
        >
          {createReferral.isPending || submitReferral.isPending ? (
            "Submitting..."
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Submit Referral
            </>
          )}
        </Button>
      </footer>
    </div>
  );
};

export default ReferralForm;
