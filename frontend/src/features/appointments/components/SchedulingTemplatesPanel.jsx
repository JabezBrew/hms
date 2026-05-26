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
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TimePicker } from '@/components/ui/time-picker';
import { cn } from '@/lib/utils';
import { PageState } from '@/shared/components/page/PageState';

const todayIso = () => new Date().toISOString().slice(0, 10);
const EMPTY_SELECT_VALUE = '__none__';
const ANY_SERVICE_VALUE = '__any_service__';

function isoDateFromDate(date) {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`);
}

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
  onSetWeekdays,
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
          <Select
            value={form.clinic_id || EMPTY_SELECT_VALUE}
            onValueChange={(value) => onField('clinic_id', value === EMPTY_SELECT_VALUE ? '' : value)}
          >
            <SelectTrigger id="template-clinic" className="w-full">
              <SelectValue placeholder="Select clinic" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_SELECT_VALUE}>Select clinic</SelectItem>
              {clinics.map((clinic) => (
                <SelectItem key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="template-service">Service</Label>
          <Select
            value={form.service_id || ANY_SERVICE_VALUE}
            onValueChange={(value) => onField('service_id', value === ANY_SERVICE_VALUE ? '' : value)}
            disabled={servicesLoading}
          >
            <SelectTrigger id="template-service" className="w-full">
              <SelectValue placeholder="Any service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_SERVICE_VALUE}>Any service</SelectItem>
              {services.map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="template-mode">Mode</Label>
          <Select value={form.mode} onValueChange={(value) => onField('mode', value)}>
            <SelectTrigger id="template-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="capacity_block">Capacity block</SelectItem>
              <SelectItem value="fixed_slot">Fixed slots</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="template-starts-on">Starts on</Label>
          <DatePicker
            id="template-starts-on"
            date={dateFromIso(form.starts_on)}
            setDate={(date) => onField('starts_on', isoDateFromDate(date))}
            placeholder="Select start date"
          />
        </div>
        <div>
          <Label htmlFor="template-start">Start</Label>
          <TimePicker
            id="template-start"
            value={form.start_time}
            onChange={(value) => onField('start_time', value)}
          />
        </div>
        <div>
          <Label htmlFor="template-end">End</Label>
          <TimePicker
            id="template-end"
            value={form.end_time}
            onChange={(value) => onField('end_time', value)}
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
        {form.mode === 'fixed_slot' ? (
          <div>
            <Label htmlFor="template-slot-minutes">Slot minutes</Label>
            <Input
              id="template-slot-minutes"
              type="number"
              min="1"
              value={form.slot_minutes}
              onChange={(event) => onField('slot_minutes', event.target.value)}
            />
          </div>
        ) : null}
        <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border px-3">
          <Label htmlFor="template-overbooking" className="font-mono text-xs">
            Allow overbooking
          </Label>
          <Switch
            id="template-overbooking"
            checked={Boolean(form.allow_overbooking)}
            onCheckedChange={(checked) => onField('allow_overbooking', checked)}
          />
        </div>
        {form.allow_overbooking ? (
          <div>
            <Label htmlFor="template-overbook-limit">Overbook limit</Label>
            <Input
              id="template-overbook-limit"
              type="number"
              min="0"
              value={form.overbook_limit}
              onChange={(event) => onField('overbook_limit', event.target.value)}
            />
          </div>
        ) : null}
        <fieldset className="lg:col-span-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <legend className="text-sm font-medium text-foreground">Repeat days</legend>
            <div className="flex flex-wrap justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSetWeekdays([1, 2, 3, 4, 5])}
                className="h-7 px-2 font-mono text-[10px]"
              >
                Weekdays
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSetWeekdays([6, 7])}
                className="h-7 px-2 font-mono text-[10px]"
              >
                Weekends
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSetWeekdays([1, 2, 3, 4, 5, 6, 7])}
                className="h-7 px-2 font-mono text-[10px]"
              >
                All
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSetWeekdays([])}
                className="h-7 px-2 font-mono text-[10px]"
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {weekdays.map((weekday) => (
              <Button
                key={weekday.value}
                type="button"
                variant="outline"
                onClick={() => onToggleWeekday(weekday.value)}
                aria-pressed={form.weekdays.includes(weekday.value)}
                aria-label={`Repeat on ${weekday.fullLabel}`}
                className={cn(
                  'h-9 px-3 font-mono text-xs transition-colors',
                  form.weekdays.includes(weekday.value)
                    ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border-border bg-background hover:bg-muted'
                )}
              >
                {weekday.label}
              </Button>
            ))}
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

  const handleSetTemplateWeekdays = (weekdays) => {
    setTemplateForm((current) => ({ ...current, weekdays }));
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
        onSetWeekdays={handleSetTemplateWeekdays}
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
