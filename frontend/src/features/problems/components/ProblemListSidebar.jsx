import { useMemo, useState } from 'react';
import { CheckCircle2, Plus, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useChangeProblemStatus, usePatientProblems } from '../hooks';
import AddProblemDialog from './AddProblemDialog';

const PRIORITY_DOT = {
  high: 'bg-destructive',
  medium: 'bg-primary',
  low: 'bg-muted-foreground',
};

const VERIFICATION_BADGE = {
  provisional: { label: 'Provisional', variant: 'outline' },
  differential: { label: 'Differential', variant: 'outline' },
  confirmed: { label: 'Confirmed', variant: 'secondary' },
  refuted: { label: 'Refuted', variant: 'destructive' },
};

function ProblemRow({ problem, onResolve }) {
  const verification = VERIFICATION_BADGE[problem.verification_status] || null;
  return (
    <li className="group flex items-start gap-3 p-3 rounded-lg bg-card/50 border border-border hover:border-border/80 transition-colors">
      <div
        className={cn(
          'w-2 h-2 rounded-full mt-1.5 shrink-0',
          PRIORITY_DOT[problem.priority] || PRIORITY_DOT.medium,
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-foreground/90 text-sm font-medium truncate">{problem.label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {problem.code_value && (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {problem.code_value}
            </span>
          )}
          {verification && (
            <Badge variant={verification.variant} className="text-[10px] py-0 h-4">
              {verification.label}
            </Badge>
          )}
          {problem.chronicity === 'chronic' && (
            <Badge variant="outline" className="text-[10px] py-0 h-4">Chronic</Badge>
          )}
          {problem.onset_date && (
            <span className="text-[10px] text-muted-foreground">
              Since {problem.onset_date}
            </span>
          )}
        </div>
      </div>
      {onResolve && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Mark resolved"
          onClick={() => onResolve(problem)}
        >
          <CheckCircle2 className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}

/**
 * ProblemListSidebar — read/write widget for PatientChroniclePage.
 *
 * Shows active problems, adds new, resolves existing. Not facility data — all
 * actions flow through the problems API, which is feature-gated.
 */
export default function ProblemListSidebar({ patientId, canEdit = true, className }) {
  const [showResolved, setShowResolved] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = usePatientProblems(patientId, {
    includeResolved: showResolved,
  });
  const changeStatus = useChangeProblemStatus(patientId);

  const { active, resolved } = useMemo(() => {
    const list = data || [];
    return {
      active: list.filter((p) => p.clinical_status === 'active'),
      resolved: list.filter((p) => p.clinical_status !== 'active'),
    };
  }, [data]);

  const handleResolve = async (problem) => {
    try {
      await changeStatus.mutateAsync({
        id: problem.id,
        to_status: 'resolved',
      });
      toast.success(`${problem.label} marked resolved.`);
    } catch (err) {
      toast.error(err?.message || 'Failed to resolve problem.');
    }
  };

  return (
    <section className={className}>
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Problem List
          </h3>
          <span className="font-mono text-xs text-primary">{active.length}</span>
        </div>
        {canEdit && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title="Add problem"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active problems.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((p) => (
            <ProblemRow
              key={p.id}
              problem={p}
              onResolve={canEdit ? handleResolve : null}
            />
          ))}
        </ul>
      )}

      <div className="mt-3">
        <Button
          variant="link"
          size="sm"
          className="px-0 h-auto text-xs text-muted-foreground"
          onClick={() => setShowResolved((v) => !v)}
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          {showResolved ? 'Hide resolved' : `Show resolved${resolved.length ? ` (${resolved.length})` : ''}`}
        </Button>
      </div>

      {showResolved && resolved.length > 0 && (
        <ul className="mt-2 space-y-2 opacity-70">
          {resolved.map((p) => (
            <ProblemRow key={p.id} problem={p} />
          ))}
        </ul>
      )}

      <AddProblemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={patientId}
      />
    </section>
  );
}
