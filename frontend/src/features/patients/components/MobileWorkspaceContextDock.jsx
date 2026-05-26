import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import PanelBottomOpen from 'lucide-react/dist/esm/icons/panel-bottom-open.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const WORKSPACE_LABELS = Object.freeze({
  copilot: 'Chronicle copilot',
  note: 'Add note',
  vitals: 'Record vitals',
  prescription: 'Prescribe',
  labs: 'Order labs',
  referral: 'Request consult',
  crossFacility: 'Share record',
  receiveRecord: 'Receive record',
  medicationHistory: 'Medication history',
  treatmentSheet: 'Treatment sheet',
  fluids: 'Record fluids',
  trends: 'Review trends',
  insurance: 'Insurance',
  wardRound: 'Ward round',
  consultation: 'Consultation',
  discharge: 'Discharge',
});

const EMPTY_ARRAY = Object.freeze([]);

function formatTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ContextSection({ icon: Icon, title, children, className }) {
  return (
    <section className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function EmptyContextRow({ children }) {
  return (
    <p className="rounded-md border border-dashed border-border px-3 py-2 font-mono text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function TimelineContext({ notes = EMPTY_ARRAY }) {
  if (notes.length === 0) {
    return <EmptyContextRow>No recent notes in this view.</EmptyContextRow>;
  }

  return (
    <div className="space-y-2">
      {notes.map((note) => (
        <div key={note.id} className="rounded-md border border-border/70 bg-card/50 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium text-foreground">
              {note.title || note.kind || 'Clinical note'}
            </p>
            {note.status && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {note.status}
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {formatTimestamp(note.timestamp) || note.kind || 'Recent entry'}
          </p>
        </div>
      ))}
    </div>
  );
}

function VitalsContext({ vitals = EMPTY_ARRAY }) {
  if (vitals.length === 0) {
    return <EmptyContextRow>No recent vitals available.</EmptyContextRow>;
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {vitals.map((vital) => (
        <div key={vital.name} className="rounded-md bg-muted/60 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {vital.name}
          </p>
          <p className="mt-1 font-mono text-sm text-foreground">
            {vital.value}
            {vital.unit ? <span className="text-muted-foreground"> {vital.unit}</span> : null}
          </p>
        </div>
      ))}
    </div>
  );
}

function MedicationContext({ medications = EMPTY_ARRAY }) {
  if (medications.length === 0) {
    return <EmptyContextRow>No active medications available.</EmptyContextRow>;
  }

  return (
    <div className="space-y-2">
      {medications.map((medication) => (
        <div key={medication.id} className="rounded-md bg-muted/50 px-3 py-2">
          <p className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium text-foreground">
            {medication.name}
          </p>
          {medication.detail && (
            <p className="mt-1 min-w-0 [overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
              {medication.detail}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function LabsContext({ labs = EMPTY_ARRAY }) {
  if (labs.length === 0) {
    return <EmptyContextRow>No recent labs available.</EmptyContextRow>;
  }

  return (
    <div className="space-y-2">
      {labs.map((lab) => (
        <div key={lab.id} className="rounded-md bg-muted/50 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium text-foreground">
              {lab.name}
            </p>
            {lab.flag && (
              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-800">
                {lab.flag}
              </span>
            )}
          </div>
          {lab.detail && (
            <p className="mt-1 min-w-0 [overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
              {lab.detail}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

const MobileWorkspaceContextDock = ({ activeWorkspace, context }) => {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setIsOpen(false);
  }, [activeWorkspace]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!activeWorkspace || !context) {
    return null;
  }

  const workspaceTitle = WORKSPACE_LABELS[activeWorkspace] || 'Workspace';
  const entryLabel = context.entryCount === 1 ? '1 entry' : `${context.entryCount || 0} entries`;

  return (
    <>
      <div className="fixed right-3 top-[5.25rem] z-[120] lg:hidden">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="h-10 gap-2 rounded-full border-border/80 bg-background/95 px-3 font-mono text-xs shadow-lg backdrop-blur"
        >
          <PanelBottomOpen className="h-4 w-4" aria-hidden="true" />
          Context
        </Button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-[130] lg:hidden">
          <button
            type="button"
            aria-label="Close clinical context"
            className="absolute inset-0 bg-background/50 backdrop-blur-[1px]"
            onClick={() => setIsOpen(false)}
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-x-0 bottom-0 flex max-h-[78dvh] flex-col rounded-t-2xl border border-border bg-background shadow-2xl"
          >
            <header className="shrink-0 border-b border-border px-4 py-3">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Clinical context
                  </p>
                  <h2 id={titleId} className="mt-1 font-display text-xl text-foreground">
                    {workspaceTitle}
                  </h2>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close clinical context"
                  className="h-10 w-10 shrink-0"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] chronicle-scrollbar">
              <ContextSection icon={User} title="Patient">
                <div className="rounded-lg border border-border bg-card/60 px-3 py-3">
                  <p className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium text-foreground">
                    {context.patientName || 'Patient'}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {context.visitLabel || 'Visit context'} · {entryLabel}
                  </p>
                </div>
              </ContextSection>

              <ContextSection icon={Calendar} title="Current visit">
                {context.encounter ? (
                  <div className="rounded-lg border border-border bg-card/60 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium text-foreground">
                        {context.encounter.title}
                      </p>
                      {context.encounter.status && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {context.encounter.status}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 min-w-0 [overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
                      {context.encounter.dateRange}
                    </p>
                  </div>
                ) : (
                  <EmptyContextRow>Viewing all history.</EmptyContextRow>
                )}
              </ContextSection>

              <ContextSection icon={FileText} title="Recent notes">
                <TimelineContext notes={context.recentNotes || EMPTY_ARRAY} />
              </ContextSection>

              <ContextSection icon={Activity} title="Latest vitals">
                <VitalsContext vitals={context.latestVitals || EMPTY_ARRAY} />
              </ContextSection>

              <ContextSection icon={Pill} title="Active meds">
                <MedicationContext medications={context.medications || EMPTY_ARRAY} />
              </ContextSection>

              <ContextSection icon={TestTube} title="Recent labs">
                <LabsContext labs={context.labs || EMPTY_ARRAY} />
              </ContextSection>

              {context.lastUpdated && (
                <div className="flex items-center gap-2 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  Context updated {formatTimestamp(context.lastUpdated)}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
};

export default MobileWorkspaceContextDock;
