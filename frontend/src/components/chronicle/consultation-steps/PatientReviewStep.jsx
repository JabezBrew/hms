import User from 'lucide-react/dist/esm/icons/user.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle.js';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * PatientReviewStep - First step of consultation workflow
 * Displays patient context, referral info, and clinical history
 * No user input required - just review
 */
const PatientReviewStep = ({ formData, onChange, contextData }) => {
  const prepData = contextData?.prep_data || {};

  return (
    <div className="space-y-4">
      {/* Patient Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Patient Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Name</p>
              <p className="font-medium">{prepData.patient_name || "Unknown"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">MRN</p>
              <p className="font-mono">{prepData.medical_record_number || "N/A"}</p>
            </div>
            {prepData.age && (
              <div>
                <p className="text-muted-foreground text-xs">Age</p>
                <p className="font-medium">{prepData.age}</p>
              </div>
            )}
            {prepData.gender && (
              <div>
                <p className="text-muted-foreground text-xs">Gender</p>
                <p className="font-medium">{prepData.gender}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Referral Context */}
      {prepData.referral && (
        <Card className="border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-900/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-sky-700 dark:text-sky-400">
              <Send className="h-4 w-4" />
              Referral Details
              <Badge
                variant="secondary"
                className="ml-2 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 text-[10px]"
              >
                {prepData.referral.referral_number}
              </Badge>
              {prepData.referral.urgency && prepData.referral.urgency !== "routine" && (
                <Badge
                  variant={prepData.referral.urgency === "emergency" ? "destructive" : "warning"}
                  className="text-[10px]"
                >
                  {prepData.referral.urgency.toUpperCase()}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-muted-foreground text-xs">Referring Doctor</p>
                <p className="font-medium">{prepData.referral.referring_doctor || "Unknown"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Department</p>
                <p className="font-medium">{prepData.referral.referring_department || "Unknown"}</p>
              </div>
            </div>

            {prepData.referral.reason && (
              <div>
                <p className="text-muted-foreground text-xs mb-1">Reason for Referral</p>
                <div className="p-2 bg-background rounded border text-sm">
                  {prepData.referral.reason}
                </div>
              </div>
            )}

            {prepData.referral.clinical_summary && (
              <div>
                <p className="text-muted-foreground text-xs mb-1">Clinical Summary</p>
                <div className="p-2 bg-background rounded border text-sm whitespace-pre-wrap">
                  {prepData.referral.clinical_summary}
                </div>
              </div>
            )}

            {prepData.referral.questions && (
              <div>
                <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  Questions to Address
                </p>
                <div className="p-2 bg-amber-50 dark:bg-amber-900/10 rounded border border-amber-200 dark:border-amber-800 text-sm whitespace-pre-wrap">
                  {prepData.referral.questions}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Alerts */}
      {prepData.alerts && prepData.alerts.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              Clinical Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {prepData.alerts.map((alert, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-900/10 rounded text-sm"
                >
                  <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5 shrink-0" />
                  <span>{alert}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Problems */}
      {prepData.active_problems && prepData.active_problems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Active Problems
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {prepData.active_problems.map((problem, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-muted-foreground">-</span>
                  <span>{problem}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Current Medications */}
      {prepData.current_medications && prepData.current_medications.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Pill className="h-4 w-4" />
              Current Medications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {prepData.current_medications.map((med, index) => (
                <div key={index} className="p-2 border rounded text-sm">
                  <p className="font-medium">{med.name}</p>
                  {med.dose && <p className="text-muted-foreground text-xs">{med.dose}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Last Visit */}
      {prepData.last_visit && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4" />
              Last Visit
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-muted-foreground text-xs">Date</p>
            <p className="font-medium mb-2">{prepData.last_visit.date}</p>
            {prepData.last_visit.summary && (
              <>
                <p className="text-muted-foreground text-xs">Summary</p>
                <p>{prepData.last_visit.summary}</p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info message */}
      <div className="text-xs text-muted-foreground text-center py-2">
        Review the patient information above, then click Next to begin documentation.
      </div>
    </div>
  );
};

export default PatientReviewStep;
export { PatientReviewStep };
