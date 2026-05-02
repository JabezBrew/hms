import { useMemo, useState } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import {
  useCreateProblemLink,
  useDeleteProblemLink,
  usePatientProblems,
  useProblemLinks,
} from '../hooks';

/**
 * LinkProblemsControl
 *
 * Embedded in note editor / order entry. Lets a clinician link the in-progress
 * artifact (note_entry / prescription / lab_order / encounter) to one or more
 * problems on the patient's problem list.
 *
 * Props (one of source FK is required):
 *   patientId        required
 *   noteEntryId
 *   prescriptionId
 *   labOrderId
 *   encounterId
 */
export default function LinkProblemsControl({
  patientId,
  noteEntryId,
  prescriptionId,
  labOrderId,
  encounterId,
  className,
}) {
  const [open, setOpen] = useState(false);

  const sourceFilters = useMemo(() => {
    if (noteEntryId) return { note_entry: noteEntryId };
    if (prescriptionId) return { prescription: prescriptionId };
    if (labOrderId) return { lab_order: labOrderId };
    if (encounterId) return { encounter: encounterId };
    return null;
  }, [noteEntryId, prescriptionId, labOrderId, encounterId]);

  const sourcePayload = useMemo(() => {
    if (noteEntryId) return { note_entry: noteEntryId };
    if (prescriptionId) return { prescription: prescriptionId };
    if (labOrderId) return { lab_order: labOrderId };
    if (encounterId) return { encounter: encounterId };
    return null;
  }, [noteEntryId, prescriptionId, labOrderId, encounterId]);

  const { data: problems = [] } = usePatientProblems(patientId);
  const { data: links = [] } = useProblemLinks(sourceFilters || {});
  const createLink = useCreateProblemLink();
  const deleteLink = useDeleteProblemLink();

  const linkedProblemIds = new Set(links.map((l) => l.problem));

  if (!sourcePayload || !patientId) return null;

  const linkProblem = async (problemId) => {
    try {
      await createLink.mutateAsync({ problem: problemId, ...sourcePayload });
      toast.success('Problem linked.');
    } catch (err) {
      toast.error(err?.message || 'Failed to link.');
    }
  };

  const unlink = async (linkId) => {
    try {
      await deleteLink.mutateAsync(linkId);
    } catch (err) {
      toast.error(err?.message || 'Failed to remove link.');
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
          Linked problems
        </span>

        {links.map((link) => {
          const problem = problems.find((p) => p.id === link.problem);
          if (!problem) return null;
          return (
            <Badge
              key={link.id}
              variant="secondary"
              className="gap-1 pr-1"
            >
              <span className="truncate max-w-[14rem]">{problem.label}</span>
              <button
                type="button"
                onClick={() => unlink(link.id)}
                className="hover:text-destructive"
                title="Unlink"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs">
              <Plus className="h-3 w-3" /> Link problem
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <div className="p-2 max-h-72 overflow-y-auto">
              {problems.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">
                  No problems on this patient's list yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {problems.map((p) => {
                    const already = linkedProblemIds.has(p.id);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={already || createLink.isPending}
                          onClick={() => {
                            linkProblem(p.id);
                            setOpen(false);
                          }}
                          className={cn(
                            'w-full text-left p-2 rounded text-sm hover:bg-muted/60',
                            already && 'opacity-50 cursor-not-allowed',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate">{p.label}</span>
                            {already && (
                              <span className="text-[10px] text-muted-foreground ml-auto">
                                linked
                              </span>
                            )}
                          </div>
                          {p.code_value && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {p.code_value}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
