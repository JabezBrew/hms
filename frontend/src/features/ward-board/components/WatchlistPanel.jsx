import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  URGENCY_STYLES,
  getPatientBed,
  getPatientId,
  getPatientMrn,
  getPatientName,
  getPatientTaskCount,
  getPatientUrgency,
  patientChronicleHref,
} from './wardBoardUtils';

export function WatchlistPanel({ patients, className }) {
  return (
    <aside className={cn('space-y-3 border-t border-border bg-card/40 p-4 lg:border-l lg:border-t-0 lg:p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase text-muted-foreground">Watchlist</p>
          <h2 className="font-heading text-base font-semibold text-foreground">Urgent Patients</h2>
        </div>
        <AlertTriangle className="h-4 w-4 text-rose-600" aria-hidden="true" />
      </div>

      {patients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background/70 px-3 py-5 text-sm text-muted-foreground">
          No urgent patients on this page.
        </div>
      ) : (
        <div className="space-y-2">
          {patients.slice(0, 8).map((patient, index) => {
            const urgency = getPatientUrgency(patient);
            const patientId = getPatientId(patient) ?? index;
            return (
              <Link
                key={patientId}
                to={patientChronicleHref(patient)}
                className="block rounded-lg border border-border bg-background/80 p-3 transition-colors hover:border-amber-300 hover:bg-amber-50/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base text-foreground">{getPatientName(patient)}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {[getPatientBed(patient), getPatientMrn(patient)].filter(Boolean).join(' / ')}
                    </p>
                  </div>
                  <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn('font-mono text-[10px]', URGENCY_STYLES[urgency] ?? URGENCY_STYLES.critical)}>
                    {urgency}
                  </Badge>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {getPatientTaskCount(patient)} tasks
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}
