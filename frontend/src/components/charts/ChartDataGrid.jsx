/**
 * ChartDataGrid - Chronicle-styled tabular display for chart entries
 *
 * Displays chart entries in a time-based grid with field rows
 * and time columns. Highlights critical values.
 */

import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

import format from "date-fns/format";
import parseISO from "date-fns/parseISO";
import { useChartEntries, useChartAssignment } from "@/hooks/useChartQueries";

const ChartDataGrid = ({
  assignmentId,
  dateRange,
  className,
}) => {
  // Fetch assignment and entries
  const { data: assignment, isLoading: assignmentLoading } = useChartAssignment(assignmentId);
  const { data: entriesData, isLoading: entriesLoading } = useChartEntries({
    assignment: assignmentId,
    ...dateRange,
  });

  const template = assignment?.template;
  const entries = entriesData?.results || entriesData || [];

  // Sort entries by observation time (most recent first for display)
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) =>
      new Date(b.observation_datetime) - new Date(a.observation_datetime)
    );
  }, [entries]);

  // Get non-calculated fields for display
  const displayFields = useMemo(() => {
    if (!template?.fields) return [];
    return template.fields
      .filter((f) => f.field_type !== 'calculated' || template.fields.length <= 5)
      .sort((a, b) => a.display_order - b.display_order);
  }, [template]);

  // Check if a value is critical
  const isCritical = (field, value) => {
    if (value === null || value === undefined) return false;

    const config = field.config || {};
    if (field.field_type === 'numeric' || field.field_type === 'scale') {
      const { critical_low, critical_high } = config;
      if (critical_low !== undefined && value < critical_low) return true;
      if (critical_high !== undefined && value > critical_high) return true;
    }

    return false;
  };

  // Format field value for display
  const formatValue = (field, value) => {
    if (value === null || value === undefined) return '—';

    switch (field.field_type) {
      case 'numeric':
        const config = field.config || {};
        return `${value}${config.unit ? ` ${config.unit}` : ''}`;

      case 'paired':
        if (typeof value === 'object') {
          const fields = config?.fields || [];
          const parts = fields.map((f) => value[f.key] ?? '—');
          return parts.join(config?.separator || '/');
        }
        return String(value);

      case 'boolean':
        return value ? 'Yes' : 'No';

      case 'select':
      case 'scale':
        return String(value);

      case 'multi_select':
        return Array.isArray(value) ? value.join(', ') : String(value);

      default:
        return String(value);
    }
  };

  const isLoading = assignmentLoading || entriesLoading;

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className={cn("text-center py-12 text-muted-foreground", className)}>
        <p>Chart template not found</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className={cn("text-center py-12 text-muted-foreground", className)}>
        <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>No entries recorded yet</p>
      </div>
    );
  }

  return (
    <div className={cn("border border-border rounded-xl overflow-hidden", className)}>
      {/* Header */}
      <div className="px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-base text-foreground">
              {template.name}
            </h3>
            <p className="font-mono text-[10px] text-muted-foreground">
              {entries.length} entries
            </p>
          </div>
        </div>
      </div>

      {/* Grid */}
      <ScrollArea className="w-full">
        <div className="min-w-max">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="sticky left-0 bg-muted/20 px-4 py-2 text-left">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Field
                  </span>
                </th>
                {sortedEntries.slice(0, 12).map((entry) => (
                  <th key={entry.id} className="px-3 py-2 text-center min-w-[80px]">
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {format(parseISO(entry.observation_datetime), 'MMM d')}
                    </div>
                    <div className="font-mono text-xs text-foreground">
                      {format(parseISO(entry.observation_datetime), 'h:mm a')}
                    </div>
                    {entry.has_critical_values && (
                      <AlertTriangle className="h-3 w-3 text-rose-500 mx-auto mt-1" />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayFields.map((field, fieldIndex) => (
                <tr
                  key={field.id}
                  className={cn(
                    "border-b border-border last:border-0",
                    fieldIndex % 2 === 0 ? "bg-background" : "bg-muted/10"
                  )}
                >
                  <td className="sticky left-0 bg-inherit px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-foreground">
                        {field.name}
                      </span>
                      {field.config?.unit && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          ({field.config.unit})
                        </span>
                      )}
                    </div>
                  </td>
                  {sortedEntries.slice(0, 12).map((entry) => {
                    const value = entry.data?.[field.field_key];
                    const critical = isCritical(field, value);

                    return (
                      <td
                        key={entry.id}
                        className={cn(
                          "px-3 py-2 text-center",
                          critical && "bg-rose-50 dark:bg-rose-900/20"
                        )}
                      >
                        <span className={cn(
                          "font-mono text-sm",
                          value === null || value === undefined
                            ? "text-muted-foreground"
                            : critical
                              ? "text-rose-600 dark:text-rose-400 font-medium"
                              : "text-foreground"
                        )}>
                          {formatValue(field, value)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Notes row */}
              <tr className="bg-muted/10">
                <td className="sticky left-0 bg-muted/10 px-4 py-2">
                  <span className="font-mono text-sm text-muted-foreground italic">
                    Notes
                  </span>
                </td>
                {sortedEntries.slice(0, 12).map((entry) => (
                  <td key={entry.id} className="px-3 py-2 text-center">
                    {entry.notes ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {entry.notes.length > 20
                          ? `${entry.notes.substring(0, 20)}...`
                          : entry.notes}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ))}
              </tr>

              {/* Recorded by row */}
              <tr className="border-t border-border bg-muted/20">
                <td className="sticky left-0 bg-muted/20 px-4 py-2">
                  <span className="font-mono text-[10px] text-muted-foreground uppercase">
                    Recorded by
                  </span>
                </td>
                {sortedEntries.slice(0, 12).map((entry) => (
                  <td key={entry.id} className="px-3 py-2 text-center">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {entry.recorded_by_name || '—'}
                    </span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Footer */}
      {entries.length > 12 && (
        <div className="px-4 py-2 border-t border-border bg-muted/20">
          <p className="font-mono text-[10px] text-muted-foreground text-center">
            Showing 12 of {entries.length} entries. Scroll horizontally for more.
          </p>
        </div>
      )}
    </div>
  );
};

export { ChartDataGrid };
export default ChartDataGrid;
