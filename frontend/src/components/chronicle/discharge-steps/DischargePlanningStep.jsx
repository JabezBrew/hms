import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Home from 'lucide-react/dist/esm/icons/house.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const DEFAULT_EMPTY_OBJECT = {};

const DISCHARGE_CRITERIA = [
  'Clinical condition stable',
  'Pain controlled',
  'Tolerating oral intake',
  'No acute issues',
  'Follow-up arranged',
  'Patient/family educated',
];

const DISPOSITION_OPTIONS = [
  { value: 'home', label: 'Home' },
  { value: 'home_health', label: 'Home Health' },
  { value: 'rehab', label: 'Rehab' },
  { value: 'snf', label: 'Skilled Nursing Facility' },
  { value: 'ltac', label: 'Long-Term Acute Care' },
  { value: 'transfer', label: 'Transfer to Other Facility' },
  { value: 'ama', label: 'Against Medical Advice' },
  { value: 'deceased', label: 'Deceased' },
];

const TRANSPORT_OPTIONS = [
  { value: 'private', label: 'Private Vehicle' },
  { value: 'ambulance', label: 'Ambulance' },
  { value: 'wheelchair_van', label: 'Wheelchair Van' },
  { value: 'family', label: 'Family Assistance' },
  { value: 'other', label: 'Other' },
];

function toLocalInputValue(isoValue) {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60000);
  return localDate.toISOString().slice(0, 16);
}

function fromLocalInputValue(localValue) {
  if (!localValue) return '';
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

const DischargePlanningStep = ({ formData = DEFAULT_EMPTY_OBJECT, onChange, contextData, validationErrors = DEFAULT_EMPTY_OBJECT }) => {
  const criteria = formData.discharge_criteria_met || [];

  const setField = (field, value) => {
    onChange({
      ...formData,
      [field]: value,
    });
  };

  const toggleCriterion = (criterion, checked) => {
    const next = checked
      ? [...criteria, criterion]
      : criteria.filter((item) => item !== criterion);
    setField('discharge_criteria_met', next);
  };

  return (
    <div className="space-y-4">
      <Card className="bg-muted/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Patient Context</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-mono text-xs text-muted-foreground">Admission Days</p>
            <p>{contextData?.prep_data?.admission_days ?? 'N/A'}</p>
          </div>
          <div>
            <p className="font-mono text-xs text-muted-foreground">Ward</p>
            <p>{contextData?.ward_name || 'Not assigned'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Readiness Checklist</CardTitle>
          <CardDescription>Confirm core discharge criteria.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {DISCHARGE_CRITERIA.map((criterion) => (
            <label key={criterion} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={criteria.includes(criterion)}
                onCheckedChange={(checked) => toggleCriterion(criterion, checked === true)}
              />
              <span>{criterion}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card className={cn(validationErrors.discharge_disposition && 'border-destructive')}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Home className="size-4" />
            Disposition <span className="text-destructive">*</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="disposition">Discharge Disposition</Label>
          <Select
            value={formData.discharge_disposition || ''}
            onValueChange={(value) => setField('discharge_disposition', value)}
          >
            <SelectTrigger id="disposition" className={cn(validationErrors.discharge_disposition && 'border-destructive')}>
              <SelectValue placeholder="Select discharge destination" />
            </SelectTrigger>
            <SelectContent>
              {DISPOSITION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {validationErrors.discharge_disposition && (
            <p className="text-xs text-destructive">{validationErrors.discharge_disposition}</p>
          )}
        </CardContent>
      </Card>

      <Card className={cn(validationErrors.discharge_date && 'border-destructive')}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="size-4" />
            Planned Discharge Date & Time <span className="text-destructive">*</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="discharge_date">Date & Time</Label>
          <Input
            id="discharge_date"
            type="datetime-local"
            value={toLocalInputValue(formData.discharge_date)}
            onChange={(event) => setField('discharge_date', fromLocalInputValue(event.target.value))}
            className={cn(validationErrors.discharge_date && 'border-destructive')}
          />
          {validationErrors.discharge_date && (
            <p className="text-xs text-destructive">{validationErrors.discharge_date}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transportation Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="transportation">Transportation</Label>
          <Select
            value={formData.transportation || ''}
            onValueChange={(value) => setField('transportation', value)}
          >
            <SelectTrigger id="transportation">
              <SelectValue placeholder="Select transportation arrangement" />
            </SelectTrigger>
            <SelectContent>
              {TRANSPORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5" />
          <p>Only continue when disposition and discharge time are confirmed with the care team.</p>
        </div>
      </div>
    </div>
  );
};

export default DischargePlanningStep;
export { DischargePlanningStep };
