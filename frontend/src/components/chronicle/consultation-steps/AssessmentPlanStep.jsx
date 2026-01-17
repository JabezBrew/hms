import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * AssessmentPlanStep - Final step of consultation workflow
 * Captures assessment/diagnosis and treatment plan
 */
const AssessmentPlanStep = ({ formData, onChange, contextData, validationErrors, allFormData }) => {
  const handleChange = (field, value) => {
    onChange({
      ...formData,
      [field]: value,
    });
  };

  // Get data from previous step for summary
  const historyData = allFormData?.history_exam || {};

  return (
    <div className="space-y-4">
      {/* Summary of what was documented */}
      {historyData.chief_complaint && (
        <Alert className="bg-muted/50">
          <Lightbulb className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1 text-sm">
              <p>
                <span className="font-medium">Chief Complaint:</span>{" "}
                {historyData.chief_complaint}
              </p>
              {historyData.hpi && (
                <p className="text-muted-foreground truncate">
                  <span className="font-medium">HPI:</span>{" "}
                  {historyData.hpi.substring(0, 100)}
                  {historyData.hpi.length > 100 ? "..." : ""}
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Assessment */}
      <Card className={cn(validationErrors?.assessment && "border-destructive")}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Assessment <span className="text-destructive">*</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Your clinical assessment and differential diagnosis
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData?.assessment || ""}
            onChange={(e) => handleChange("assessment", e.target.value)}
            placeholder="Document your assessment and diagnosis..."
            rows={6}
            className={cn(
              "font-mono text-sm",
              validationErrors?.assessment && "border-destructive"
            )}
          />
          {validationErrors?.assessment && (
            <p className="text-destructive text-xs mt-1">{validationErrors.assessment}</p>
          )}
          <p className="text-muted-foreground text-xs mt-2">
            Include primary diagnosis, differential diagnoses, and clinical reasoning
          </p>
        </CardContent>
      </Card>

      {/* Plan */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Plan</CardTitle>
          <CardDescription className="text-xs">
            Treatment plan and next steps
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData?.plan || ""}
            onChange={(e) => handleChange("plan", e.target.value)}
            placeholder="Document treatment plan, orders, follow-up instructions..."
            rows={6}
            className="font-mono text-sm"
          />
          <p className="text-muted-foreground text-xs mt-2">
            Include medications, diagnostic tests, referrals, patient education, and follow-up
          </p>
        </CardContent>
      </Card>

      {/* Follow-up */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Follow-up</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData?.follow_up || ""}
            onChange={(e) => handleChange("follow_up", e.target.value)}
            placeholder="Document follow-up instructions and timeline..."
            rows={3}
            className="font-mono text-sm"
          />
        </CardContent>
      </Card>

      {/* Instructions */}
      <div className="rounded-lg border p-3 bg-muted/30">
        <p className="text-xs font-medium mb-1">Ready to Complete:</p>
        <ul className="text-xs text-muted-foreground space-y-0.5">
          <li>- Review your assessment and plan</li>
          <li>- Ensure all required information is documented</li>
          <li>- Click "Complete Consultation" to finalize</li>
        </ul>
      </div>
    </div>
  );
};

export default AssessmentPlanStep;
export { AssessmentPlanStep };
