import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

import format from 'date-fns/format';

/**
 * OrdersSummary - Display summary of all orders to be placed
 */
function OrdersSummary({ orders }) {
  const medications = orders?.medications || [];
  const labs = orders?.labs || [];
  const nursing = orders?.nursing || [];
  const totalOrders = medications.length + labs.length + nursing.length;

  if (totalOrders === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No orders will be placed with this ward round.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {medications.length > 0 && (
        <div>
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <Pill className="h-4 w-4 text-blue-500" />
            Medications ({medications.length})
          </div>
          <ul className="ml-6 text-sm text-muted-foreground space-y-0.5">
            {medications.map((med, i) => (
              <li key={i}>
                {med.medication_name} {med.dosage} {med.route} {med.frequency}
              </li>
            ))}
          </ul>
        </div>
      )}

      {labs.length > 0 && (
        <div>
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <FlaskConical className="h-4 w-4 text-purple-500" />
            Labs ({labs.length})
          </div>
          <ul className="ml-6 text-sm text-muted-foreground space-y-0.5">
            {labs.map((lab, i) => (
              <li key={i} className="flex items-center gap-2">
                {lab.test_name}
                {lab.urgency === 'stat' && (
                  <Badge variant="destructive" className="text-[10px] h-4">STAT</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {nursing.length > 0 && (
        <div>
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <Stethoscope className="h-4 w-4 text-green-500" />
            Nursing Orders ({nursing.length})
          </div>
          <ul className="ml-6 text-sm text-muted-foreground space-y-0.5">
            {nursing.map((order, i) => (
              <li key={i}>{order.order_text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * DocumentationStep - Step 4 of Ward Round Workflow
 *
 * Final step for:
 * - Reviewing/editing the progress note
 * - Discharge planning
 * - Confirming orders
 */
export function DocumentationStep({ formData, onChange, contextData, validationErrors, allFormData }) {
  const [localData, setLocalData] = useState({
    progress_note: formData?.progress_note || '',
    estimated_discharge: formData?.estimated_discharge || '',
    discharge_planning_needed: formData?.discharge_planning_needed || false,
  });

  // Sync with parent when local data changes
  useEffect(() => {
    onChange(localData);
  }, [localData, onChange]);

  // Update local data from props if they change externally
  useEffect(() => {
    if (formData) {
      setLocalData(prev => ({
        progress_note: formData.progress_note ?? prev.progress_note,
        estimated_discharge: formData.estimated_discharge ?? prev.estimated_discharge,
        discharge_planning_needed: formData.discharge_planning_needed ?? prev.discharge_planning_needed,
      }));
    }
  }, [formData?.progress_note, formData?.estimated_discharge, formData?.discharge_planning_needed]);

  const handleChange = (field, value) => {
    setLocalData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  // Get orders from the plan step
  const orders = allFormData?.plan?.orders_placed || {};
  const totalOrders =
    (orders.medications?.length || 0) +
    (orders.labs?.length || 0) +
    (orders.nursing?.length || 0);

  return (
    <div className="space-y-6">
      {/* Progress Note */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Progress Note *
          </CardTitle>
          <CardDescription>
            Review and edit the auto-generated ward round note before finalizing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            id="progress_note"
            value={localData.progress_note}
            onChange={(e) => handleChange('progress_note', e.target.value)}
            placeholder="Ward round progress note..."
            rows={16}
            className={`resize-none font-mono text-sm ${validationErrors?.progress_note ? 'border-destructive' : ''}`}
          />
          {validationErrors?.progress_note && (
            <p className="text-sm text-destructive mt-2">{validationErrors.progress_note}</p>
          )}
        </CardContent>
      </Card>

      {/* Discharge Planning */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Discharge Planning
          </CardTitle>
          <CardDescription>
            Set estimated discharge date and flag if discharge planning is needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="estimated_discharge" className="text-sm">
                Estimated Discharge Date
              </Label>
              <Input
                id="estimated_discharge"
                type="date"
                value={localData.estimated_discharge}
                onChange={(e) => handleChange('estimated_discharge', e.target.value)}
                min={format(new Date(), 'yyyy-MM-dd')}
              />
            </div>

            <div className="flex items-center space-x-3 sm:pt-7">
              <Checkbox
                id="discharge_planning_needed"
                checked={localData.discharge_planning_needed}
                onCheckedChange={(checked) => handleChange('discharge_planning_needed', checked)}
              />
              <Label
                htmlFor="discharge_planning_needed"
                className="text-sm font-medium cursor-pointer"
              >
                Discharge planning needed
              </Label>
            </div>
          </div>

          {localData.discharge_planning_needed && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                The care coordination team will be notified that this patient requires discharge planning.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Orders Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" />
              Orders Summary
            </CardTitle>
            {totalOrders > 0 && (
              <Badge>{totalOrders} order{totalOrders !== 1 ? 's' : ''}</Badge>
            )}
          </div>
          <CardDescription>
            The following orders will be placed when you complete this ward round.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrdersSummary orders={orders} />
        </CardContent>
      </Card>

      {/* Completion Note */}
      <Alert className="bg-primary/5 border-primary/20">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <AlertDescription>
          <strong>Ready to complete?</strong> Clicking "Complete Ward Round" will:
          <ul className="mt-2 ml-4 list-disc text-sm space-y-1">
            <li>Create a progress note in the patient's chart</li>
            {totalOrders > 0 && <li>Submit {totalOrders} order{totalOrders !== 1 ? 's' : ''}</li>}
            {localData.estimated_discharge && (
              <li>Set estimated discharge to {format(new Date(localData.estimated_discharge), 'MMM d, yyyy')}</li>
            )}
            {localData.discharge_planning_needed && (
              <li>Flag patient for discharge planning</li>
            )}
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}

export default DocumentationStep;
