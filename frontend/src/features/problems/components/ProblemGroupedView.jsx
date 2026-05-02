import { ChevronRight, FileText, Pill, FlaskConical, CalendarDays } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const KIND_META = {
  note: { label: 'Note', Icon: FileText },
  prescription: { label: 'Rx', Icon: Pill },
  lab_order: { label: 'Lab', Icon: FlaskConical },
  encounter: { label: 'Encounter', Icon: CalendarDays },
};

function useGroupedView(patientId) {
  return useQuery({
    queryKey: ['problems', 'grouped', patientId],
    queryFn: ({ signal }) =>
      apiClient.get('/problems/grouped-by-problem/', {
        signal,
        params: { patient: patientId },
      }),
    enabled: !!patientId,
    staleTime: 30_000,
  });
}

/**
 * ProblemGroupedView
 *
 * Shows a patient's active problems with the artifacts linked to each.
 * Renders one card per problem; empty problems still appear so clinicians can
 * see where documentation gaps exist.
 */
export default function ProblemGroupedView({ patientId, className }) {
  const { data, isLoading } = useGroupedView(patientId);
  const groups = data?.groups || [];

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active problems on this patient.
      </p>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {groups.map(({ problem, entry_count, entries }) => (
        <Card key={problem.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="truncate">{problem.label}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {entry_count}
              </span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {problem.code_value && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {problem.code_value}
                </span>
              )}
              {problem.chronicity === 'chronic' && (
                <Badge variant="outline" className="text-[10px] py-0 h-4">Chronic</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No documentation linked yet.
              </p>
            ) : (
              <ul className="divide-y">
                {entries.map((e) => {
                  const meta = KIND_META[e.kind] || KIND_META.note;
                  return (
                    <li key={`${e.kind}-${e.id}`} className="flex items-center gap-2 py-2">
                      <meta.Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-mono uppercase text-muted-foreground w-16">
                        {meta.label}
                      </span>
                      <span className="text-sm flex-1 truncate">{e.summary}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
