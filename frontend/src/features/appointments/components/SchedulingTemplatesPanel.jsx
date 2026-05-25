import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useCreateSchedulingTemplate,
  useGenerateSchedulingSessions,
  useSchedulingTemplates,
} from '@/features/appointments/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageState } from '@/shared/components/page/PageState';

const todayIso = () => new Date().toISOString().slice(0, 10);

const initialTemplateForm = () => ({
  name: '',
  clinic_id: '',
  service_id: '',
  mode: 'capacity_block',
  weekdays: [1, 2, 3, 4, 5],
  starts_on: todayIso(),
  start_time: '08:00',
  end_time: '12:00',
  capacity: 20,
  slot_minutes: 30,
  allow_overbooking: false,
  overbook_limit: 0,
});

const weekdays = [
  { value: 1, label: 'Mon', fullLabel: 'Monday' },
  { value: 2, label: 'Tue', fullLabel: 'Tuesday' },
  { value: 3, label: 'Wed', fullLabel: 'Wednesday' },
  { value: 4, label: 'Thu', fullLabel: 'Thursday' },
  { value: 5, label: 'Fri', fullLabel: 'Friday' },
  { value: 6, label: 'Sat', fullLabel: 'Saturday' },
  { value: 7, label: 'Sun', fullLabel: 'Sunday' },
];

const weekdayLabels = new Map(weekdays.map((weekday) => [weekday.value, weekday.label]));

function datePlusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatWeekdays(values = []) {
  return values.map((day) => weekdayLabels.get(day) || day).join(', ');
}

function TemplateRows({ templates, isGenerating, onGenerate }) {
  if (!templates?.length) {
    return (
      <PageState
        variant="empty"
        title="No session templates"
        description="Create a recurring template to generate clinic sessions."
        fullHeight={false}
        className="min-h-0 rounded-md border border-dashed border-border bg-card/40 py-10"
      />
    );
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border bg-card">
      {templates.map((template) => (
        <div key={template.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{template.name}</h3>
              <Badge variant="outline" className="font-mono text-[11px]">
                {template.mode === 'fixed_slot' ? 'fixed slots' : 'capacity block'}
              </Badge>
              <Badge className="badge-chronicle-emerald font-mono text-[11px]">
                {formatWeekdays(template.weekdays)}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {template.start_time?.slice(0, 5)} - {template.end_time?.slice(0, 5)} - capacity {template.capacity}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onGenerate(template.id)}
            disabled={isGenerating}
            className="gap-2"
          >
            <RefreshCw className="size-4" />
            Generate 14 days
          </Button>
        </div>
      ))}
    </div>
  );
}

function TemplateForm({
  form,
  clinics,
  services,
  servicesLoading,
  isCreating,
  onField,
  onToggleWeekday,
  onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-md border border-border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Label htmlFor="template-name">Template name</Label>
          <Input
            id="template-name"
            value={form.name}
            onChange={(event) => onField('name', event.target.value)}
            placeholder="OPD weekdays morning"
          />
        </div>
        <div>
          <Label htmlFor="template-clinic">Clinic</Label>
          <select
            id="template-clinic"
            value={form.clinic_id}
            onChange={(event) => onField('clinic_id', event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select clinic</option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="template-service">Service</Label>
          <select
            id="template-service"
            value={form.service_id}
            onChange={(event) => onField('service_id', event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            disabled={servicesLoading}
          >
            <option value="">Any service</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="template-starts-on">Starts on</Label>
          <Input
            id="template-starts-on"
            type="date"
            value={form.starts_on}
            onChange={(event) => onField('starts_on', event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="template-start">Start</Label>
          <Input
            id="template-start"
            type="time"
            value={form.start_time}
            onChange={(event) => onField('start_time', event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="template-end">End</Label>
          <Input
            id="template-end"
            type="time"
            value={form.end_time}
            onChange={(event) => onField('end_time', event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="template-capacity">Capacity</Label>
          <Input
            id="template-capacity"
            type="number"
            min="1"
            value={form.capacity}
            onChange={(event) => onField('capacity', event.target.value)}
          />
        </div>
        <fieldset className="lg:col-span-4">
          <legend className="mb-2 text-sm font-medium text-foreground">Repeat days</legend>
          <div className="flex flex-wrap gap-2">
            {weekdays.map((weekday) => {
              const id = `template-weekday-${weekday.value}`;
              return (
                <label
                  key={weekday.value}
                  htmlFor={id}
                  className="flex h-9 items-center gap-2 rounded-md border border-border px-3 font-mono text-xs"
                >
                  <input
                    id={id}
                    type="checkbox"
                    aria-label={`Repeat on ${weekday.fullLabel}`}
                    checked={form.weekdays.includes(weekday.value)}
                    onChange={() => onToggleWeekday(weekday.value)}
                  />
                  {weekday.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={isCreating} className="gap-2">
          <Plus className="size-4" />
          Create Template
        </Button>
      </div>
    </form>
  );
}

export default function SchedulingTemplatesPanel({
  clinics,
  services,
  servicesLoading,
}) {
  const [templateForm, setTemplateForm] = useState(initialTemplateForm);
  const createTemplate = useCreateSchedulingTemplate();
  const generateSessions = useGenerateSchedulingSessions();
  const { data: templates = [], isLoading: templatesLoading } = useSchedulingTemplates({
    limit: 50,
  });

  const handleTemplateField = (field, value) => {
    setTemplateForm((current) => ({ ...current, [field]: value }));
  };

  const handleTemplateWeekday = (weekday) => {
    setTemplateForm((current) => {
      const nextWeekdays = current.weekdays.includes(weekday)
        ? current.weekdays.filter((value) => value !== weekday)
        : [...current.weekdays, weekday].sort((left, right) => left - right);
      return { ...current, weekdays: nextWeekdays };
    });
  };

  const handleCreateTemplate = async (event) => {
    event.preventDefault();
    if (!templateForm.name.trim()) {
      toast.error('Template name is required');
      return;
    }
    if (!templateForm.clinic_id) {
      toast.error('Clinic is required');
      return;
    }
    if (!templateForm.weekdays.length) {
      toast.error('At least one repeat day is required');
      return;
    }

    try {
      await createTemplate.mutateAsync(templateForm);
      toast.success('Template created');
      setTemplateForm(initialTemplateForm());
    } catch (error) {
      toast.error('Template was not created', {
        description: error.message || 'Please check the template details.',
      });
    }
  };

  const handleGenerateTemplate = async (templateId) => {
    try {
      const result = await generateSessions.mutateAsync({
        template_id: templateId,
        start_date: todayIso(),
        end_date: datePlusDays(13),
      });
      toast.success('Sessions generated', {
        description: `${result.generated_count || 0} created, ${result.skipped_count || 0} already existed.`,
      });
    } catch (error) {
      toast.error('Sessions were not generated', {
        description: error.message || 'Please check the template.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <TemplateForm
        form={templateForm}
        clinics={clinics}
        services={services}
        servicesLoading={servicesLoading}
        isCreating={createTemplate.isPending}
        onField={handleTemplateField}
        onToggleWeekday={handleTemplateWeekday}
        onSubmit={handleCreateTemplate}
      />

      {templatesLoading ? (
        <PageState variant="loading" fullHeight={false} className="min-h-0 rounded-md border border-border" />
      ) : (
        <TemplateRows
          templates={templates}
          isGenerating={generateSessions.isPending}
          onGenerate={handleGenerateTemplate}
        />
      )}
    </div>
  );
}
