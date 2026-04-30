import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { formatTimestamp } from './wardBoardUtils';

function SummaryLine({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm text-foreground">{value ?? 0}</span>
    </div>
  );
}

export function BoardSummaryDrawer({
  open,
  onOpenChange,
  summary,
  viewLabel,
  ward,
  search,
  count,
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <SheetTitle className="font-display text-2xl">Board Summary</SheetTitle>
          </div>
          <SheetDescription>
            Current ward board slice and page-local operational counts.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6 pr-1">
          <section className="rounded-lg border border-border bg-card/70 p-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="font-mono text-[10px]">
                {viewLabel}
              </Badge>
              {ward ? (
                <Badge variant="outline" className="font-mono text-[10px]">
                  Ward {ward}
                </Badge>
              ) : null}
              {search ? (
                <Badge variant="outline" className="font-mono text-[10px]">
                  Search active
                </Badge>
              ) : null}
            </div>
            <div className="mt-4 space-y-0">
              <SummaryLine label="Total patients" value={summary.totalPatients} />
              <SummaryLine label="Visible patients" value={count} />
              <SummaryLine label="Open tasks" value={summary.openTasks} />
              <SummaryLine label="Urgent patients" value={summary.critical} />
              <SummaryLine label="Pending results" value={summary.pendingResults} />
              <SummaryLine label="Discharge work" value={summary.dischargeReady} />
              <SummaryLine label="Assigned to me" value={summary.myWork} />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-background/70 p-4">
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{formatTimestamp(summary.lastUpdated)}</span>
            </div>
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
