import { useState } from "react";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon, Pencil, History } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Pill,
  TestTube,
  Activity,
  Stethoscope,
  ClipboardList,
  UserPlus,
  LogOut,
} from "lucide-react";
import EditNoteSlideOver from "./EditNoteSlideOver";
import NoteHistoryModal from "./NoteHistoryModal";

/**
 * NoteDetailModal - A generic modal for viewing full note content
 *
 * Renders any note data structure in a scrollable dialog.
 * Works with SOAP notes, progress notes, or any structured clinical data.
 */
const NoteDetailModal = ({ open, onOpenChange, entry, onNoteUpdated }) => {
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!entry) return null;

  // Check if this is an editable note type (has an id and data)
  const isEditableNote = entry.id && entry.data && [
    'progress_note', 'soap_note', 'nursing_note', 'admission_note',
    'discharge_note', 'consult_note', 'consult', 'procedure'
  ].includes(entry.type);

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
                <Icon className={cn("h-5 w-5", config.color)} />
                <DialogPrimitive.Title className="text-lg leading-none font-semibold">
                  {entry.title || config.label}
                </DialogPrimitive.Title>
              </div>
              {/* Edit and History buttons */}
              {isEditableNote && (
                <div className="flex items-center gap-1 mr-8">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setHistoryOpen(true)}
                  >
                    <History className="h-3.5 w-3.5 mr-1" />
                    History
                    {entry.version_count > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 bg-muted rounded-full text-[10px]">
                        {entry.version_count}
                      </span>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
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
              {/* Render text content if present (not for lab results) */}
              {entry.content && entry.type !== 'lab_result' && (
                <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                  {entry.content}
                </div>
              )}

              {/* Special rendering for lab results */}
              {entry.type === 'lab_result' && entry.data && (
                <LabResultsDetail data={entry.data} />
              )}

              {/* Render structured data for other types */}
              {entry.type !== 'lab_result' && entry.data && typeof entry.data === 'object' && (
                <GenericDataRenderer data={entry.data} />
              )}
            </div>
          </ScrollArea>

          {/* Close button */}
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
          >
            <XIcon className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {/* Edit Note SlideOver */}
      {isEditableNote && (
        <EditNoteSlideOver
          open={editOpen}
          onOpenChange={setEditOpen}
          entry={entry}
          onSuccess={() => {
            setEditOpen(false);
            onNoteUpdated?.();
          }}
        />
      )}

      {/* Version History Modal */}
      {isEditableNote && (
        <NoteHistoryModal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          noteId={entry.id}
          noteTitle={entry.title || config.label}
        />
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
              {results.map((r, i) => (
                <tr
                  key={i}
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


/**
 * Preferred ordering for clinical note sections
 * Keys not in this list will appear at the end in their original order
 */
const SECTION_ORDER = [
  // SOAP note sections
  'subjective', 'objective', 'assessment', 'plan',
  // Common subjective subsections
  'chief_complaint', 'chiefComplaint', 'history_of_present_illness', 'historyOfPresentIllness',
  'review_of_systems', 'reviewOfSystems', 'current_medications', 'currentMedications',
  'allergies', 'social_history', 'socialHistory', 'family_history', 'familyHistory',
  // Common objective subsections
  'vital_signs', 'vitalSigns', 'physical_exam', 'physicalExam', 'investigations', 'investigations_results',
  // Common assessment subsections
  'primary_diagnosis', 'primaryDiagnosis', 'differential_diagnoses', 'differentialDiagnoses',
  'secondary_findings', 'secondaryFindings', 'clinical_reasoning', 'clinicalReasoning', 'severity',
  // Common plan subsections
  'medications', 'investigations', 'non_pharmacological', 'nonPharmacological',
  'patient_education', 'patientEducation', 'follow_up', 'followUp', 'referrals', 'disposition',
  // Other common sections
  'history', 'examination', 'diagnosis', 'treatment', 'notes', 'findings', 'recommendations'
];

/**
 * Sort object entries according to clinical section ordering
 */
const sortClinicalEntries = (entries) => {
  return [...entries].sort((a, b) => {
    const indexA = SECTION_ORDER.indexOf(a[0].toLowerCase());
    const indexB = SECTION_ORDER.indexOf(b[0].toLowerCase());

    // If both keys are in the order list, sort by their position
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    // If only one key is in the list, it comes first
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    // If neither is in the list, keep original order
    return 0;
  });
};

/**
 * GenericDataRenderer - Recursively renders any data structure
 *
 * Handles strings, arrays, objects, and nested structures.
 * Automatically formats keys to be human-readable.
 * Sorts clinical sections in proper order (e.g., SOAP: Subjective, Objective, Assessment, Plan)
 */
const GenericDataRenderer = ({ data, depth = 0 }) => {
  if (!data) return null;

  // Handle string values
  if (typeof data === 'string') {
    return (
      <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {data}
      </p>
    );
  }

  // Handle arrays
  if (Array.isArray(data)) {
    if (data.length === 0) return null;

    // Check if array contains simple values or objects
    const hasComplexItems = data.some(item => typeof item === 'object' && item !== null);

    if (!hasComplexItems) {
      return (
        <ul className="list-disc list-inside text-sm text-foreground/80 space-y-1">
          {data.map((item, i) => (
            <li key={i}>{String(item)}</li>
          ))}
        </ul>
      );
    }

    return (
      <div className="space-y-3">
        {data.map((item, i) => (
          <div key={i} className="pl-3 border-l-2 border-border/50">
            <GenericDataRenderer data={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  // Handle objects
  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) return null;

    // Sort entries according to clinical section ordering
    const sortedEntries = sortClinicalEntries(entries);

    return (
      <div className={cn("space-y-4", depth > 0 && "space-y-3")}>
        {sortedEntries.map(([key, value]) => {
          // Skip null/undefined values
          if (value === null || value === undefined) return null;
          // Skip empty strings
          if (typeof value === 'string' && value.trim() === '') return null;
          // Skip empty arrays
          if (Array.isArray(value) && value.length === 0) return null;
          // Skip empty objects
          if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return null;

          return (
            <DataSection
              key={key}
              label={key}
              value={value}
              depth={depth}
            />
          );
        })}
      </div>
    );
  }

  // Handle primitives
  return (
    <span className="text-sm text-foreground/80">{String(data)}</span>
  );
};

/**
 * DataSection - Renders a labeled section of data
 */
const DataSection = ({ label, value, depth }) => {
  // Format label: snake_case/camelCase to Title Case
  const formatLabel = (str) => {
    return str
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  // Determine if this is a "major" section (SOAP-like categories or top-level)
  const isMajorSection = depth === 0 && ['subjective', 'objective', 'assessment', 'plan',
    'history', 'examination', 'diagnosis', 'treatment', 'notes', 'findings',
    'chief_complaint', 'history_of_present_illness', 'review_of_systems',
    'physical_exam', 'medications', 'allergies', 'vitals'].includes(label.toLowerCase());

  // Color coding for common clinical sections
  const getSectionColor = (sectionLabel) => {
    const lowerLabel = sectionLabel.toLowerCase();
    if (['subjective', 'chief_complaint', 'history', 'history_of_present_illness'].includes(lowerLabel)) {
      return 'border-blue-500/50 dark:border-blue-400/50';
    }
    if (['objective', 'examination', 'physical_exam', 'vitals', 'findings'].includes(lowerLabel)) {
      return 'border-green-500/50 dark:border-green-400/50';
    }
    if (['assessment', 'diagnosis'].includes(lowerLabel)) {
      return 'border-amber-500/50 dark:border-amber-400/50';
    }
    if (['plan', 'treatment', 'medications'].includes(lowerLabel)) {
      return 'border-purple-500/50 dark:border-purple-400/50';
    }
    return 'border-border';
  };

  const borderColor = isMajorSection ? getSectionColor(label) : 'border-border/50';

  return (
    <div className={cn(
      "border-l-2 pl-4",
      borderColor,
      isMajorSection && "pb-2"
    )}>
      <h5 className={cn(
        "font-mono text-xs uppercase tracking-wider mb-2",
        isMajorSection ? "text-foreground/70 font-semibold" : "text-muted-foreground/70"
      )}>
        {formatLabel(label)}
      </h5>
      <div className={cn(depth > 0 && "text-sm")}>
        <GenericDataRenderer data={value} depth={depth + 1} />
      </div>
    </div>
  );
};

export default NoteDetailModal;
