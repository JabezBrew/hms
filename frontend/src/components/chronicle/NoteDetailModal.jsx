import XIcon from 'lucide-react/dist/esm/icons/x.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import History from 'lucide-react/dist/esm/icons/history.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import { lazy, Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import ChronicleNoteBody from "./ChronicleNoteBody";

const NoteHistoryModal = lazy(() => import("./NoteHistoryModal"));

/**
 * NoteDetailModal - A generic modal for viewing full note content
 *
 * Renders any note data structure in a scrollable dialog.
 * Works with SOAP notes, progress notes, or any structured clinical data.
 *
 * Props:
 * - open: boolean - controls modal visibility
 * - onOpenChange: (open: boolean) => void - callback when modal open state changes
 * - entry: object - the note entry to display
 * - currentUserId: string - current logged-in user's ID for edit permission check
 * - onEditNote: (editData) => void - callback when user clicks edit button
 * - onNoteUpdated: () => void - callback when a note is updated (for legacy compatibility)
 */
const NoteDetailModal = ({ open, onOpenChange, entry, currentUserId, onEditNote, onNoteUpdated: _onNoteUpdated }) => {
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!entry) return null;

  // Check if this is an editable note type (has an id, template, and data)
  // AND the current user is the author
  const isEditableNoteType = entry.id && entry.template && entry.data && [
    'progress_note', 'soap_note', 'nursing_note', 'admission_note',
    'discharge_note', 'consult_note', 'consult', 'procedure'
  ].includes(entry.type);

  // Only allow editing if the current user is the author
  const isEditableNote = isEditableNoteType &&
    currentUserId &&
    entry.author_id &&
    String(currentUserId) === String(entry.author_id);

  // Handle edit button click - calls the onEditNote callback
  const handleEditClick = () => {
    if (!onEditNote) return;

    onEditNote({
      noteId: entry.id,
      template: entry.template,
      templateId: entry.template?.id || entry.template_id,
      templateTitle: entry.template?.title || entry.template_title || entry.title,
      data: entry.data,
      title: entry.title,
    });

    // Close this modal when opening the edit slideover
    onOpenChange(false);
  };

  const entryConfig = {
    progress_note: { icon: FileText, label: 'Progress Note', color: 'text-amber-600' },
    soap_note: { icon: FileText, label: 'SOAP Note', color: 'text-amber-600' },
    vitals: { icon: Activity, label: 'Vitals', color: 'text-emerald-600' },
    medication: { icon: Pill, label: 'Medication', color: 'text-sky-600' },
    prescription: { icon: Pill, label: 'Prescription', color: 'text-sky-600' },
    lab_result: { icon: TestTube, label: 'Lab Result', color: 'text-amber-600' },
    order: { icon: ClipboardList, label: 'Order', color: 'text-sky-600' },
    consult: { icon: Stethoscope, label: 'Consultation', color: 'text-amber-600' },
    consult_note: { icon: Stethoscope, label: 'Consult Note', color: 'text-amber-600' },
    admission: { icon: UserPlus, label: 'Admission', color: 'text-emerald-600' },
    admission_note: { icon: UserPlus, label: 'Admission Note', color: 'text-emerald-600' },
    discharge: { icon: LogOut, label: 'Discharge', color: 'text-emerald-600' },
    discharge_note: { icon: LogOut, label: 'Discharge Note', color: 'text-emerald-600' },
    nursing_note: { icon: FileText, label: 'Nursing Note', color: 'text-sky-600' },
    procedure: { icon: Activity, label: 'Procedure', color: 'text-rose-600' },
  };

  const config = entryConfig[entry.type] || entryConfig.progress_note;
  const Icon = config.icon;

  // Format timestamp for display
  const formatDateTime = (timestamp) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        {/* Overlay - subtle, pointer-events-none so clicks pass through to slideover */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-40 bg-black/20 pointer-events-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />

        {/* Content - positioned on the left side to sit beside any open slideover */}
        <DialogPrimitive.Content
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          className={cn(
            // Position on left side of viewport, leaving room for slideover on right
            "fixed left-4 md:left-8 lg:left-16 top-[50%] translate-y-[-50%]",
            "z-40 w-[calc(100vw-540px)] min-w-[320px] max-w-xl",
            "max-h-[85vh] flex flex-col",
            "bg-background rounded-lg border p-6 shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:slide-out-to-left-4 data-[state=open]:slide-in-from-left-4"
          )}
        >
          {/* Header */}
          <div className="flex flex-col gap-2 text-center sm:text-left flex-shrink-0">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Icon className={cn("size-5", config.color)} />
                <DialogPrimitive.Title className="text-lg leading-none font-semibold">
                  {entry.title || config.label}
                </DialogPrimitive.Title>
              </div>
              {/* Edit and History buttons */}
              {isEditableNoteType && (
                <div className="flex items-center gap-1 mr-8">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setHistoryOpen(true)}
                  >
                    <History className="size-3.5 mr-1" />
                    History
                    {entry.version_count > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 bg-muted rounded-full text-[10px]">
                        {entry.version_count}
                      </span>
                    )}
                  </Button>
                  {/* Edit button only shown to the note author */}
                  {isEditableNote && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={handleEditClick}
                      disabled={!onEditNote}
                    >
                      <Pencil className="size-3.5 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
              )}
            </div>
            <DialogPrimitive.Description className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-mono">{formatDateTime(entry.timestamp)}</span>
              {entry.author && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <span>{entry.author}</span>
                </>
              )}
              {entry.has_edits && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-amber-600">Edited</span>
                </>
              )}
            </DialogPrimitive.Description>
          </div>

          {/* Scrollable content */}
          <ScrollArea className="flex-1 -mx-6 px-6 overflow-auto">
            <div className="space-y-4 py-4">
              {/* Special rendering for lab results */}
              {entry.type === 'lab_result' && entry.data && (
                <LabResultsDetail data={entry.data} />
              )}

              {/* Render note content inline for all note-like entries */}
              {entry.type !== 'lab_result' && (entry.content || entry.data) && (
                <ChronicleNoteBody
                  content={entry.content}
                  data={entry.data}
                />
              )}
            </div>
          </ScrollArea>

          {/* Close button */}
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {/* Version History Modal - viewable by anyone who can view the note */}
      {isEditableNoteType && historyOpen && (
        <Suspense fallback={null}>
          <NoteHistoryModal
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            noteId={entry.id}
            noteTitle={entry.title || config.label}
          />
        </Suspense>
      )}
    </DialogPrimitive.Root>
  );
};

/**
 * LabResultsDetail - Renders lab results in a clean table format
 *
 * Shows order summary and results table similar to the timeline inline view.
 */
const LabResultsDetail = ({ data }) => {
  if (!data) return null;

  const { results_summary: summary, results, order_number, priority_display, clinical_notes } = data;

  // Get flag styling
  const getFlagStyle = (flag, isCritical) => {
    if (isCritical) return 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 font-semibold';
    if (flag === 'low' || flag === 'high' || flag === 'abnormal') {
      return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
    }
    return 'text-emerald-600';
  };

  const getFlagLabel = (flag) => {
    const labels = {
      'critical_low': '↓↓ CRITICAL',
      'critical_high': '↑↑ CRITICAL',
      'low': '↓ Low',
      'high': '↑ High',
      'abnormal': '⚠ Abnormal',
      'normal': '✓',
    };
    return labels[flag] || flag;
  };

  return (
    <div className="space-y-4">
      {/* Order info */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-mono text-sm text-muted-foreground">
          {order_number}
        </span>
        {priority_display && priority_display !== 'Routine' && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
            {priority_display.toUpperCase()}
          </span>
        )}
      </div>

      {/* Clinical notes if present */}
      {clinical_notes && (
        <div className="text-sm text-muted-foreground italic border-l-2 border-border pl-3">
          {clinical_notes}
        </div>
      )}

      {/* Results summary badges */}
      {summary && (
        <div className="flex items-center gap-2 flex-wrap">
          {summary.critical > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
              {summary.critical} critical
            </span>
          )}
          {summary.abnormal > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {summary.abnormal} abnormal
            </span>
          )}
          {summary.normal > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              {summary.normal} normal
            </span>
          )}
        </div>
      )}

      {/* Results table */}
      {results && results.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2.5 text-left font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Test
                </th>
                <th className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Value
                </th>
                <th className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Ref Range
                </th>
                <th className="px-3 py-2.5 text-center font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Flag
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {results.map((r) => (
                <tr
                  key={r.id || `${r.test_name || r.name}-${r.result_value || r.value}-${r.recorded_at || r.date}`}
                  className={cn(
                    "transition-colors",
                    r.is_critical && "bg-rose-50/50 dark:bg-rose-900/10",
                    r.is_abnormal && !r.is_critical && "bg-amber-50/50 dark:bg-amber-900/10"
                  )}
                >
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs text-foreground/90 font-medium">
                      {r.test_name}
                    </span>
                    {r.test_full_name && r.test_full_name !== r.test_name && (
                      <span className="block text-[11px] text-muted-foreground">
                        {r.test_full_name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={cn(
                      "font-mono font-semibold",
                      r.is_critical ? "text-rose-600" : r.is_abnormal ? "text-amber-600" : "text-foreground"
                    )}>
                      {r.value}
                    </span>
                    <span className="text-muted-foreground ml-1 text-xs">
                      {r.unit}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">
                    {r.reference_range || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded text-xs font-mono",
                      getFlagStyle(r.flag, r.is_critical)
                    )}>
                      {getFlagLabel(r.flag)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default NoteDetailModal;
