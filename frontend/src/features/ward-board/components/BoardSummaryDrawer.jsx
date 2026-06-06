import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { cn } from '@/lib/utils';
import {
  getPatientBed,
  getPatientDischargeCount,
  getPatientDueMedicationCount,
  getPatientName,
  getPatientOverdueTaskCount,
  getPatientResultCount,
} from './wardBoardUtils';

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

const DEFAULT_EMPTY_ARRAY = [];
const SUMMARY_TITLE_COLORS = {
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  emerald: 'text-emerald-600',
  neutral: 'text-foreground',
};

function SummarySection({ title, items, accent }) {
  return (
    <div className="min-w-[12rem] flex-1">
      <h3 className={cn('mb-2 font-mono text-[11px] font-semibold uppercase tracking-wide', SUMMARY_TITLE_COLORS[accent])}>
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground">None</p>
      ) : (
        <div className="space-y-0.5">
          {items.map((item, index) => (
            <div key={item.key ?? index} className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-[11px] font-medium text-foreground">{item.bed ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{item.label}</span>
              {item.badge ? (
                <span className={cn('shrink-0 font-mono text-[10px]', item.badgeClass ?? 'text-amber-600')}>{item.badge}</span>
              ) : null}
            </div>
          ))}
          {items.length >= 4 ? (
            <button type="button" className="font-mono text-[10px] text-muted-foreground hover:text-amber-700">
              View all
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function BoardSummaryDrawer({ open, onOpenChange, summary, patients = DEFAULT_EMPTY_ARRAY }) {
  const critical = patients
    .filter((p) => Number(p?.active_alert_count ?? 0) > 0)
    .slice(0, 4)
    .map((p) => ({
      bed: getPatientBed(p) ?? '—',
      label: getPatientName(p),
      badge: Number(p?.critical_alert_count ?? 0) > 0
        ? `${p.critical_alert_count} critical`
        : `${p.active_alert_count} active`,
      badgeClass: Number(p?.critical_alert_count ?? 0) > 0 ? 'text-rose-600' : 'text-amber-600',
    }));

  const dueWork = patients
    .filter((p) => getPatientOverdueTaskCount(p) > 0 || getPatientDueMedicationCount(p) > 0)
    .slice(0, 4)
    .map((p) => ({
      bed: getPatientBed(p) ?? '—',
      label: getPatientName(p),
      badge: getPatientOverdueTaskCount(p) > 0
        ? `${getPatientOverdueTaskCount(p)} overdue`
        : `${getPatientDueMedicationCount(p)} meds due`,
      badgeClass: getPatientOverdueTaskCount(p) > 0 ? 'text-rose-600' : 'text-amber-600',
    }));

  const results = patients
    .filter((p) => getPatientResultCount(p) > 0)
    .slice(0, 4)
    .map((p) => ({
      bed: getPatientBed(p) ?? '—',
      label: getPatientName(p),
      badge: Number(p?.critical_unverified_result_count ?? 0) > 0
        ? `${p.critical_unverified_result_count} critical`
        : `${getPatientResultCount(p)} review`,
      badgeClass: Number(p?.critical_unverified_result_count ?? 0) > 0 ? 'text-rose-600' : 'text-sky-600',
    }));

  const discharge = patients
    .filter((p) => getPatientDischargeCount(p) > 0)
    .slice(0, 4)
    .map((p) => ({
      bed: getPatientBed(p) ?? '—',
      label: getPatientName(p),
      badge: `${getPatientDischargeCount(p)} blockers`,
      badgeClass: 'text-amber-600',
    }));

  if (!open) return null;

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card shadow-xl"
      aria-label="Board summary"
    >
      <div className="flex h-11 items-center justify-between gap-4 border-b border-border/60 px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5"
            onClick={() => onOpenChange(false)}
            aria-label="Collapse board summary"
          >
            <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-heading text-sm font-semibold text-foreground">Board Summary</span>
          </button>
          <span className="font-mono text-[11px] text-muted-foreground">Generated from live board</span>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close board summary"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap gap-6 overflow-x-auto p-4">
        <SummarySection
          title={`Safety Alerts (${critical.length})`}
          items={critical}
          accent="rose"
        />
        <SummarySection
          title={`Due Work (${dueWork.length})`}
          items={dueWork}
          accent="amber"
        />
        <SummarySection
          title={`Results to Review (${results.length})`}
          items={results}
          accent="neutral"
        />
        <SummarySection
          title={`Discharge Blockers (${discharge.length})`}
          items={discharge}
          accent="amber"
        />
        <div className="flex min-w-[14rem] flex-1 items-start gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
          <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
            This summary is for safety briefing and handover. Data is current as of{' '}
            {summary?.lastUpdated
              ? TIME_FORMATTER.format(new Date(summary.lastUpdated))
              : 'now'}{' '}
            and updates automatically with the live board.
          </p>
        </div>
      </div>
    </aside>
  );
}
