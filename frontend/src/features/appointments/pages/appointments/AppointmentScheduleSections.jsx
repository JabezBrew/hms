import CircleOff from 'lucide-react/dist/esm/icons/circle-off.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';

import { cn } from '@/lib/utils';
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
import { PageState } from '@/shared/components/page/PageState';

import {
  ANY_SERVICE_VALUE,
  dateFromIso,
  EMPTY_SELECT_VALUE,
  formatDateTime,
  isoDateFromDate,
  sessionStatus,
  statusClass,
} from './appointmentsPageUtils';

export function SessionRows({ sessions, emptyTitle }) {
  if (!sessions?.length) {
    return (
      <PageState
        variant="empty"
        title={emptyTitle}
        description="Create a session or widen the selected filters."
        fullHeight={false}
        className="min-h-0 rounded-md border border-dashed border-border bg-card/40 py-10"
      />
    );
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border bg-card">
      {sessions.map((session) => {
        const status = sessionStatus(session);
        return (
          <div key={session.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{session.name}</h3>
                <Badge className={cn('font-mono text-[11px]', statusClass(status))}>
                  {status}
                </Badge>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {session.mode === 'fixed_slot' ? 'fixed slots' : 'capacity block'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDateTime(session.starts_at)} - {formatDateTime(session.ends_at)}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-right font-mono text-xs">
              <span>
                <b className="block text-base text-foreground">{session.capacity}</b>
                capacity
              </span>
              <span>
                <b className="block text-base text-foreground">{session.booked_count || 0}</b>
                booked
              </span>
              <span>
                <b className="block text-base text-foreground">{session.remaining_capacity || 0}</b>
                left
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ExceptionRows({ exceptions, sessionsById }) {
  if (!exceptions?.length) {
    return (
      <PageState
        variant="empty"
        title="No exceptions for this day"
        description="Blocked time and unavailable sessions will appear here."
        fullHeight={false}
        className="min-h-0 rounded-md border border-dashed border-border bg-card/40 py-10"
      />
    );
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border bg-card">
      {exceptions.map((exception) => {
        const session = sessionsById.get(exception.session_id);
        return (
          <div key={exception.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {session?.name || 'Practitioner unavailable'}
                </h3>
                <Badge className="badge-chronicle-amber font-mono text-[11px]">
                  exception
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDateTime(exception.starts_at)} - {formatDateTime(exception.ends_at)}
              </p>
            </div>
            <p className="max-w-md text-sm text-muted-foreground lg:text-right">
              {exception.reason}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function SessionForm({
  form,
  clinics,
  services,
  servicesLoading,
  createSession,
  onField,
  onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-md border border-border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Label htmlFor="session-name">Session name</Label>
          <Input
            id="session-name"
            value={form.name}
            onChange={(event) => onField('name', event.target.value)}
            placeholder="Antenatal clinic morning"
          />
        </div>
        <div>
          <Label htmlFor="session-clinic">Clinic</Label>
          <Select
            value={form.clinic_id || EMPTY_SELECT_VALUE}
            onValueChange={(value) => onField('clinic_id', value === EMPTY_SELECT_VALUE ? '' : value)}
          >
            <SelectTrigger id="session-clinic" className="w-full">
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
          <Label htmlFor="session-service">Service</Label>
          <Select
            value={form.service_id || ANY_SERVICE_VALUE}
            onValueChange={(value) => onField('service_id', value === ANY_SERVICE_VALUE ? '' : value)}
            disabled={servicesLoading}
          >
            <SelectTrigger id="session-service" className="w-full">
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
          <Label htmlFor="session-mode">Mode</Label>
          <Select value={form.mode} onValueChange={(value) => onField('mode', value)}>
            <SelectTrigger id="session-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="capacity_block">Capacity block</SelectItem>
              <SelectItem value="fixed_slot">Fixed slots</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="session-date">Date</Label>
          <DatePicker
            id="session-date"
            date={dateFromIso(form.date)}
            setDate={(date) => onField('date', isoDateFromDate(date))}
            placeholder="Select date"
          />
        </div>
        <div>
          <Label htmlFor="session-start">Start</Label>
          <TimePicker
            id="session-start"
            value={form.start_time}
            onChange={(value) => onField('start_time', value)}
          />
        </div>
        <div>
          <Label htmlFor="session-end">End</Label>
          <TimePicker
            id="session-end"
            value={form.end_time}
            onChange={(value) => onField('end_time', value)}
          />
        </div>
        <div>
          <Label htmlFor="session-capacity">Capacity</Label>
          <Input
            id="session-capacity"
            type="number"
            min="1"
            value={form.capacity}
            onChange={(event) => onField('capacity', event.target.value)}
          />
        </div>
        {form.mode === 'fixed_slot' ? (
          <div>
            <Label htmlFor="session-slot-minutes">Slot minutes</Label>
            <Input
              id="session-slot-minutes"
              type="number"
              min="1"
              value={form.slot_minutes}
              onChange={(event) => onField('slot_minutes', event.target.value)}
            />
          </div>
        ) : null}
        <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border px-3">
          <Label htmlFor="session-overbooking" className="font-mono text-xs">
            Allow overbooking
          </Label>
          <Switch
            id="session-overbooking"
            checked={Boolean(form.allow_overbooking)}
            onCheckedChange={(checked) => onField('allow_overbooking', checked)}
          />
        </div>
        {form.allow_overbooking ? (
          <div>
            <Label htmlFor="session-overbook-limit">Overbook limit</Label>
            <Input
              id="session-overbook-limit"
              type="number"
              min="0"
              value={form.overbook_limit}
              onChange={(event) => onField('overbook_limit', event.target.value)}
            />
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={createSession.isPending} className="gap-2">
          <Plus className="size-4" />
          Create Session
        </Button>
      </div>
    </form>
  );
}

export function WaitlistRows({ entries, isLoading, onPromote }) {
  if (isLoading) {
    return (
      <PageState
        variant="loading"
        fullHeight={false}
        className="min-h-0 rounded-md border border-border"
      />
    );
  }

  if (!entries.length) {
    return (
      <PageState
        variant="empty"
        title="No active waitlist entries"
        description="Accepted demand will appear here before promotion."
        fullHeight={false}
        className="min-h-0 rounded-md border border-dashed border-border bg-card/40 py-10"
      />
    );
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border bg-card">
      {entries.map((entry) => (
        <div key={entry.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {entry.patient_name || 'Unknown patient'}
              </h3>
              <Badge className="badge-chronicle-amber font-mono text-[11px]">
                {entry.priority}
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                {entry.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {entry.service} · {entry.patient_mrn || 'No MRN'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onPromote(entry)}>
            Promote
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ExceptionForm({
  form,
  sessions,
  createException,
  onField,
  onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-md border border-border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Label htmlFor="exception-session">Session</Label>
          <Select
            value={form.session_id || EMPTY_SELECT_VALUE}
            onValueChange={(value) => onField('session_id', value === EMPTY_SELECT_VALUE ? '' : value)}
          >
            <SelectTrigger id="exception-session" className="w-full">
              <SelectValue placeholder="Select session" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_SELECT_VALUE}>Select session</SelectItem>
              {sessions.map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="exception-date">Date</Label>
          <DatePicker
            id="exception-date"
            date={dateFromIso(form.date)}
            setDate={(date) => onField('date', isoDateFromDate(date))}
            placeholder="Select date"
          />
        </div>
        <div>
          <Label htmlFor="exception-start">Start</Label>
          <TimePicker
            id="exception-start"
            value={form.start_time}
            onChange={(value) => onField('start_time', value)}
          />
        </div>
        <div>
          <Label htmlFor="exception-end">End</Label>
          <TimePicker
            id="exception-end"
            value={form.end_time}
            onChange={(value) => onField('end_time', value)}
          />
        </div>
        <div className="lg:col-span-4">
          <Label htmlFor="exception-reason">Reason</Label>
          <Input
            id="exception-reason"
            value={form.reason}
            onChange={(event) => onField('reason', event.target.value)}
            placeholder="Public holiday, room unavailable, practitioner absence"
          />
        </div>
        <div className="flex items-end justify-end">
          <Button type="submit" disabled={createException.isPending} className="w-full gap-2 lg:w-auto">
            <CircleOff className="size-4" />
            Block Time
          </Button>
        </div>
      </div>
    </form>
  );
}
