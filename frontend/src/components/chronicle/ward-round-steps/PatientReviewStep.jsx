import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

import format from 'date-fns/format';

const EMPTY_FORM_DATA = Object.freeze({});

/**
 * PatientReviewStep - Step 1 of Ward Round Workflow
 *
 * Displays admission context and captures:
 * - Overnight events
 * - Nursing concerns
 */
export function PatientReviewStep({ formData = EMPTY_FORM_DATA, onChange, contextData }) {
  const overnightEvents = formData.overnight_events || '';
  const nursingConcerns = formData.nursing_concerns || '';

  const handleChange = (field, value) => {
    onChange({
      [field]: value,
    });
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
            <User className="size-4" />
            Admission Context
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Bed className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">Location:</span>
              <span className="font-medium">
                {contextData?.ward_name || 'Unknown'} - Bed {contextData?.bed_number || '?'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">Admitted:</span>
              <span className="font-medium">
                {admissionDate
                  ? format(admissionDate, 'MMM d, yyyy')
                  : 'Unknown'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
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
          value={overnightEvents}
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
          value={nursingConcerns}
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
