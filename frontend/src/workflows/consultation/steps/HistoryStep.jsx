import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

/**
 * HistoryStep Component
 * Captures chief complaint, HPI, ROS, and physical exam
 */
export function HistoryStep({ contextData, stepData, onChange }) {
  const [formData, setFormData] = useState({
    chief_complaint: stepData?.chief_complaint || contextData?.chief_complaint || '',
    hpi: stepData?.hpi || contextData?.hpi || '',
    ros: stepData?.ros || contextData?.ros || '',
    physical_exam: stepData?.physical_exam || contextData?.physical_exam || '',
  });

  // Update parent when form data changes
  useEffect(() => {
    onChange(formData);
  }, [formData, onChange]);

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  return (
    <div className="space-y-6">
      {/* Chief Complaint */}
      <Card>
        <CardHeader>
          <CardTitle>Chief Complaint *</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            value={formData.chief_complaint}
            onChange={(e) => handleChange('chief_complaint', e.target.value)}
            placeholder="Enter the patient's chief complaint..."
            className="text-base"
          />
          <p className="text-sm text-muted-foreground mt-2">
            Brief statement of the patient's main concern
          </p>
        </CardContent>
      </Card>

      {/* History of Present Illness */}
      <Card>
        <CardHeader>
          <CardTitle>History of Present Illness (HPI)</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData.hpi}
            onChange={(e) => handleChange('hpi', e.target.value)}
            placeholder="Document the history of the presenting problem..."
            rows={6}
            className="text-base"
          />
          <p className="text-sm text-muted-foreground mt-2">
            Include onset, location, duration, character, aggravating/relieving factors, timing, severity
          </p>
        </CardContent>
      </Card>

      {/* Review of Systems */}
      <Card>
        <CardHeader>
          <CardTitle>Review of Systems (ROS)</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData.ros}
            onChange={(e) => handleChange('ros', e.target.value)}
            placeholder="Document review of systems..."
            rows={4}
            className="text-base"
          />
          <p className="text-sm text-muted-foreground mt-2">
            Systematic review of body systems (constitutional, eyes, ENT, cardiovascular, etc.)
          </p>
        </CardContent>
      </Card>

      {/* Physical Examination */}
      <Card>
        <CardHeader>
          <CardTitle>Physical Examination</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData.physical_exam}
            onChange={(e) => handleChange('physical_exam', e.target.value)}
            placeholder="Document physical examination findings..."
            rows={6}
            className="text-base"
          />
          <p className="text-sm text-muted-foreground mt-2">
            Include vital signs and relevant physical findings
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
