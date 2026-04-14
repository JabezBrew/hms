import MapPinned from 'lucide-react/dist/esm/icons/map-pinned.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useMemo } from "react";
import format from "date-fns/format";

import { useChartAssignment, useChartEntries } from "@/features/charts/hooks";
import { formatBodyMapValue } from "./bodyMapUtils";

const ChartBodyMapReview = ({ assignmentId }) => {
  const { data: assignment, isLoading: assignmentLoading } = useChartAssignment(assignmentId);
  const { data: entriesData, isLoading: entriesLoading } = useChartEntries({
    assignment: assignmentId,
    include_data: true,
    ordering: '-observation_datetime',
  });

  const bodyMapFields = useMemo(
    () => (assignment?.template?.fields || []).filter((field) => field.field_type === 'body_map'),
    [assignment?.template?.fields],
  );
  const entries = entriesData?.results || entriesData || [];

  if (assignmentLoading || entriesLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (bodyMapFields.length === 0) {
    return null;
  }

  const recentFindings = entries.flatMap((entry) => (
    bodyMapFields
      .map((field) => ({
        entryId: entry.id,
        fieldName: field.name,
        value: entry.data?.[field.field_key],
        observedAt: entry.observation_datetime,
        notes: entry.notes,
      }))
      .filter((item) => item.value)
  )).slice(0, 8);

  if (recentFindings.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <MapPinned className="h-4 w-4 text-amber-600" />
        <h3 className="font-display text-base text-foreground">Body Map Review</h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {recentFindings.map((finding) => (
          <article key={`${finding.entryId}-${finding.fieldName}`} className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {finding.fieldName}
            </p>
            <p className="mt-1 text-sm text-foreground">{formatBodyMapValue(finding.value)}</p>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
              {format(new Date(finding.observedAt), 'MMM d, yyyy h:mm a')}
            </p>
            {finding.notes && (
              <p className="mt-2 text-xs text-muted-foreground">{finding.notes}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
};

export { ChartBodyMapReview };
export default ChartBodyMapReview;
