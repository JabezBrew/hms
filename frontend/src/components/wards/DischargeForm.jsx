import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { apiClient } from '@/lib/api';

export function DischargeForm({ admission, onDischargeComplete }) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    discharge_notes: '',
    discharge_status: 'discharged', // discharged, transferred, deceased
    schedule_followup: false,
    generate_invoice: true,
  });

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle select changes
  const handleSelectChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle checkbox changes
  const handleCheckboxChange = (name, checked) => {
    setFormData(prev => ({ ...prev, [name]: checked }));
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      setSubmitting(true);
      
      // Discharge the patient
      await apiClient.post(`/admissions/${admission.id}/discharge/`, {
        discharge_notes: formData.discharge_notes,
      });
      
      // Generate invoice if requested
      if (formData.generate_invoice) {
        try {
          await apiClient.post(`/billing/generate-invoice/`, {
            admission_id: admission.id,
            invoice_type: 'inpatient',
          });
        } catch (err) {
          console.error('Error generating invoice:', err);
          // Continue with discharge even if invoice generation fails
        }
      }
      
      // Schedule follow-up if requested
      if (formData.schedule_followup) {
        try {
          const followupDate = new Date();
          followupDate.setDate(followupDate.getDate() + 14); // 2 weeks follow-up
          
          await apiClient.post(`/appointments/`, {
            patient: admission.patient.id,
            practitioner: admission.admitting_doctor?.id,
            appointment_date: followupDate.toISOString().split('T')[0],
            appointment_type: 'follow_up',
            reason: `Follow-up after inpatient stay (${admission.id})`,
            status: 'scheduled',
          });
        } catch (err) {
          console.error('Error scheduling follow-up:', err);
          // Continue with discharge even if follow-up scheduling fails
        }
      }
      
      // Call the completion handler if provided
      if (onDischargeComplete) {
        onDischargeComplete();
      } else {
        // Navigate to the ward detail page
        navigate(`/wards/${admission.bed.ward.id}`);
      }
    } catch (err) {
      console.error('Error discharging patient:', err);
      setError('Failed to discharge patient. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Discharge Patient</CardTitle>
          <CardDescription>
            Complete the discharge process for {admission.patient.user.full_name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Discharge status */}
          <div className="space-y-2">
            <Label htmlFor="discharge_status">Discharge Status</Label>
            <Select
              value={formData.discharge_status}
              onValueChange={(value) => handleSelectChange('discharge_status', value)}
            >
              <SelectTrigger id="discharge_status">
                <SelectValue placeholder="Select discharge status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discharged">Discharged (Home)</SelectItem>
                <SelectItem value="transferred">Transferred (Other Facility)</SelectItem>
                <SelectItem value="deceased">Deceased</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Discharge notes */}
          <div className="space-y-2">
            <Label htmlFor="discharge_notes">Discharge Notes</Label>
            <Textarea
              id="discharge_notes"
              name="discharge_notes"
              value={formData.discharge_notes}
              onChange={handleInputChange}
              placeholder="Enter discharge instructions, medications, and follow-up care..."
              rows={6}
            />
          </div>

          {/* Additional options */}
          <div className="space-y-4 pt-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="generate_invoice"
                checked={formData.generate_invoice}
                onCheckedChange={(checked) => handleCheckboxChange('generate_invoice', checked)}
              />
              <Label htmlFor="generate_invoice" className="cursor-pointer">
                Generate invoice for this stay
              </Label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="schedule_followup"
                checked={formData.schedule_followup}
                onCheckedChange={(checked) => handleCheckboxChange('schedule_followup', checked)}
              />
              <Label htmlFor="schedule_followup" className="cursor-pointer">
                Schedule follow-up appointment (2 weeks)
              </Label>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="text-red-500 text-sm mt-2">
              {error}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-4">
          <Button 
            type="button" 
            variant="outline"
            onClick={() => navigate(-1)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Processing Discharge...' : 'Complete Discharge'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}