/**
 * Shared components for Duty Roster Management
 * Following Chronicle Design System
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import XCircle from 'lucide-react/dist/esm/icons/x-circle.js';

/**
 * Empty state placeholder with Chronicle styling
 */
export const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="text-center py-12 text-muted-foreground">
    <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted/50 border border-border">
      <Icon className="size-5 text-muted-foreground" />
    </div>
    <p className="font-heading text-sm font-medium text-foreground">{title}</p>
    <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">{description}</p>
    {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
  </div>
);

/**
 * Inline field with Chronicle monospace label
 */
export const InlineField = ({ label, children, className }) => (
  <div className={cn('space-y-2', className)}>
    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
      {label}
    </label>
    {children}
  </div>
);

/**
 * Two-column field row
 */
export const FieldRow = ({ children }) => (
  <div className="grid gap-4 sm:grid-cols-2">{children}</div>
);

/**
 * Section header with Chronicle typography
 */
export const RosterHeader = ({ title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
    <div>
      <h3 className="font-heading text-lg font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
    {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
  </div>
);

/**
 * Status indicator for CSV imports
 */
export const CsvStatus = ({ label, count, icon: Icon, tone }) => (
  <div className={cn('flex items-center gap-2 text-xs font-mono uppercase tracking-wide', tone)}>
    <Icon className="size-4" />
    <span>{label}</span>
    <span className="text-sm font-semibold">{count}</span>
  </div>
);

/**
 * CSV status summary bar
 */
export const CSVStatusSummary = ({ errorsCount, conflictsCount, rowsCount }) => (
  <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card px-4 py-3">
    <CsvStatus
      label="Errors"
      count={errorsCount}
      icon={XCircle}
      tone="text-rose-600 dark:text-rose-400"
    />
    <CsvStatus
      label="Conflicts"
      count={conflictsCount}
      icon={AlertTriangle}
      tone="text-amber-600 dark:text-amber-400"
    />
    <CsvStatus
      label="Valid Rows"
      count={rowsCount}
      icon={CheckCircle}
      tone="text-emerald-600 dark:text-emerald-400"
    />
  </div>
);

/**
 * Preview table for CSV imports
 */
export const ImportPreviewTable = ({ rows, columns, caption }) => (
  <div className="rounded-lg border border-border bg-card overflow-hidden">
    <div className="border-b border-border px-4 py-2.5 bg-muted/30">
      <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        {caption}
      </span>
    </div>
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
              <TableHead
                key={col}
                className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground h-9"
              >
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="text-center text-muted-foreground py-8 text-sm"
              >
                No rows to preview
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow key={`${row.line || index}-${index}`}>
                {columns.map((col) => (
                  <TableCell
                    key={`${row.line || index}-${col}`}
                    className="text-xs font-mono py-2"
                  >
                    {row[col] ?? '—'}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  </div>
);

/**
 * CSV guidance panel
 */
export const RosterCsvGuidance = ({ title, columns, example }) => (
  <div className="space-y-3">
    <div>
      <h4 className="font-heading text-sm font-medium text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground mt-0.5">
        Copy-paste a CSV string. Required columns must be present in the header row.
      </p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Required columns
        </p>
        <div className="flex flex-wrap gap-1.5">
          {columns.map((col) => (
            <Badge
              key={col}
              variant="outline"
              className="text-[10px] font-mono bg-background"
            >
              {col}
            </Badge>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Example row
        </p>
        <pre className="text-[10px] font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">
          {example}
        </pre>
      </div>
    </div>
  </div>
);

/**
 * Hook for copy to clipboard functionality
 */
export const useCopyCsv = (value) => {
  const [hasCopied, setHasCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 1500);
    } catch {
      setHasCopied(false);
    }
  };

  return { copy, hasCopied };
};
