import X from 'lucide-react/dist/esm/icons/x.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCreateInvoice, useServices } from '@/hooks/useBillingQueries';
import { toast } from 'sonner';
import PatientSelector from '@/components/patients/PatientSelector';

/**
 * InvoiceFormSlideOver - Slide-over panel for creating invoices
 */
export default function InvoiceFormSlideOver({
  open,
  onClose,
  patient, // Optional - pre-selected patient
  onSuccess,
}) {
  const createInvoiceMutation = useCreateInvoice();
  const { data: servicesData } = useServices({ is_active: true });
  const services = servicesData?.results || servicesData || [];

  // Selected patient state
  const [selectedPatient, setSelectedPatient] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    due_date: '',
    notes: '',
  });
  const [items, setItems] = useState([
    { service: '', description: '', quantity: 1, unit_price: '' },
  ]);
  const [errors, setErrors] = useState({});

  // Handle patient selection from PatientSelector
  const handlePatientSelect = (p) => {
    if (p) {
      const patientId = p.id || p.local_data?.id;
      const patientName = p.name ||
        (p.local_data?.user ? `${p.local_data.user.first_name} ${p.local_data.user.last_name}` : 'Unknown');
      const patientMrn = p.mrn || p.local_data?.medical_record_number || '';

      setSelectedPatient({
        id: patientId,
        name: patientName,
        mrn: patientMrn,
      });

      if (errors.patient) {
        setErrors((prev) => ({ ...prev, patient: null }));
      }
    }
  };

  const clearPatient = () => {
    setSelectedPatient(null);
  };

  // Reset form when panel opens/closes
  useEffect(() => {
    if (open) {
      // If patient prop is provided, set it as selected
      if (patient) {
        setSelectedPatient({
          id: patient.id,
          name: patient.name || `${patient.first_name || ''} ${patient.last_name || ''}`.trim(),
          mrn: patient.mrn || patient.medical_record_number || '',
        });
      } else {
        setSelectedPatient(null);
      }
      setFormData({
        due_date: getDefaultDueDate(),
        notes: '',
      });
      setItems([{ service: '', description: '', quantity: 1, unit_price: '' }]);
      setErrors({});
    }
  }, [open, patient]);

  const getDefaultDueDate = () => {
    const date = new Date();
    date.setDate(date.getDate() + 30); // 30 days from now
    return date.toISOString().split('T')[0];
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], [field]: value };

      // Auto-fill price and description when service is selected
      if (field === 'service' && value) {
        const selectedService = services.find((s) => s.id === value);
        if (selectedService) {
          newItems[index].description = selectedService.name;
          newItems[index].unit_price = selectedService.base_price || selectedService.price || '';
        }
      }

      return newItems;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, { service: '', description: '', quantity: 1, unit_price: '' }]);
  };

  const removeItem = (index) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unit_price) || 0;
      return sum + qty * price;
    }, 0);
  };

  const validate = () => {
    const newErrors = {};

    if (!selectedPatient?.id) {
      newErrors.patient = 'Please select a patient';
    }

    const validItems = items.filter((item) => item.description && item.unit_price);
    if (validItems.length === 0) {
      newErrors.items = 'Please add at least one item';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validate()) return;

    try {
      const invoiceData = {
        patient: selectedPatient.id,
        due_date: formData.due_date || null,
        notes: formData.notes || null,
        items: items
          .filter((item) => item.description && item.unit_price)
          .map((item) => ({
            service: item.service || null,
            description: item.description,
            quantity: parseInt(item.quantity) || 1,
            unit_price: parseFloat(item.unit_price),
          })),
      };

      const result = await createInvoiceMutation.mutateAsync(invoiceData);
      toast.success('Invoice created successfully');
      onSuccess?.(result);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to create invoice');
    }
  };

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full lg:w-[600px] bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">Create Invoice</h2>
            <p className="font-mono text-xs text-muted-foreground">
              Add services and generate invoice
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="font-mono text-xs">
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Patient Selection */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">
              Patient <span className="text-destructive">*</span>
            </Label>
            {selectedPatient ? (
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div>
                  <span className="text-foreground">{selectedPatient.name}</span>
                  {selectedPatient.mrn && (
                    <p className="font-mono text-xs text-muted-foreground">MRN: {selectedPatient.mrn}</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearPatient}
                  className="font-mono text-xs"
                >
                  Change
                </Button>
              </div>
            ) : (
              <PatientSelector
                onPatientSelect={handlePatientSelect}
                selectedPatient={selectedPatient}
                placeholder="Search and select a patient..."
              />
            )}
            {errors.patient && <p className="text-xs text-destructive">{errors.patient}</p>}
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label htmlFor="due_date" className="font-mono text-xs uppercase tracking-wider">
              Due Date
            </Label>
            <Input
              id="due_date"
              type="date"
              value={formData.due_date}
              onChange={(e) => handleChange('due_date', e.target.value)}
              className="font-mono"
            />
          </div>

          {/* Invoice Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-mono text-xs uppercase tracking-wider">
                Items <span className="text-destructive">*</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItem}
                className="font-mono text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Item
              </Button>
            </div>

            {errors.items && <p className="text-xs text-destructive">{errors.items}</p>}

            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={index} className="p-4 bg-muted/20 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">Item {index + 1}</span>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>

                  {/* Service Selection */}
                  <Select
                    value={item.service}
                    onValueChange={(value) => handleItemChange(index, 'service', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select service (optional)" />
                    </SelectTrigger>
                    <SelectContent className="z-[200]">
                      {services.map((service) => (
                        <SelectItem key={service.id} value={service.id} className="font-mono text-sm">
                          {service.name} - {formatCurrency(service.base_price || service.price)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Description */}
                  <Input
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                  />

                  {/* Quantity and Price */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="font-mono text-[10px] text-muted-foreground">Qty</Label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                        className="font-mono"
                      />
                    </div>
                    <div>
                      <Label className="font-mono text-[10px] text-muted-foreground">Unit Price</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={item.unit_price}
                        onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)}
                        className="font-mono"
                      />
                    </div>
                  </div>

                  {/* Line Total */}
                  <div className="flex justify-end">
                    <span className="font-mono text-sm text-muted-foreground">
                      Subtotal: {formatCurrency((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0))}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="flex justify-end pt-3 border-t border-border">
              <div className="text-right">
                <p className="font-mono text-xs text-muted-foreground">Total</p>
                <p className="font-display text-2xl text-foreground">{formatCurrency(calculateTotal())}</p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="font-mono text-xs uppercase tracking-wider">
              Notes
            </Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Any additional notes..."
              rows={3}
            />
          </div>
        </form>
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card px-6 py-4 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={createInvoiceMutation.isPending}
          className="font-mono text-xs"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={createInvoiceMutation.isPending}
          className="font-mono text-xs"
        >
          {createInvoiceMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <FileText className="h-4 w-4 mr-2" />
              Create Invoice
            </>
          )}
        </Button>
      </footer>
    </div>
  );
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}
