import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { cn } from '@/lib/utils';

function SummarySection({ title, items, accent }) {
  const titleColors = {
    rose: 'text-rose-600',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    neutral: 'text-foreground',
  };
  return (
    <div className="min-w-[12rem] flex-1">
      <h3 className={cn('mb-2 font-mono text-[11px] font-semibold uppercase tracking-wide', titleColors[accent])}>
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

export function BoardSummaryDrawer({ open, onOpenChange, summary, patients = [] }) {
  const critical = patients
    .filter((p) => ['critical', 'urgent', 'high'].includes(String(p?.urgency ?? p?.priority ?? p?.risk_level ?? p?.status ?? '').toLowerCase()))
    .slice(0, 4)
    .map((p) => ({
      bed: p?.bed_label ?? p?.bed_name ?? p?.bed?.label ?? p?.bed_number ?? '—',
      label: p?.patient_name ?? p?.name ?? 'Patient',
      badge: p?.problem_summary ? String(p.problem_summary).split(',')[0].trim() : null,
    }));

  const pending = patients
    .filter((p) => (p?.reviews_due_count ?? 0) > 0 || (p?.pending_results_count ?? 0) > 0)
    .slice(0, 4)
    .map((p) => ({
      bed: p?.bed_label ?? p?.bed_name ?? p?.bed?.label ?? p?.bed_number ?? '—',
      label: p?.patient_name ?? p?.name ?? 'Patient',
      badge: (p?.reviews_due_count ?? 0) > 0 ? '1 due soon' : null,
      badgeClass: 'text-amber-600',
    }));

  const discharge = patients
    .filter((p) => p?.discharge_status && p.discharge_status !== 'none')
    .slice(0, 4)
    .map((p) => ({
      bed: p?.bed_label ?? p?.bed_name ?? p?.bed?.label ?? p?.bed_number ?? '—',
      label: p?.patient_name ?? p?.name ?? 'Patient',
      badge: p?.discharge_blocker_count ? `${p.discharge_blocker_count} reasons` : null,
    }));

  const contingency = patients
    .filter((p) => p?.contingency_plan || p?.escalation_plan)
    .slice(0, 4)
    .map((p) => ({
      bed: p?.bed_label ?? p?.bed_name ?? p?.bed?.label ?? p?.bed_number ?? '—',
      label: p?.patient_name ?? p?.name ?? 'Patient',
      badge: p?.contingency_plan ?? p?.escalation_plan ?? null,
    }));

  if (!open) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card shadow-xl"
      role="complementary"
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
            <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
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
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap gap-6 overflow-x-auto p-4">
        <SummarySection
          title={`Critical (${critical.length})`}
          items={critical}
          accent="rose"
        />
        <SummarySection
          title={`Pending Reviews (${pending.length})`}
          items={pending}
          accent="amber"
        />
        <SummarySection
          title={`Discharge Blockers (${discharge.length})`}
          items={discharge}
          accent="emerald"
        />
        <SummarySection
          title={`Contingency Plans (${contingency.length})`}
          items={contingency}
          accent="neutral"
        />
        <div className="flex min-w-[14rem] flex-1 items-start gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
            This summary is for safety briefing and handover. Data is current as of{' '}
            {summary?.lastUpdated
              ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(summary.lastUpdated))
              : 'now'}{' '}
            and updates automatically with the live board.
          </p>
        </div>
      </div>
    </div>
  );
}
