import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * HistoryExamStep - Second step of consultation workflow
 * Captures chief complaint, HPI, ROS, and physical examination
 */
const HistoryExamStep = ({ formData, onChange, contextData, validationErrors }) => {
  const handleChange = (field, value) => {
    onChange({
      ...formData,
      [field]: value,
    });
  };

  return (
    <div className="space-y-4">
      {/* Chief Complaint */}
      <Card className={cn(validationErrors?.chief_complaint && "border-destructive")}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Chief Complaint <span className="text-destructive">*</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            value={formData?.chief_complaint || ""}
            onChange={(e) => handleChange("chief_complaint", e.target.value)}
            placeholder="Enter the patient's chief complaint..."
            className={cn(
              "font-mono text-sm",
              validationErrors?.chief_complaint && "border-destructive"
            )}
          />
          {validationErrors?.chief_complaint && (
            <p className="text-destructive text-xs mt-1">{validationErrors.chief_complaint}</p>
          )}
          <p className="text-muted-foreground text-xs mt-2">
            Brief statement of the patient's main concern
          </p>
        </CardContent>
      </Card>

      {/* History of Present Illness */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">History of Present Illness (HPI)</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData?.hpi || ""}
            onChange={(e) => handleChange("hpi", e.target.value)}
            placeholder="Document the history of the presenting problem..."
            rows={5}
            className="font-mono text-sm"
          />
          <p className="text-muted-foreground text-xs mt-2">
            Include onset, location, duration, character, aggravating/relieving factors, timing, severity
          </p>
        </CardContent>
      </Card>

      {/* Review of Systems */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Review of Systems (ROS)</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData?.ros || ""}
            onChange={(e) => handleChange("ros", e.target.value)}
            placeholder="Document review of systems..."
            rows={4}
            className="font-mono text-sm"
          />
          <p className="text-muted-foreground text-xs mt-2">
            Systematic review of body systems (constitutional, eyes, ENT, cardiovascular, etc.)
          </p>
        </CardContent>
      </Card>

      {/* Physical Examination */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Physical Examination</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData?.physical_exam || ""}
            onChange={(e) => handleChange("physical_exam", e.target.value)}
            placeholder="Document physical examination findings..."
            rows={5}
            className="font-mono text-sm"
          />
          <p className="text-muted-foreground text-xs mt-2">
            Include vital signs and relevant physical findings
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default HistoryExamStep;
export { HistoryExamStep };
