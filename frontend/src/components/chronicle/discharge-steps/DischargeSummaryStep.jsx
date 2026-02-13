import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const DischargeSummaryStep = ({ formData = {}, onChange, validationErrors = {}, allFormData = {} }) => {
  const setField = (field, value) => {
    onChange({
      ...formData,
      [field]: value,
    });
  };

  const prescriptionCount = (allFormData?.medications?.discharge_prescriptions || []).length;

  return (
    <div className="space-y-4">
      <Card className={cn(validationErrors.discharge_summary && 'border-destructive')}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Discharge Summary <span className="text-destructive">*</span>
          </CardTitle>
          <CardDescription>
            Capture hospital course, key findings, medication plan, and follow-up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <Textarea
            value={formData.discharge_summary || ''}
            onChange={(event) => setField('discharge_summary', event.target.value)}
            placeholder="Hospital course, procedures, final diagnosis, discharge condition, medication plan, follow-up..."
            rows={10}
            className={cn('font-mono text-sm', validationErrors.discharge_summary && 'border-destructive')}
          />
          {validationErrors.discharge_summary && (
            <p className="text-xs text-destructive">{validationErrors.discharge_summary}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Completion Checklist
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={formData.patient_education_complete === true}
              onCheckedChange={(checked) => setField('patient_education_complete', checked === true)}
            />
            <span>
              Patient/family education completed <span className="text-destructive">*</span>
            </span>
          </label>
          {validationErrors.patient_education_complete && (
            <p className="text-xs text-destructive">{validationErrors.patient_education_complete}</p>
          )}

          <label className="flex items-start gap-2">
            <Checkbox
              checked={formData.discharge_instructions_given === true}
              onCheckedChange={(checked) => setField('discharge_instructions_given', checked === true)}
            />
            <span>
              Written instructions provided <span className="text-destructive">*</span>
            </span>
          </label>
          {validationErrors.discharge_instructions_given && (
            <p className="text-xs text-destructive">{validationErrors.discharge_instructions_given}</p>
          )}

          <label className="flex items-start gap-2">
            <Checkbox
              checked={formData.prescriptions_sent === true}
              onCheckedChange={(checked) => setField('prescriptions_sent', checked === true)}
            />
            <span>
              Prescriptions sent to pharmacy
              {prescriptionCount > 0 && <span className="text-destructive"> *</span>}
            </span>
          </label>
          {validationErrors.prescriptions_sent && (
            <p className="text-xs text-destructive">{validationErrors.prescriptions_sent}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DischargeSummaryStep;
export { DischargeSummaryStep };
