import Plus from 'lucide-react/dist/esm/icons/plus.js';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageState } from '@/shared/components/page/PageState';
import { useCreateSchedulingService } from '@/features/appointments/hooks';

const initialForm = {
  name: '',
  code: '',
  default_duration_minutes: 30,
};

function serviceCodeFromName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
}

export default function BookableServicesPanel({ services = [], isLoading = false }) {
  const [form, setForm] = useState(initialForm);
  const createService = useCreateSchedulingService();

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const code = form.code.trim() || serviceCodeFromName(name);
    const defaultDuration = Number(form.default_duration_minutes);

    if (!name) {
      toast.error('Service name is required');
      return;
    }
    if (!code) {
      toast.error('Service code is required');
      return;
    }
    if (!Number.isFinite(defaultDuration) || defaultDuration < 1) {
      toast.error('Default duration must be positive');
      return;
    }

    try {
      await createService.mutateAsync({
        code,
        name,
        default_duration_minutes: defaultDuration,
      });
      toast.success('Bookable service created');
      setForm(initialForm);
    } catch (error) {
      toast.error('Service was not created', {
        description: error.message || 'Please check the service details.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-md border border-border bg-card p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_180px_160px_auto] md:items-end">
          <div>
            <Label htmlFor="bookable-service-name">Service name</Label>
            <Input
              id="bookable-service-name"
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              placeholder="Antenatal review"
            />
          </div>
          <div>
            <Label htmlFor="bookable-service-code">Code</Label>
            <Input
              id="bookable-service-code"
              value={form.code}
              onChange={(event) => updateField('code', event.target.value)}
              placeholder={serviceCodeFromName(form.name) || 'antenatal-review'}
            />
          </div>
          <div>
            <Label htmlFor="bookable-service-duration">Default minutes</Label>
            <Input
              id="bookable-service-duration"
              type="number"
              min="1"
              value={form.default_duration_minutes}
              onChange={(event) => updateField('default_duration_minutes', event.target.value)}
            />
          </div>
          <Button type="submit" disabled={createService.isPending} className="gap-2">
            <Plus className="size-4" />
            Add Service
          </Button>
        </div>
      </form>

      {isLoading ? (
        <PageState
          variant="loading"
          fullHeight={false}
          className="min-h-0 rounded-md border border-border"
        />
      ) : services.length === 0 ? (
        <PageState
          variant="empty"
          title="No bookable services"
          description="Create services patients can be booked into, then attach them to sessions."
          fullHeight={false}
          className="min-h-0 rounded-md border border-dashed border-border bg-card/40 py-10"
        />
      ) : (
        <div className="rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Default duration</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((service) => (
                <TableRow key={service.id}>
                  <TableCell className="font-medium">{service.name}</TableCell>
                  <TableCell className="font-mono text-xs">{service.code}</TableCell>
                  <TableCell>{service.default_duration_minutes} min</TableCell>
                  <TableCell>
                    {service.is_active ? (
                      <span className="badge-chronicle-emerald">Active</span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
