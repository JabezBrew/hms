import Pill from 'lucide-react/dist/esm/icons/pill.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import ImageIcon from 'lucide-react/dist/esm/icons/image.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Quick medication options for ward rounds
 */
const COMMON_MEDICATIONS = [
  { name: 'Paracetamol', dosage: '1g', route: 'PO', frequency: 'QID PRN' },
  { name: 'Tramadol', dosage: '50mg', route: 'PO', frequency: 'TID PRN' },
  { name: 'Omeprazole', dosage: '20mg', route: 'PO', frequency: 'OD' },
  { name: 'Metoclopramide', dosage: '10mg', route: 'IV', frequency: 'TID PRN' },
  { name: 'Ondansetron', dosage: '4mg', route: 'IV', frequency: 'TID PRN' },
];

/**
 * Common lab panels for quick ordering
 */
const COMMON_LABS = [
  { name: 'Complete Blood Count (CBC)', code: 'CBC' },
  { name: 'Basic Metabolic Panel', code: 'BMP' },
  { name: 'Comprehensive Metabolic Panel', code: 'CMP' },
  { name: 'Liver Function Tests', code: 'LFT' },
  { name: 'Coagulation Panel (PT/INR, PTT)', code: 'COAG' },
  { name: 'Urinalysis', code: 'UA' },
  { name: 'Blood Culture', code: 'BCX' },
];

const EMPTY_FORM_DATA = Object.freeze({});

/**
 * AddMedicationDialog - Quick medication order entry
 */
function AddMedicationDialog({ open, onClose, onAdd }) {
  const [medication, setMedication] = useState({
    medication_name: '',
    dosage: '',
    route: 'PO',
    frequency: '',
    instructions: '',
  });

  const handleQuickAdd = (med) => {
    setMedication({
      medication_name: med.name,
      dosage: med.dosage,
      route: med.route,
      frequency: med.frequency,
      instructions: '',
    });
  };

  const handleSubmit = () => {
    if (!medication.medication_name || !medication.dosage || !medication.frequency) {
      return;
    }
    onAdd(medication);
    setMedication({
      medication_name: '',
      dosage: '',
      route: 'PO',
      frequency: '',
      instructions: '',
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pill className="size-5" />
            Add Medication Order
          </DialogTitle>
          <DialogDescription>
            Add a new medication to the ward round orders.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Quick Add Buttons */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Quick Add</Label>
            <div className="flex flex-wrap gap-2">
              {COMMON_MEDICATIONS.map((med) => (
                <Button
                  key={med.name}
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickAdd(med)}
                  className="text-xs"
                >
                  {med.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="med_name">Medication *</Label>
                <Input
                  id="med_name"
                  value={medication.medication_name}
                  onChange={(e) => setMedication(prev => ({ ...prev, medication_name: e.target.value }))}
                  placeholder="Medication name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="med_dosage">Dosage *</Label>
                <Input
                  id="med_dosage"
                  value={medication.dosage}
                  onChange={(e) => setMedication(prev => ({ ...prev, dosage: e.target.value }))}
                  placeholder="e.g., 500mg"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="med_route">Route</Label>
                <Select
                  value={medication.route}
                  onValueChange={(value) => setMedication(prev => ({ ...prev, route: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PO">PO (Oral)</SelectItem>
                    <SelectItem value="IV">IV (Intravenous)</SelectItem>
                    <SelectItem value="IM">IM (Intramuscular)</SelectItem>
                    <SelectItem value="SC">SC (Subcutaneous)</SelectItem>
                    <SelectItem value="PR">PR (Rectal)</SelectItem>
                    <SelectItem value="INH">INH (Inhaled)</SelectItem>
                    <SelectItem value="TOP">TOP (Topical)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="med_frequency">Frequency *</Label>
                <Input
                  id="med_frequency"
                  value={medication.frequency}
                  onChange={(e) => setMedication(prev => ({ ...prev, frequency: e.target.value }))}
                  placeholder="e.g., TID, QID PRN"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="med_instructions">Special Instructions</Label>
              <Input
                id="med_instructions"
                value={medication.instructions}
                onChange={(e) => setMedication(prev => ({ ...prev, instructions: e.target.value }))}
                placeholder="e.g., Take with food"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!medication.medication_name || !medication.dosage || !medication.frequency}>
            Add Medication
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * OrdersList - Display pending orders with remove option
 */
function OrdersList({ orders, onRemove, type }) {
  if (!orders || orders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-2">
        No {type} orders added yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {orders.map((order, index) => (
        <div
          key={
            type === 'medications'
              ? `${order.medication_name}-${order.dosage}-${order.frequency}`
              : `${order.test_name || order.order_text}-${order.urgency || 'routine'}`
          }
          className="flex items-center justify-between p-2 rounded-md bg-muted/50 border"
        >
          <div className="flex-1">
            {type === 'medications' && (
              <span className="text-sm">
                <strong>{order.medication_name}</strong> {order.dosage} {order.route} {order.frequency}
                {order.instructions && <span className="text-muted-foreground"> - {order.instructions}</span>}
              </span>
            )}
            {type === 'labs' && (
              <span className="text-sm">
                <strong>{order.test_name}</strong>
                {order.urgency === 'stat' && <Badge variant="destructive" className="ml-2">STAT</Badge>}
              </span>
            )}
            {type === 'nursing' && (
              <span className="text-sm">{order.order_text}</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(index)}
            className="size-8 p-0 text-muted-foreground hover:text-destructive"
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

/**
 * TreatmentPlanStep - Step 3 of Ward Round Workflow
 *
 * Captures:
 * - Assessment
 * - Plan notes
 * - Inline orders (medications, labs, nursing)
 */
export function TreatmentPlanStep({ formData = EMPTY_FORM_DATA, onChange, validationErrors }) {
  const [medicationDialogOpen, setMedicationDialogOpen] = useState(false);
  const [nursingOrderText, setNursingOrderText] = useState('');

  const assessment = formData.assessment || '';
  const planNotes = formData.plan_notes || '';
  const ordersPlaced = formData.orders_placed || {};
  const medications = ordersPlaced.medications || [];
  const labs = ordersPlaced.labs || [];
  const nursingOrders = ordersPlaced.nursing || [];

  const handleChange = (field, value) => {
    onChange({
      [field]: value,
    });
  };

  const updateOrders = (nextOrders) => {
    onChange({
      orders_placed: {
        medications,
        labs,
        nursing: nursingOrders,
        ...nextOrders,
      },
    });
  };

  const handleAddMedication = (medication) => {
    updateOrders({
      medications: [...medications, medication],
    });
  };

  const handleRemoveMedication = (index) => {
    updateOrders({
      medications: medications.filter((_, i) => i !== index),
    });
  };

  const handleAddLab = (lab, urgency = 'routine') => {
    const labOrder = {
      test_name: lab.name,
      test_code: lab.code,
      urgency,
    };
    updateOrders({
      labs: [...labs, labOrder],
    });
  };

  const handleRemoveLab = (index) => {
    updateOrders({
      labs: labs.filter((_, i) => i !== index),
    });
  };

  const handleAddNursingOrder = () => {
    if (!nursingOrderText.trim()) return;
    updateOrders({
      nursing: [...nursingOrders, { order_text: nursingOrderText.trim() }],
    });
    setNursingOrderText('');
  };

  const handleRemoveNursingOrder = (index) => {
    updateOrders({
      nursing: nursingOrders.filter((_, i) => i !== index),
    });
  };

  const totalOrders = medications.length + labs.length + nursingOrders.length;

  return (
    <div className="space-y-6">
      {/* Assessment */}
      <div className="space-y-2">
        <Label htmlFor="assessment" className="text-sm font-medium">
          Assessment *
        </Label>
        <Textarea
          id="assessment"
          value={assessment}
          onChange={(e) => handleChange('assessment', e.target.value)}
          placeholder="Clinical assessment and diagnosis...&#10;&#10;Include working diagnosis, differential diagnoses, and clinical reasoning."
          rows={6}
          className={`resize-none ${validationErrors?.assessment ? 'border-destructive' : ''}`}
        />
        {validationErrors?.assessment && (
          <p className="text-sm text-destructive">{validationErrors.assessment}</p>
        )}
      </div>

      {/* Plan Notes */}
      <div className="space-y-2">
        <Label htmlFor="plan_notes" className="text-sm font-medium">
          Plan Notes *
        </Label>
        <Textarea
          id="plan_notes"
          value={planNotes}
          onChange={(e) => handleChange('plan_notes', e.target.value)}
          placeholder="Treatment plan and rationale...&#10;&#10;Include changes to treatment, monitoring requirements, and goals."
          rows={6}
          className={`resize-none ${validationErrors?.plan_notes ? 'border-destructive' : ''}`}
        />
        {validationErrors?.plan_notes && (
          <p className="text-sm text-destructive">{validationErrors.plan_notes}</p>
        )}
      </div>

      {/* Orders Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <ClipboardList className="size-4" />
              Orders
            </CardTitle>
            {totalOrders > 0 && (
              <Badge variant="secondary">{totalOrders} order{totalOrders !== 1 ? 's' : ''}</Badge>
            )}
          </div>
          <CardDescription>
            Add medications, labs, or nursing orders to be placed with this ward round.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="medications" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="medications" className="flex items-center gap-1">
                <Pill className="size-3.5" />
                Meds
                {medications.length > 0 && (
                  <Badge variant="secondary" className="ml-1 size-5 p-0 justify-center">
                    {medications.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="labs" className="flex items-center gap-1">
                <FlaskConical className="size-3.5" />
                Labs
                {labs.length > 0 && (
                  <Badge variant="secondary" className="ml-1 size-5 p-0 justify-center">
                    {labs.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="nursing" className="flex items-center gap-1">
                <Stethoscope className="size-3.5" />
                Nursing
                {nursingOrders.length > 0 && (
                  <Badge variant="secondary" className="ml-1 size-5 p-0 justify-center">
                    {nursingOrders.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Medications Tab */}
            <TabsContent value="medications" className="space-y-4 mt-4">
              <OrdersList
                orders={medications}
                onRemove={handleRemoveMedication}
                type="medications"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMedicationDialogOpen(true)}
                className="w-full"
              >
                <Plus className="size-4 mr-2" />
                Add Medication
              </Button>
            </TabsContent>

            {/* Labs Tab */}
            <TabsContent value="labs" className="space-y-4 mt-4">
              <OrdersList
                orders={labs}
                onRemove={handleRemoveLab}
                type="labs"
              />
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Quick Add Labs</Label>
                <div className="flex flex-wrap gap-2">
                  {COMMON_LABS.map((lab) => (
                    <Button
                      key={lab.code}
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddLab(lab)}
                      className="text-xs"
                      disabled={labs.some(l => l.test_code === lab.code)}
                    >
                      <Plus className="size-3 mr-1" />
                      {lab.code}
                    </Button>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* Nursing Tab */}
            <TabsContent value="nursing" className="space-y-4 mt-4">
              <OrdersList
                orders={nursingOrders}
                onRemove={handleRemoveNursingOrder}
                type="nursing"
              />
              <div className="flex gap-2">
                <Input
                  value={nursingOrderText}
                  onChange={(e) => setNursingOrderText(e.target.value)}
                  placeholder="Enter nursing order (e.g., Strict I/O, Daily weights, etc.)"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddNursingOrder();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddNursingOrder}
                  disabled={!nursingOrderText.trim()}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Add Medication Dialog */}
      <AddMedicationDialog
        open={medicationDialogOpen}
        onClose={() => setMedicationDialogOpen(false)}
        onAdd={handleAddMedication}
      />

      {/* Orders Summary Note */}
      {totalOrders > 0 && (
        <Alert>
          <AlertCircle className="size-4" />
          <AlertDescription>
            {totalOrders} order{totalOrders !== 1 ? 's' : ''} will be submitted when you complete this ward round.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
