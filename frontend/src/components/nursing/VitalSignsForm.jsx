import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCreateVitalSigns } from '@/features/nursing/hooks';
import { toast } from 'sonner';

export function VitalSignsForm({ patientId, recordedBy, onSuccess }) {
  const createVitalSigns = useCreateVitalSigns();

  const [formData, setFormData] = useState({
    temperature: '',
    heart_rate: '',
    blood_pressure_systolic: '',
    blood_pressure_diastolic: '',
    respiratory_rate: '',
    oxygen_saturation: '',
    pain_level: '',
    notes: '',
  });

  const updateVitalSignsFormField = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Filter out empty values
    const dataToSubmit = {
      patient: patientId,
      recorded_by: recordedBy,
      recorded_at: new Date().toISOString(),
    };

    Object.keys(formData).forEach((key) => {
      if (formData[key] !== '' && formData[key] !== null) {
        dataToSubmit[key] = formData[key];
      }
    });

    // Validate at least one vital sign is recorded
    const vitalFields = ['temperature', 'heart_rate', 'blood_pressure_systolic', 'respiratory_rate', 'oxygen_saturation'];
    const hasVital = vitalFields.some(field => dataToSubmit[field]);

    if (!hasVital) {
      toast.error('Validation Error', {
        description: 'Please record at least one vital sign.',
      });
      return;
    }

    // Validate blood pressure pair
    if (dataToSubmit.blood_pressure_systolic && !dataToSubmit.blood_pressure_diastolic) {
      toast.error('Validation Error', {
        description: 'Please enter both systolic and diastolic blood pressure values.',
      });
      return;
    }

    if (dataToSubmit.blood_pressure_diastolic && !dataToSubmit.blood_pressure_systolic) {
      toast.error('Validation Error', {
        description: 'Please enter both systolic and diastolic blood pressure values.',
      });
      return;
    }

    try {
      await createVitalSigns.mutateAsync(dataToSubmit);

      toast.success('Success', {
        description: 'Vital signs recorded successfully.',
      });

      // Reset form
      setFormData({
        temperature: '',
        heart_rate: '',
        blood_pressure_systolic: '',
        blood_pressure_diastolic: '',
        respiratory_rate: '',
        oxygen_saturation: '',
        pain_level: '',
        notes: '',
      });

      if (onSuccess) onSuccess();
    } catch (error) {
      toast.error('Error', {
        description: error.response?.data?.message || 'Failed to record vital signs. Please try again.',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record Vital Signs</CardTitle>
        <CardDescription>Enter patient vital signs measurements</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Temperature */}
            <div className="space-y-2">
              <Label htmlFor="temperature">Temperature (°C)</Label>
              <Input
                id="temperature"
                name="temperature"
                type="number"
                step="0.1"
                min="35"
                max="45"
                value={formData.temperature}
                onChange={updateVitalSignsFormField}
                placeholder="36.5"
              />
            </div>

            {/* Heart Rate */}
            <div className="space-y-2">
              <Label htmlFor="heart_rate">Heart Rate (bpm)</Label>
              <Input
                id="heart_rate"
                name="heart_rate"
                type="number"
                min="30"
                max="250"
                value={formData.heart_rate}
                onChange={updateVitalSignsFormField}
                placeholder="72"
              />
            </div>

            {/* Blood Pressure Systolic */}
            <div className="space-y-2">
              <Label htmlFor="blood_pressure_systolic">BP Systolic (mmHg)</Label>
              <Input
                id="blood_pressure_systolic"
                name="blood_pressure_systolic"
                type="number"
                min="50"
                max="250"
                value={formData.blood_pressure_systolic}
                onChange={updateVitalSignsFormField}
                placeholder="120"
              />
            </div>

            {/* Blood Pressure Diastolic */}
            <div className="space-y-2">
              <Label htmlFor="blood_pressure_diastolic">BP Diastolic (mmHg)</Label>
              <Input
                id="blood_pressure_diastolic"
                name="blood_pressure_diastolic"
                type="number"
                min="30"
                max="150"
                value={formData.blood_pressure_diastolic}
                onChange={updateVitalSignsFormField}
                placeholder="80"
              />
            </div>

            {/* Respiratory Rate */}
            <div className="space-y-2">
              <Label htmlFor="respiratory_rate">Respiratory Rate (/min)</Label>
              <Input
                id="respiratory_rate"
                name="respiratory_rate"
                type="number"
                min="8"
                max="60"
                value={formData.respiratory_rate}
                onChange={updateVitalSignsFormField}
                placeholder="16"
              />
            </div>

            {/* Oxygen Saturation */}
            <div className="space-y-2">
              <Label htmlFor="oxygen_saturation">SpO2 (%)</Label>
              <Input
                id="oxygen_saturation"
                name="oxygen_saturation"
                type="number"
                min="50"
                max="100"
                value={formData.oxygen_saturation}
                onChange={updateVitalSignsFormField}
                placeholder="98"
              />
            </div>

            {/* Pain Level */}
            <div className="space-y-2">
              <Label htmlFor="pain_level">Pain Level (0-10)</Label>
              <Input
                id="pain_level"
                name="pain_level"
                type="number"
                min="0"
                max="10"
                value={formData.pain_level}
                onChange={updateVitalSignsFormField}
                placeholder="0"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={updateVitalSignsFormField}
              placeholder="Additional observations or comments..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="submit"
              disabled={createVitalSigns.isPending}
            >
              {createVitalSigns.isPending ? 'Recording...' : 'Record Vital Signs'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
