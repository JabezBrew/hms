import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Lightbulb } from 'lucide-react';

/**
 * AssessmentStep Component
 * Captures assessment and treatment plan
 */
export function AssessmentStep({ contextData, stepData, onChange }) {
  const [formData, setFormData] = useState({
    assessment: stepData?.assessment || contextData?.assessment || '',
    plan: stepData?.plan || contextData?.plan || '',
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
      {/* Summary of what was documented */}
      <Alert>
        <Lightbulb className="h-4 w-4" />
        <AlertDescription>
          <div className="space-y-2">
            <p className="font-medium">Consultation Summary:</p>
            <div className="text-sm space-y-1">
              <p><strong>Chief Complaint:</strong> {stepData?.chief_complaint || contextData?.chief_complaint || 'Not documented'}</p>
              {(stepData?.hpi || contextData?.hpi) && (
                <p className="truncate"><strong>HPI:</strong> {(stepData?.hpi || contextData?.hpi).substring(0, 100)}...</p>
              )}
            </div>
          </div>
        </AlertDescription>
      </Alert>

      {/* Assessment */}
      <Card>
        <CardHeader>
          <CardTitle>Assessment *</CardTitle>
          <CardDescription>
            Your clinical assessment and differential diagnosis
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData.assessment}
            onChange={(e) => handleChange('assessment', e.target.value)}
            placeholder="Document your assessment and diagnosis..."
            rows={8}
            className="text-base"
          />
          <p className="text-sm text-muted-foreground mt-2">
            Include primary diagnosis, differential diagnoses, and clinical reasoning
          </p>
        </CardContent>
      </Card>

      {/* Plan */}
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>
            Treatment plan and next steps
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={formData.plan}
            onChange={(e) => handleChange('plan', e.target.value)}
            placeholder="Document treatment plan, orders, follow-up instructions..."
            rows={8}
            className="text-base"
          />
          <p className="text-sm text-muted-foreground mt-2">
            Include medications, diagnostic tests, referrals, patient education, and follow-up
          </p>
        </CardContent>
      </Card>

      {/* Instructions */}
      <div className="rounded-lg border p-4 bg-muted/50">
        <p className="text-sm font-medium mb-2">Next Steps:</p>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>• Review your assessment and plan</li>
          <li>• Ensure all required information is documented</li>
          <li>• Click "Complete Consultation" to finalize and create encounter</li>
        </ul>
      </div>
    </div>
  );
}
