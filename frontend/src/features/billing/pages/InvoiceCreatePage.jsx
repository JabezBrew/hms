import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCreateInvoice, useServices } from '@/features/billing/hooks';
import { patientsApi } from '@/lib/api/patients';
import { toast } from 'sonner';
import PatientSelector from '@/components/patients/PatientSelector';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

let nextInvoiceItemDraftId = 0;

function createInvoiceItemDraft() {
  nextInvoiceItemDraftId += 1;
  return {
    _clientId: `invoice-item-${nextInvoiceItemDraftId}`,
    service: '',
    description: '',
    quantity: 1,
  };
}

function getDefaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().split('T')[0];
}

function InvoiceCreateHeader({ onBack }) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <span className="p-3 rounded-xl bg-primary/10">
            <FileText className="size-6 text-primary" />
          </span>
          Create Invoice
        </span>
      )}
      description="Add services and generate a new invoice"
      contentClassName="max-w-4xl mx-auto w-full"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="font-mono text-xs -ml-2 mb-4"
      >
        <ArrowLeft className="size-4 mr-2" />
        Back to Invoices
      </Button>
    </PageHeader>
  );
}

function PatientInformationSection({
  selectedPatient,
  onPatientSelect,
  onClearPatient,
  error,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <h2 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
        <User className="size-5 text-muted-foreground" />
        Patient Information
      </h2>

      {selectedPatient ? (
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl">
          <div>
            <p className="font-display text-lg text-foreground">{selectedPatient.name}</p>
            {selectedPatient.mrn && (
              <p className="font-mono text-xs text-muted-foreground">MRN: {selectedPatient.mrn}</p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearPatient}
            className="font-mono text-xs"
          >
            Change Patient
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <PatientSelector
            onPatientSelect={onPatientSelect}
            selectedPatient={selectedPatient}
            placeholder="Search and select a patient..."
          />
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </div>
      )}
    </section>
  );
}

function InvoiceDetailsSection({ dueDate, onDueDateChange }) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <h2 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
        <Calendar className="size-5 text-muted-foreground" />
        Invoice Details
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="due_date" className="font-mono text-xs uppercase tracking-wider">
            Due Date
          </Label>
          <Input
            id="due_date"
            type="date"
            value={dueDate}
            onChange={(event) => onDueDateChange(event.target.value)}
            className="font-mono"
          />
        </div>
      </div>
    </section>
  );
}

function InvoiceItemCard({
  item,
  index,
  itemCount,
  services,
  onItemChange,
  onRemoveItem,
}) {
  const unitPrice = getEstimatedUnitPrice(item.service, services);
  const subtotal = (parseFloat(item.quantity) || 0) * (parseFloat(unitPrice) || 0);

  return (
    <div
      className="p-4 bg-muted/20 rounded-xl border border-border/50 space-y-4"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          Item {index + 1}
        </span>
        {itemCount > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemoveItem(index)}
            className="size-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Label className="font-mono text-[10px] text-muted-foreground uppercase">
          Service <span className="text-destructive">*</span>
        </Label>
        <Select
          value={item.service}
          onValueChange={(value) => onItemChange(index, 'service', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select from service catalog..." />
          </SelectTrigger>
          <SelectContent>
            {services.map((service) => (
              <SelectItem key={service.id} value={service.id} className="font-mono text-sm">
                <span className="flex items-center justify-between gap-4">
                  <span>{service.name}</span>
                  <span className="text-muted-foreground">
                    {formatCurrency(service.base_price || service.total_price || service.price)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="font-mono text-[10px] text-muted-foreground uppercase">
          Description
        </Label>
        <Input
          placeholder="Service or item description"
          value={item.description}
          onChange={(event) => onItemChange(index, 'description', event.target.value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label className="font-mono text-[10px] text-muted-foreground uppercase">
            Qty
          </Label>
          <Input
            type="number"
            min="1"
            value={item.quantity}
            onChange={(event) => onItemChange(index, 'quantity', event.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-[10px] text-muted-foreground uppercase">
            Unit Price (Est.)
          </Label>
          <div className="h-10 px-3 flex items-center bg-muted/50 rounded-md">
            <span className="font-mono text-sm text-foreground">
              {formatCurrency(unitPrice)}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-[10px] text-muted-foreground uppercase">
            Subtotal
          </Label>
          <div className="h-10 px-3 flex items-center bg-muted/50 rounded-md">
            <span className="font-mono text-sm text-foreground">
              {formatCurrency(subtotal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function InvoiceItemsSection({
  items,
  services,
  total,
  error,
  onAddItem,
  onItemChange,
  onRemoveItem,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg text-foreground flex items-center gap-2">
          <DollarSign className="size-5 text-muted-foreground" />
          Invoice Items
        </h2>
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

      {error && (
        <p className="text-xs text-destructive mb-4">{error}</p>
      )}

      <div className="space-y-4">
        {items.map((item, index) => (
          <InvoiceItemCard
            key={item._clientId}
            item={item}
            index={index}
            itemCount={items.length}
            services={services}
            onItemChange={onItemChange}
            onRemoveItem={onRemoveItem}
          />
        ))}
      </div>

      <div className="flex justify-end mt-6 pt-4 border-t border-border">
        <div className="text-right">
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-1">
            Total Amount
          </p>
          <p className="font-display text-3xl text-foreground">
            {formatCurrency(total)}
          </p>
        </div>
      </div>
    </section>
  );
}

function InvoiceNotesSection({ notes, onNotesChange }) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <h2 className="font-display text-lg text-foreground mb-4">Notes</h2>
      <Textarea
        value={notes}
        onChange={(event) => onNotesChange(event.target.value)}
        placeholder="Any additional notes for this invoice..."
        rows={3}
      />
    </section>
  );
}

function InvoiceActions({ isSubmitting, onCancel }) {
  return (
    <div className="flex items-center justify-between pt-4">
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        className="font-mono text-xs"
      >
        Cancel
      </Button>
      <Button
        type="submit"
        disabled={isSubmitting}
        className="font-mono text-xs"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Creating…
          </>
        ) : (
          <>
            <FileText className="size-4 mr-2" />
            Create Invoice
          </>
        )}
      </Button>
    </div>
  );
}

export default function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedPatientId = searchParams.get('patient');

  const createInvoiceMutation = useCreateInvoice();
  const { data: servicesData, isLoading: servicesLoading } = useServices({ is_active: true });
  const services = servicesData?.results || servicesData || [];

  // Selected patient state
  const [selectedPatient, setSelectedPatient] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    due_date: getDefaultDueDate(),
    notes: '',
  });
  const [items, setItems] = useState(() => [createInvoiceItemDraft()]);
  const [errors, setErrors] = useState({});

  // Load preselected patient
  useEffect(() => {
    if (preselectedPatientId) {
      loadPatient(preselectedPatientId);
    }
  }, [preselectedPatientId]);

  const loadPatient = async (patientId) => {
    try {
      const patient = await patientsApi.getPatient(patientId);
      // Format patient to match PatientSelector expected format
      setSelectedPatient({
        id: patient.id,
        name: patient.name || [patient.first_name, patient.last_name].filter(Boolean).join(' '),
        mrn: patient.mrn || patient.medical_record_number,
      });
    } catch (err) {
      console.error('Failed to load patient:', err);
    }
  };

  // Handle patient selection from PatientSelector
  const handlePatientSelect = (patient) => {
    if (patient) {
      // PatientSelector may return different formats, normalize it
      const patientId = patient.id || patient.local_data?.id;
      const patientName = patient.name ||
        (patient.local_data?.user ? `${patient.local_data.user.first_name} ${patient.local_data.user.last_name}` : 'Unknown');
      const patientMrn = patient.mrn || patient.local_data?.medical_record_number || '';

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

      // Auto-fill description when service is selected
      if (field === 'service' && value) {
        const selectedService = services.find((s) => s.id === value);
        if (selectedService) {
          newItems[index].description = selectedService.name;
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

  const calculateTotal = () => {
    return items.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(getEstimatedUnitPrice(item.service, services)) || 0;
      return sum + qty * price;
    }, 0);
  };

  const validate = () => {
    const newErrors = {};

    if (!selectedPatient?.id) {
      newErrors.patient = 'Please select a patient';
    }

    const validItems = items.filter((item) => item.service);
    if (validItems.length === 0) {
      newErrors.items = 'Please add at least one service item';
    } else if (validItems.some((item) => !(parseInt(item.quantity, 10) > 0))) {
      newErrors.items = 'All items must have a quantity greater than zero';
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
          if (item.service) {
            invoiceItems.push({
              service: item.service,
              description: item.description || null,
              quantity: parseInt(item.quantity) || 1,
            });
          }
          return invoiceItems;
        }, []),
      };

      const result = await createInvoiceMutation.mutateAsync(invoiceData);
      toast.success('Invoice created successfully');
      navigate(`/billing/invoices/${result.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to create invoice');
    }
  };

  if (servicesLoading) {
    return (
      <PageState variant="loading">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
      </PageState>
    );
  }

  return (
    <PageShell>
      <InvoiceCreateHeader onBack={() => navigate('/billing/invoices')} />

      <main className="p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="space-y-6">
            <PatientInformationSection
              selectedPatient={selectedPatient}
              onPatientSelect={handlePatientSelect}
              onClearPatient={clearPatient}
              error={errors.patient}
            />
            <InvoiceDetailsSection
              dueDate={formData.due_date}
              onDueDateChange={(value) => handleChange('due_date', value)}
            />
            <InvoiceItemsSection
              items={items}
              services={services}
              total={calculateTotal()}
              error={errors.items}
              onAddItem={addItem}
              onItemChange={handleItemChange}
              onRemoveItem={removeItem}
            />
            <InvoiceNotesSection
              notes={formData.notes}
              onNotesChange={(value) => handleChange('notes', value)}
            />
            <InvoiceActions
              isSubmitting={createInvoiceMutation.isPending}
              onCancel={() => navigate('/billing/invoices')}
            />
          </form>
        </div>
      </main>
    </PageShell>
  );
}

function formatCurrency(amount) {
  return GHS_CURRENCY_FORMATTER.format(amount || 0);
}

function getEstimatedUnitPrice(serviceId, services = []) {
  if (!serviceId) return 0;
  const service = services.find((s) => s.id === serviceId);
  if (!service) return 0;
  return service.base_price || service.total_price || service.price || 0;
}
