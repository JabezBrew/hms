import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const DEFAULT_EMPTY_OBJECT = {};

const DischargeSummaryStep = ({ formData = DEFAULT_EMPTY_OBJECT, onChange, validationErrors = DEFAULT_EMPTY_OBJECT, allFormData = DEFAULT_EMPTY_OBJECT }) => {
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
            <FileText className="size-4" />
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
            <CheckCircle className="size-4" />
            Completion Checklist
          </CardTitle>
          <CardDescription>
            Billing and nursing clearance continue after medical discharge submission.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
	          <label htmlFor="discharge-patient-education-complete" className="flex items-start gap-2">
	            <Checkbox
	              id="discharge-patient-education-complete"
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

	          <label htmlFor="discharge-instructions-given" className="flex items-start gap-2">
	            <Checkbox
	              id="discharge-instructions-given"
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

          {prescriptionCount > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-950">
              {prescriptionCount} discharge prescription{prescriptionCount === 1 ? '' : 's'} will create an advisory pharmacy follow-up task automatically.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DischargeSummaryStep;
export { DischargeSummaryStep };
