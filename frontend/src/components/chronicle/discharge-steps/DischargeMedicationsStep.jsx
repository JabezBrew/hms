import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function createPrescription() {
  return {
    medication_name: '',
    dosage: '',
    frequency: '',
    instructions: '',
  };
}

const DischargeMedicationsStep = ({ formData = {}, onChange, validationErrors = {} }) => {
  const prescriptions = formData.discharge_prescriptions || [];

  const setField = (field, value) => {
    onChange({
      ...formData,
      [field]: value,
    });
  };

  const updatePrescription = (index, field, value) => {
    const next = prescriptions.map((prescription, currentIndex) => (
      currentIndex === index
        ? { ...prescription, [field]: value }
        : prescription
    ));
    setField('discharge_prescriptions', next);
  };

  const addPrescription = () => {
    setField('discharge_prescriptions', [...prescriptions, createPrescription()]);
  };

  const removePrescription = (index) => {
    const next = prescriptions.filter((_, currentIndex) => currentIndex !== index);
    setField('discharge_prescriptions', next);
  };

  return (
    <div className="space-y-4">
      <Card className={cn(validationErrors.medications_reconciled && 'border-destructive')}>
        <CardHeader>
          <CardTitle className="text-base">Medication Reconciliation</CardTitle>
          <CardDescription>
            Confirm inpatient medications were reconciled with the home regimen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={formData.medications_reconciled === true}
              onCheckedChange={(checked) => setField('medications_reconciled', checked === true)}
            />
            <span>
              Medication reconciliation completed <span className="text-destructive">*</span>
            </span>
          </label>
          {validationErrors.medications_reconciled && (
            <p className="mt-2 text-xs text-destructive">{validationErrors.medications_reconciled}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Pill className="h-4 w-4" />
            Discharge Prescriptions
          </CardTitle>
          <CardDescription>
            Add medications the patient should continue after discharge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {prescriptions.length === 0 && (
            <p className="text-sm text-muted-foreground">No discharge prescriptions added yet.</p>
          )}

          {prescriptions.map((prescription, index) => (
            <div key={`rx-${index}`} className="rounded-lg border p-3 space-y-2">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Medication</Label>
                  <Input
                    value={prescription.medication_name || ''}
                    onChange={(event) => updatePrescription(index, 'medication_name', event.target.value)}
                    placeholder="Medication name"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Dosage</Label>
                  <Input
                    value={prescription.dosage || ''}
                    onChange={(event) => updatePrescription(index, 'dosage', event.target.value)}
                    placeholder="e.g. 500 mg"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Frequency</Label>
                  <Input
                    value={prescription.frequency || ''}
                    onChange={(event) => updatePrescription(index, 'frequency', event.target.value)}
                    placeholder="e.g. BID"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Instructions</Label>
                <Input
                  value={prescription.instructions || ''}
                  onChange={(event) => updatePrescription(index, 'instructions', event.target.value)}
                  placeholder="e.g. Take with meals"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removePrescription(index)}
                  className="text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Remove
                </Button>
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={addPrescription}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Prescription
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Medication Changes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={formData.medication_changes || ''}
            onChange={(event) => setField('medication_changes', event.target.value)}
            placeholder="Document new medications, discontinued medications, and dose changes."
            rows={5}
            className="font-mono text-sm"
          />
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={formData.medication_education_completed === true}
              onCheckedChange={(checked) => setField('medication_education_completed', checked === true)}
            />
            <span>Patient/family educated on medication plan</span>
          </label>
        </CardContent>
      </Card>
    </div>
  );
};

export default DischargeMedicationsStep;
export { DischargeMedicationsStep };
