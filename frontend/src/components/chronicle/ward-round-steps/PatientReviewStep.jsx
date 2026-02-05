import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

import format from 'date-fns/format';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';

/**
 * PatientReviewStep - Step 1 of Ward Round Workflow
 *
 * Displays admission context and captures:
 * - Overnight events
 * - Nursing concerns
 */
export function PatientReviewStep({ formData, onChange, contextData, validationErrors }) {
  const [localData, setLocalData] = useState({
    overnight_events: formData?.overnight_events || '',
    nursing_concerns: formData?.nursing_concerns || '',
  });

  // Sync with parent when local data changes
  useEffect(() => {
    onChange(localData);
  }, [localData, onChange]);

  // Update local data from props if they change externally
  useEffect(() => {
    if (formData) {
      setLocalData(prev => ({
        overnight_events: formData.overnight_events ?? prev.overnight_events,
        nursing_concerns: formData.nursing_concerns ?? prev.nursing_concerns,
      }));
    }
  }, [formData?.overnight_events, formData?.nursing_concerns]);

  const handleChange = (field, value) => {
    setLocalData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const prepData = contextData?.prep_data || {};
  const admissionDate = contextData?.admission_date
    ? new Date(contextData.admission_date)
    : null;

  return (
    <div className="space-y-6">
      {/* Admission Context Card */}
      <Card className="bg-muted/30 border-muted">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <User className="h-4 w-4" />
            Admission Context
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Bed className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Location:</span>
              <span className="font-medium">
                {contextData?.ward_name || 'Unknown'} - Bed {contextData?.bed_number || '?'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Admitted:</span>
              <span className="font-medium">
                {admissionDate
                  ? format(admissionDate, 'MMM d, yyyy')
                  : 'Unknown'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Length of Stay:</span>
              <Badge variant="outline" className="font-mono">
                Day {prepData.admission_days || 0}
              </Badge>
            </div>
            {prepData.admission_reason && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Admission Reason:</span>
                <p className="font-medium mt-1">{prepData.admission_reason}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Overnight Events */}
      <div className="space-y-2">
        <Label htmlFor="overnight_events" className="text-sm font-medium">
          Overnight Events
        </Label>
        <Textarea
          id="overnight_events"
          value={localData.overnight_events}
          onChange={(e) => handleChange('overnight_events', e.target.value)}
          placeholder="Document any significant overnight events, changes in condition, or incidents..."
          rows={5}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">
          Include any notable changes, incidents, or observations from the overnight period.
        </p>
      </div>

      {/* Nursing Concerns */}
      <div className="space-y-2">
        <Label htmlFor="nursing_concerns" className="text-sm font-medium">
          Nursing Concerns
        </Label>
        <Textarea
          id="nursing_concerns"
          value={localData.nursing_concerns}
          onChange={(e) => handleChange('nursing_concerns', e.target.value)}
          placeholder="Note any concerns raised by nursing staff during handoff..."
          rows={5}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">
          Document concerns from nursing handoff, pending issues, or items requiring physician attention.
        </p>
      </div>
    </div>
  );
}

export default PatientReviewStep;
