import X from 'lucide-react/dist/esm/icons/x.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import { useState } from 'react';
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

import { useCreateInvoice, useServices } from '@/features/billing/hooks';
import { toast } from 'sonner';
import PatientSelector from '@/components/patients/PatientSelector';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

const INVOICE_FORM_ID = 'invoice-form';
let nextInvoiceItemDraftId = 0;

function getInvoiceFormKey(patient) {
  return `create-${patient?.id || 'none'}`;
}

function createInvoiceItemDraft() {
  nextInvoiceItemDraftId += 1;
  return {
    _clientId: `invoice-item-${nextInvoiceItemDraftId}`,
    service: '',
    description: '',
    quantity: 1,
    unit_price: '',
  };
}

function getDefaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 30); // 30 days from now
  return date.toISOString().split('T')[0];
}

function getPatientDraft(patient) {
  if (!patient) {
    return null;
  }

  return {
    id: patient.id,
    name: patient.name || `${patient.first_name || ''} ${patient.last_name || ''}`.trim(),
    mrn: patient.mrn || patient.medical_record_number || '',
  };
}

function createInvoiceDraft(patient) {
  return {
    selectedPatient: getPatientDraft(patient),
    formData: {
      due_date: getDefaultDueDate(),
      notes: '',
    },
    items: [createInvoiceItemDraft()],
  };
}

function calculateInvoiceTotal(items) {
  return items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.unit_price) || 0;
    return sum + qty * price;
  }, 0);
}

/**
 * InvoiceFormSlideOver - Slide-over panel for creating invoices
 */
export default function InvoiceFormSlideOver({
  open,
  onClose,
  patient, // Optional - pre-selected patient
  onSuccess,
}) {
  if (!open) {
    return null;
  }

  return (
    <InvoiceFormContent
      key={getInvoiceFormKey(patient)}
      open={open}
      onClose={onClose}
      patient={patient}
      onSuccess={onSuccess}
    />
  );
}

function InvoiceFormContent({
  open,
  onClose,
  patient,
  onSuccess,
}) {
  const createInvoiceMutation = useCreateInvoice();
  const { data: servicesData } = useServices({ is_active: true });
  const services = servicesData?.results || servicesData || [];
  const initialDraft = createInvoiceDraft(patient);

  // Selected patient state
  const [selectedPatient, setSelectedPatient] = useState(initialDraft.selectedPatient);

  // Form state
  const [formData, setFormData] = useState(initialDraft.formData);
  const [items, setItems] = useState(initialDraft.items);
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
    setItems((prev) => [...prev, createInvoiceItemDraft()]);
  };

  const removeItem = (index) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((_, i) => i !== index));
    }
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
        items: items.reduce((invoiceItems, item) => {
          if (item.description && item.unit_price) {
            invoiceItems.push({
              service: item.service || null,
              description: item.description,
              quantity: parseInt(item.quantity) || 1,
              unit_price: parseFloat(item.unit_price),
            });
          }
          return invoiceItems;
        }, []),
      };

      const result = await createInvoiceMutation.mutateAsync(invoiceData);
      toast.success('Invoice created successfully');
      onSuccess?.(result);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to create invoice');
    }
  };

  const total = calculateInvoiceTotal(items);

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full lg:w-[600px] bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <InvoiceFormHeader onClose={onClose} />

      <div className="flex-1 overflow-y-auto p-6">
        <form id={INVOICE_FORM_ID} onSubmit={handleSubmit} className="space-y-6">
          <InvoicePatientField
            selectedPatient={selectedPatient}
            error={errors.patient}
            onPatientSelect={handlePatientSelect}
            onClearPatient={clearPatient}
          />

          <InvoiceDueDateField
            value={formData.due_date}
            onChange={(value) => handleChange('due_date', value)}
          />

          <InvoiceItemsEditor
            items={items}
            services={services}
            error={errors.items}
            total={total}
            onAddItem={addItem}
            onRemoveItem={removeItem}
            onItemChange={handleItemChange}
          />

          <InvoiceNotesField
            value={formData.notes}
            onChange={(value) => handleChange('notes', value)}
          />
        </form>
      </div>

      <InvoiceFormFooter
        isPending={createInvoiceMutation.isPending}
        onClose={onClose}
      />
    </div>
  );
}

function InvoiceFormHeader({ onClose }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <FileText className="size-5 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-xl text-foreground">Create Invoice</h2>
          <p className="font-mono text-xs text-muted-foreground">
            Add services and generate invoice
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="font-mono text-xs"
        aria-label="Close invoice form"
      >
        <X className="size-4" />
      </Button>
    </header>
  );
}

function InvoicePatientField({
  selectedPatient,
  error,
  onPatientSelect,
  onClearPatient
}) {
  return (
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
            onClick={onClearPatient}
            className="font-mono text-xs"
          >
            Change
          </Button>
        </div>
      ) : (
        <PatientSelector
          onPatientSelect={onPatientSelect}
          selectedPatient={selectedPatient}
          placeholder="Search and select a patient..."
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function InvoiceDueDateField({ value, onChange }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="due_date" className="font-mono text-xs uppercase tracking-wider">
        Due Date
      </Label>
      <Input
        id="due_date"
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono"
      />
    </div>
  );
}

function InvoiceItemsEditor({
  items,
  services,
  error,
  total,
  onAddItem,
  onRemoveItem,
  onItemChange
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="font-mono text-xs uppercase tracking-wider">
          Items <span className="text-destructive">*</span>
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddItem}
          className="font-mono text-xs"
        >
          <Plus className="size-3 mr-1" />
          Add Item
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="space-y-3">
        {items.map((item, index) => (
          <InvoiceItemEditor
            key={item._clientId}
            item={item}
            index={index}
            itemCount={items.length}
            services={services}
            onRemoveItem={onRemoveItem}
            onItemChange={onItemChange}
          />
        ))}
      </div>

      <div className="flex justify-end pt-3 border-t border-border">
        <div className="text-right">
          <p className="font-mono text-xs text-muted-foreground">Total</p>
          <p className="font-display text-2xl text-foreground">{formatCurrency(total)}</p>
        </div>
      </div>
    </div>
  );
}

function InvoiceItemEditor({
  item,
  index,
  itemCount,
  services,
  onRemoveItem,
  onItemChange
}) {
  const subtotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0);

  return (
    <div className="p-4 bg-muted/20 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">Item {index + 1}</span>
        {itemCount > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemoveItem(index)}
            className="size-6 p-0 text-destructive hover:text-destructive"
            aria-label={`Remove item ${index + 1}`}
          >
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>

      <Select
        value={item.service}
        onValueChange={(value) => onItemChange(index, 'service', value)}
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

      <Input
        placeholder="Description"
        value={item.description}
        onChange={(event) => onItemChange(index, 'description', event.target.value)}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="font-mono text-[10px] text-muted-foreground">Qty</Label>
          <Input
            type="number"
            min="1"
            value={item.quantity}
            onChange={(event) => onItemChange(index, 'quantity', event.target.value)}
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
            onChange={(event) => onItemChange(index, 'unit_price', event.target.value)}
            className="font-mono"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <span className="font-mono text-sm text-muted-foreground">
          Subtotal: {formatCurrency(subtotal)}
        </span>
      </div>
    </div>
  );
}

function InvoiceNotesField({ value, onChange }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="notes" className="font-mono text-xs uppercase tracking-wider">
        Notes
      </Label>
      <Textarea
        id="notes"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Any additional notes..."
        rows={3}
      />
    </div>
  );
}

function InvoiceFormFooter({ isPending, onClose }) {
  return (
    <footer className="border-t border-border bg-card px-6 py-4 flex items-center justify-between">
      <Button
        variant="outline"
        onClick={onClose}
        disabled={isPending}
        className="font-mono text-xs"
      >
        Cancel
      </Button>
      <Button
        type="submit"
        form={INVOICE_FORM_ID}
        disabled={isPending}
        className="font-mono text-xs"
      >
        {isPending ? (
          <>
            <LoadingSpinner className="size-4 mr-2" />
            Creating…
          </>
        ) : (
          <>
            <FileText className="size-4 mr-2" />
            Create Invoice
          </>
        )}
      </Button>
    </footer>
  );
}

function formatCurrency(amount) {
  return GHS_CURRENCY_FORMATTER.format(amount || 0);
}
