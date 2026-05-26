import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const DEFAULT_EMPTY_OBJECT = {};

const DischargeInstructionsStep = ({ formData = DEFAULT_EMPTY_OBJECT, onChange, validationErrors = DEFAULT_EMPTY_OBJECT }) => {
  const setField = (field, value) => {
    onChange({
      ...formData,
      [field]: value,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity And Diet</CardTitle>
          <CardDescription>
            Document expected activity limits and nutrition guidance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="activity_restrictions">Activity Restrictions</Label>
            <Textarea
              id="activity_restrictions"
              value={formData.activity_restrictions || ''}
              onChange={(event) => setField('activity_restrictions', event.target.value)}
              placeholder="No heavy lifting, walking limits, return-to-work guidance..."
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="diet_instructions">Diet Instructions</Label>
            <Textarea
              id="diet_instructions"
              value={formData.diet_instructions || ''}
              onChange={(event) => setField('diet_instructions', event.target.value)}
              placeholder="Low sodium diet, fluid restriction, diabetic meal plan..."
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wound_care">Wound Care</Label>
            <Textarea
              id="wound_care"
              value={formData.wound_care || ''}
              onChange={(event) => setField('wound_care', event.target.value)}
              placeholder="Dressing changes, bathing instructions, signs of infection..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card className={cn(validationErrors.warning_signs && 'border-destructive')}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="size-4" />
            Warning Signs <span className="text-destructive">*</span>
          </CardTitle>
          <CardDescription>
            Symptoms requiring urgent return or escalation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <Textarea
            value={formData.warning_signs || ''}
            onChange={(event) => setField('warning_signs', event.target.value)}
            placeholder="Fever > 101F, shortness of breath, chest pain, uncontrolled bleeding..."
            rows={4}
            className={cn(validationErrors.warning_signs && 'border-destructive')}
          />
          {validationErrors.warning_signs && (
            <p className="text-xs text-destructive">{validationErrors.warning_signs}</p>
          )}
        </CardContent>
      </Card>

      <Card className={cn(validationErrors.follow_up_appointments && 'border-destructive')}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="size-4" />
            Follow-Up Plan <span className="text-destructive">*</span>
          </CardTitle>
          <CardDescription>
            Include provider, timeline, and location for follow-up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <Textarea
            value={formData.follow_up_appointments || ''}
            onChange={(event) => setField('follow_up_appointments', event.target.value)}
            placeholder="Review in surgery clinic in 1 week; PCP follow-up in 2 weeks..."
            rows={4}
            className={cn(validationErrors.follow_up_appointments && 'border-destructive')}
          />
          {validationErrors.follow_up_appointments && (
            <p className="text-xs text-destructive">{validationErrors.follow_up_appointments}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DischargeInstructionsStep;
export { DischargeInstructionsStep };
