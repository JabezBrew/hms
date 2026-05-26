import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { asArray, formatTimestamp } from './wardBoardUtils';

function getEventLabel(event) {
  return event?.label ?? event?.title ?? event?.action ?? event?.event_type ?? 'Board event';
}

function getEventMeta(event) {
  return event?.actor_name ?? event?.actor ?? event?.performed_by ?? event?.source;
}

function getEventTone(event) {
  const value = String(event?.tone ?? event?.severity ?? event?.event_type ?? '').toLowerCase();
  if (['critical', 'escalated', 'error'].includes(value)) return 'rose';
  if (['completed', 'resolved'].includes(value)) return 'emerald';
  if (['result', 'review'].includes(value)) return 'sky';
  return 'amber';
}

const TONE_CLASS = {
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
};

export function AuditEventTimeline({ events, emptyLabel = 'No recent board events', className }) {
  const rows = asArray(events).slice(0, 8);

  return (
    <div className={cn('space-y-3', className)}>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background/70 px-3 py-4 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <ol className="relative space-y-3 border-l border-border pl-4">
          {rows.map((event, index) => {
            const tone = getEventTone(event);
            return (
              <li key={event?.id ?? event?.timestamp ?? index} className="relative">
                <span
                  className={cn('absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-4 ring-background', TONE_CLASS[tone])}
                  aria-hidden="true"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{getEventLabel(event)}</p>
                  {event?.status ? (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {event.status}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <Clock className="size-3.5" aria-hidden="true" />
                  <span>{formatTimestamp(event?.timestamp ?? event?.created_at ?? event?.occurred_at)}</span>
                  {getEventMeta(event) ? <span>{getEventMeta(event)}</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
