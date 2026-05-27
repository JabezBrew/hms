import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import User from 'lucide-react/dist/esm/icons/user.js';

import { cn } from '@/lib/utils';
import {
  appointmentStatusConfig,
  formatAppointmentDateTime,
  getAppointmentDuration,
  getAppointmentType,
} from './appointmentDetailUtils';

function ScheduleDetails({ appointment, timeRange }) {
  const { endAt, endDate, startAt, startDate } = timeRange;

  return (
    <article className="bg-card border border-border rounded-xl p-6 animate-chronicle-enter stagger-1">
      <h2 className="font-heading text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
        <Calendar className="size-5 text-[oklch(0.75_0.18_55)]" />
        Schedule Details
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Start Time
          </p>
          <div className="font-mono text-sm text-foreground">
            {formatAppointmentDateTime(startAt)}
          </div>
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            End Time
          </p>
          <div className="font-mono text-sm text-foreground">
            {formatAppointmentDateTime(endAt)}
          </div>
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Duration
          </p>
          <div className="font-mono text-sm text-foreground flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            {getAppointmentDuration(startDate, endDate)}
          </div>
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Appointment Type
          </p>
          <div className="font-mono text-sm text-foreground flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            {getAppointmentType(appointment)}
          </div>
        </div>
      </div>

      {(appointment.description || appointment.reason || appointment.comment || appointment.notes) && (
        <>
          <div className="my-6 h-px bg-gradient-to-r from-border via-border to-transparent" />

          {(appointment.description || appointment.reason) && (
            <div className="space-y-2 mb-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Description
              </p>
              <p className="text-sm text-foreground leading-relaxed">
                {appointment.description || appointment.reason}
              </p>
            </div>
          )}

          {(appointment.comment || appointment.notes) && (
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="size-3" />
                Comments
              </p>
              <p className="text-sm text-muted-foreground italic leading-relaxed">
                "{appointment.comment || appointment.notes}"
              </p>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function ParticipantCard({ icon: Icon, iconClassName, label, name, onOpen, openLabel, participantId }) {
  return (
    <article className="bg-card border border-border rounded-xl p-6 animate-chronicle-enter">
      <h3 className="font-heading text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
        <Icon className={cn("size-4", iconClassName)} />
        {label}
      </h3>

      <div className="space-y-3">
        <button
          type="button"
          disabled={!participantId}
          className={cn(
            "group text-left disabled:cursor-default",
            participantId ? "cursor-pointer" : "cursor-default"
          )}
          onClick={onOpen}
        >
          <div className="font-display text-xl text-foreground group-hover:text-primary transition-colors">
            {name}
          </div>
          {participantId && (
            <span className="font-mono text-xs text-muted-foreground group-hover:text-primary/80 transition-colors">
              {openLabel} -&gt;
            </span>
          )}
        </button>
      </div>
    </article>
  );
}

function AppointmentStatusTimeline({ appointment }) {
  return (
    <article className="bg-card border border-border rounded-xl p-6 animate-chronicle-enter stagger-4">
      <h3 className="font-heading text-sm font-semibold text-foreground mb-4">
        Status
      </h3>

      <div className="space-y-3">
        {['proposed', 'pending', 'booked', 'arrived', 'fulfilled'].map((statusKey, index) => {
          const config = appointmentStatusConfig[statusKey];
          const isActive = appointment.status === statusKey;
          const isPast = ['proposed', 'pending', 'booked', 'arrived', 'fulfilled'].indexOf(appointment.status) > index;

          return (
            <div key={statusKey} className="flex items-center gap-3">
              <div className={cn(
                "size-2.5 rounded-full transition-all",
                isActive ? config.dot : isPast ? "bg-muted-foreground/50" : "bg-muted"
              )} />
              <span className={cn(
                "font-mono text-xs",
                isActive ? "text-foreground font-medium" : "text-muted-foreground"
              )}>
                {config.label}
              </span>
              {isActive && (
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  Current
                </span>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function AppointmentDetailContent({
  appointment,
  onNavigate,
  patient,
  practitioner,
  timeRange,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <ScheduleDetails
          appointment={appointment}
          timeRange={timeRange}
        />
      </div>

      <aside className="space-y-6">
        <ParticipantCard
          icon={User}
          iconClassName="text-[oklch(0.70_0.15_230)]"
          label="Patient"
          name={patient.name}
          onOpen={() => onNavigate(`/patients/${patient.id}`)}
          openLabel="View Chronicle"
          participantId={patient.id}
        />

        <ParticipantCard
          icon={Stethoscope}
          iconClassName="text-[oklch(0.70_0.17_155)]"
          label="Practitioner"
          name={practitioner.name}
          onOpen={() => onNavigate(`/practitioners/${practitioner.id}`)}
          openLabel="View Profile"
          participantId={practitioner.id}
        />

        <AppointmentStatusTimeline appointment={appointment} />
      </aside>
    </div>
  );
}
