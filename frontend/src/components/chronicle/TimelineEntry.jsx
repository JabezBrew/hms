import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import Expand from 'lucide-react/dist/esm/icons/expand.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import PauseCircle from 'lucide-react/dist/esm/icons/circle-pause.js';
import PlayCircle from 'lucide-react/dist/esm/icons/circle-play.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import { lazy, Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  hasEntryDetailContent,
  isInlineExpandableNoteEntry,
  normalizeExpansionId,
} from "./chronicleNoteUtils";

const NoteDetailModal = lazy(() => import("./NoteDetailModal"));
const PrescriptionActionsDialog = lazy(() => import("./PrescriptionActionsDialog"));
const CopyNoteModal = lazy(() => import("./CopyNoteModal"));
const ChronicleNoteBody = lazy(() => import("./ChronicleNoteBody"));

/**
 * TimelineEntry - A chronological entry in the patient's clinical chronicle
 *
 * Entry types:
 * - progress_note: Clinical progress note
 * - vitals: Vital signs recording
 * - medication: Medication administration
 * - lab_result: Laboratory result
 * - order: Clinical order
 * - consult: Consultation request/note
 * - admission: Patient admission
 * - discharge: Patient discharge
 * - procedure: Procedure performed
 * - referral: Referral request/consultation result
 */
const TimelineEntry = ({
  entry,
  index = 0,
  isRecent = false,
  className,
  currentUserId,  // Current logged-in user's ID for edit permission check
  onCopyNote,  // Callback when user confirms copy: (copyData) => void
  onEditNote,  // Callback when user clicks edit: (editData) => void
  onNoteUpdated, // Callback when a note is updated (for edit feature)
  isNoteExpanded,
  onToggleNoteExpanded,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
  const [isFallbackNoteExpanded, setIsFallbackNoteExpanded] = useState(false);

  // ============================================
  // Entry type configuration
  // ============================================

  const entryConfig = {
    progress_note: {
      icon: FileText,
      label: 'Progress Note',
      color: 'amber',
      nodeClass: 'timeline-node-amber'
    },
    soap_note: {
      icon: FileText,
      label: 'SOAP Note',
      color: 'amber',
      nodeClass: 'timeline-node-amber'
    },
    vitals: {
      icon: Activity,
      label: 'Vitals',
      color: 'emerald',
      nodeClass: 'timeline-node-emerald'
    },
    medication: {
      icon: Pill,
      label: 'Medication',
      color: 'sky',
      nodeClass: 'timeline-node-sky'
    },
    prescription: {
      icon: Pill,
      label: 'Prescription',
      color: 'sky',
      nodeClass: 'timeline-node-sky'
    },
    lab_result: {
      icon: TestTube,
      label: 'Lab Result',
      color: 'sky',
      nodeClass: 'timeline-node-sky'
    },
    order: {
      icon: ClipboardList,
      label: 'Order',
      color: 'sky',
      nodeClass: 'timeline-node-sky'
    },
    consult: {
      icon: Stethoscope,
      label: 'Consultation',
      color: 'amber',
      nodeClass: 'timeline-node-amber'
    },
    consult_note: {
      icon: Stethoscope,
      label: 'Consult Note',
      color: 'amber',
      nodeClass: 'timeline-node-amber'
    },
    admission: {
      icon: UserPlus,
      label: 'Admission',
      color: 'emerald',
      nodeClass: 'timeline-node-emerald'
    },
    admission_note: {
      icon: UserPlus,
      label: 'Admission Note',
      color: 'emerald',
      nodeClass: 'timeline-node-emerald'
    },
    discharge: {
      icon: LogOut,
      label: 'Discharge',
      color: 'emerald',
      nodeClass: 'timeline-node-emerald'
    },
    discharge_note: {
      icon: LogOut,
      label: 'Discharge Note',
      color: 'emerald',
      nodeClass: 'timeline-node-emerald'
    },
    nursing_note: {
      icon: FileText,
      label: 'Nursing Note',
      color: 'sky',
      nodeClass: 'timeline-node-sky'
    },
    procedure: {
      icon: Activity,
      label: 'Procedure',
      color: 'rose',
      nodeClass: 'timeline-node-rose'
    },
    referral: {
      icon: Send,
      label: 'Referral',
      color: 'sky',
      nodeClass: 'timeline-node-sky'
    },
    chart: {
      icon: ClipboardList,
      label: 'Chart',
      color: 'amber',
      nodeClass: 'timeline-node-amber'
    }
  };

  const config = entryConfig[entry.type] || entryConfig.progress_note;
  const Icon = config.icon;

  // ============================================
  // Time formatting
  // ============================================

  const formatTime = (timestamp) => {
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
        hour12: true
      });
    } catch {
      return '';
    }
  };

  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  };

  // ============================================
  // Badge color mapping
  // ============================================

  const getBadgeClass = (color) => {
    const badges = {
      amber: 'badge-chronicle-amber',
      emerald: 'badge-chronicle-emerald',
      rose: 'badge-chronicle-rose',
      sky: 'badge-chronicle-sky'
    };
    return badges[color] || badges.amber;
  };

  // ============================================
  // Check if entry has viewable detail content
  // ============================================

  const hasDetailContent = hasEntryDetailContent(entry);
  const canInlineExpand = isInlineExpandableNoteEntry(entry);
  const noteBodyId = normalizeExpansionId(entry?.id)
    ? `chronicle-note-body-${normalizeExpansionId(entry.id)}`
    : undefined;
  const noteExpanded = typeof isNoteExpanded === 'boolean'
    ? isNoteExpanded
    : isFallbackNoteExpanded;

  // ============================================
  // Check if entry is a copyable clinical note
  // ============================================

  const isCopyableNote = () => {
    // Note types that can be copied
    const copyableTypes = [
      'progress_note', 'soap_note', 'nursing_note', 'admission_note',
      'discharge_note', 'consult_note', 'procedure'
    ];
    // Must have an id and be a note type with data
    return copyableTypes.includes(entry.type) &&
           entry.id &&
           entry.data &&
           typeof entry.data === 'object';
  };

  // ============================================
  // Check if entry is an editable clinical note
  // ============================================

  const isEditableNote = () => {
    // Note types that can be edited (same as copyable)
    const editableTypes = [
      'progress_note', 'soap_note', 'nursing_note', 'admission_note',
      'discharge_note', 'consult_note', 'procedure'
    ];
    // Must have an id, template info, and be a note type with data
    const isEditableType = editableTypes.includes(entry.type) &&
           entry.id &&
           entry.template &&
           entry.data &&
           typeof entry.data === 'object';

    if (!isEditableType) return false;

    // Only the author can edit their own notes
    // Compare current user ID with the entry's author_id
    if (!currentUserId || !entry.author_id) return false;

    return String(currentUserId) === String(entry.author_id);
  };

  // ============================================
  // Handle edit note click
  // ============================================

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
  };

  const handleToggleNoteExpanded = () => {
    if (!canInlineExpand) {
      return;
    }

    if (onToggleNoteExpanded && entry?.id !== null && entry?.id !== undefined) {
      onToggleNoteExpanded(entry.id);
      return;
    }

    setIsFallbackNoteExpanded((previous) => !previous);
  };

  // ============================================
  // Render content based on entry type
  // ============================================

  const renderContent = () => {
    switch (entry.type) {
      case 'vitals':
        return <VitalsContent vitals={entry.data} />;
      case 'lab_result':
        return <LabResultContent result={entry.data} />;
      case 'medication':
      case 'prescription':
        return <MedicationContent medication={entry.data} entry={entry} />;
      case 'referral':
        return <ReferralContent referral={entry.data} />;
      case 'chart':
        return <ChartSummaryContent entry={entry} />;
      default:
        if (canInlineExpand && noteExpanded) {
          return (
            <ExpandedNoteContent
              entry={entry}
              noteBodyId={noteBodyId}
            />
          );
        }
        // Generic note preview
        return <NotePreview entry={entry} />;
    }
  };

  // ============================================
  // Render
  // ============================================

  return (
    <article
      className={cn(
        "relative pl-8 pb-8 last:pb-0",
        "animate-chronicle-enter",
        className
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Timeline spine */}
      <div className="timeline-spine" />

      {/* Timeline node */}
      <div className={cn(
        "timeline-node",
        config.nodeClass,
        isRecent && "animate-node-pulse"
      )} />

      {/* Entry content */}
      <div className={cn(
        "bg-card/30 rounded-xl p-5 border border-border/50",
        "hover:border-border transition-colors group"
      )}>
        {/* Meta line */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <time className="font-mono text-xs text-primary">
              {formatTime(entry.timestamp)}
            </time>
            <span className={getBadgeClass(config.color)}>
              <Icon className="h-3 w-3 mr-1 inline" />
              {config.label}
            </span>
            {/* Edited indicator with last edited time */}
            {entry.has_edits && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Pencil className="h-2.5 w-2.5" />
                Edited
                {entry.updated_at && (
                  <span className="text-amber-500/70 ml-1">
                    · {formatRelativeTime(entry.updated_at)}
                  </span>
                )}
              </span>
            )}
          </div>
          {entry.author && (
            <span className="font-mono text-xs text-muted-foreground">
              {entry.author}
            </span>
          )}
        </div>

        {/* Content */}
        {renderContent()}

        {/* Action buttons */}
        {(hasDetailContent || isCopyableNote() || isEditableNote() || canInlineExpand) && (
          <div className="mt-3 flex items-center gap-3">
            {canInlineExpand && (
              <Button
                variant="ghost"
                size="sm"
                className="font-mono text-xs text-primary p-0 h-auto hover:bg-transparent"
                onClick={handleToggleNoteExpanded}
                aria-controls={noteBodyId}
                aria-expanded={noteExpanded}
              >
                {noteExpanded ? (
                  <ChevronUp className="h-3 w-3 mr-1" />
                ) : (
                  <ChevronDown className="h-3 w-3 mr-1" />
                )}
                {noteExpanded ? 'Collapse note' : 'Open note'}
              </Button>
            )}
            {hasDetailContent && (
              <Button
                variant="ghost"
                size="sm"
                className="font-mono text-xs text-primary p-0 h-auto hover:bg-transparent"
                onClick={() => setIsModalOpen(true)}
              >
                <Expand className="h-3 w-3 mr-1" />
                {canInlineExpand ? 'Focus view' : 'View details'}
              </Button>
            )}
            {isEditableNote() && onEditNote && (
              <Button
                variant="ghost"
                size="sm"
                className="font-mono text-xs text-muted-foreground p-0 h-auto hover:bg-transparent hover:text-primary"
                onClick={handleEditClick}
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}
            {isCopyableNote() && (
              <Button
                variant="ghost"
                size="sm"
                className="font-mono text-xs text-muted-foreground p-0 h-auto hover:bg-transparent hover:text-primary"
                onClick={() => setIsCopyModalOpen(true)}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy note
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Note detail modal */}
      {isModalOpen && (
        <Suspense fallback={null}>
          <NoteDetailModal
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            entry={entry}
            currentUserId={currentUserId}
            onEditNote={onEditNote}
            onNoteUpdated={onNoteUpdated}
          />
        </Suspense>
      )}

      {/* Copy note modal */}
      {isCopyableNote() && isCopyModalOpen && (
        <Suspense fallback={null}>
          <CopyNoteModal
            open={isCopyModalOpen}
            onOpenChange={setIsCopyModalOpen}
            noteEntry={{
              id: entry.id,
              template: entry.template,  // Full template object from timeline API
              template_id: entry.template_id,
              template_title: entry.template_title || entry.title || config.label,
              data: entry.data,
            }}
            onCopyConfirm={onCopyNote}
          />
        </Suspense>
      )}
    </article>
  );
};

/**
 * VitalsContent - Renders vital signs data in a grid
 */
const VitalsContent = ({ vitals }) => {
  if (!vitals) return null;

  const vitalItems = [
    { label: 'Temp', value: vitals.temperature, unit: '°C' },
    { label: 'BP', value: vitals.blood_pressure, unit: '' },
    { label: 'HR', value: vitals.heart_rate, unit: ' bpm' },
    { label: 'SpO2', value: vitals.spo2, unit: '%' },
    { label: 'RR', value: vitals.respiratory_rate, unit: '/min' },
  ].filter(item => item.value);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {vitalItems.map((item, i) => (
        <div key={i} className="p-2 rounded-lg bg-background/50">
          <div className="font-mono text-lg text-foreground">
            {item.value}{item.unit}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground uppercase">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * LabResultContent - Renders bundled lab order results
 *
 * Shows order summary with expandable results table.
 * Supports both old single-result format and new bundled format.
 */
const LabResultContent = ({ result }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!result) return null;

  // Handle old single-result format (backwards compatibility)
  if (result.test_name && !result.results) {
    return (
      <div className="space-y-2">
        <h4 className="font-medium text-foreground/90">
          {result.test_name}
        </h4>
        <div className="flex items-baseline gap-3">
          <span className={cn(
            "font-mono text-2xl",
            result.is_abnormal ? "text-destructive" : "text-foreground"
          )}>
            {result.value} {result.unit}
          </span>
          {result.reference_range && (
            <span className="font-mono text-xs text-muted-foreground">
              Ref: {result.reference_range}
            </span>
          )}
          {result.is_abnormal && (
            <span className="badge-chronicle-rose">
              {result.abnormal_flag || 'ABNORMAL'}
            </span>
          )}
        </div>
      </div>
    );
  }

  // New bundled order format
  const { results_summary: summary, results, order_number, priority_display } = result;

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
    <div className="space-y-3">
      {/* Summary row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-xs text-muted-foreground">
          {order_number}
        </span>
        {priority_display && priority_display !== 'Routine' && (
          <span className="badge-chronicle-rose text-[10px]">
            {priority_display.toUpperCase()}
          </span>
        )}

        {/* Results summary badges */}
        <div className="flex items-center gap-2 ml-auto">
          {summary?.critical > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
              {summary.critical} critical
            </span>
          )}
          {summary?.abnormal > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {summary.abnormal} abnormal
            </span>
          )}
          {summary?.normal > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              {summary.normal} normal
            </span>
          )}
        </div>
      </div>

      {/* Results preview (collapsed) - show abnormal/critical only */}
      {!isExpanded && results && results.length > 0 && (
        <div className="space-y-1.5">
          {results
            .filter(r => r.is_abnormal || r.is_critical)
            .slice(0, 3)
            .map((r, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center justify-between px-2 py-1 rounded text-sm",
                  r.is_critical ? "bg-rose-50 dark:bg-rose-900/10" : "bg-amber-50 dark:bg-amber-900/10"
                )}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {r.test_name}
                </span>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "font-mono text-sm font-medium",
                    r.is_critical ? "text-rose-600" : "text-amber-600"
                  )}>
                    {r.value} {r.unit}
                  </span>
                  <span className={cn(
                    "text-[10px] font-mono",
                    getFlagStyle(r.flag, r.is_critical)
                  )}>
                    {getFlagLabel(r.flag)}
                  </span>
                </div>
              </div>
            ))}
          {results.filter(r => r.is_abnormal || r.is_critical).length > 3 && (
            <p className="text-xs text-muted-foreground font-mono pl-2">
              +{results.filter(r => r.is_abnormal || r.is_critical).length - 3} more abnormal...
            </p>
          )}
        </div>
      )}

      {/* Results table (expanded) */}
      {isExpanded && results && results.length > 0 && (
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Test
                </th>
                <th className="px-3 py-2 text-right font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Value
                </th>
                <th className="px-3 py-2 text-right font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Ref Range
                </th>
                <th className="px-3 py-2 text-center font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Flag
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {results.map((r, i) => (
                <tr
                  key={i}
                  className={cn(
                    "transition-colors",
                    r.is_critical && "bg-rose-50/50 dark:bg-rose-900/10",
                    r.is_abnormal && !r.is_critical && "bg-amber-50/50 dark:bg-amber-900/10"
                  )}
                >
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-foreground/80">
                      {r.test_name}
                    </span>
                    {r.test_full_name && r.test_full_name !== r.test_name && (
                      <span className="block text-[10px] text-muted-foreground">
                        {r.test_full_name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(
                      "font-mono font-medium",
                      r.is_critical ? "text-rose-600" : r.is_abnormal ? "text-amber-600" : "text-foreground"
                    )}>
                      {r.value}
                    </span>
                    <span className="text-muted-foreground ml-1 text-xs">
                      {r.unit}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                    {r.reference_range || '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono",
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

      {/* Expand/collapse toggle */}
      {results && results.length > 0 && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-mono transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Hide details
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              View all {results.length} results
            </>
          )}
        </button>
      )}
    </div>
  );
};

/**
 * MedicationContent - Renders medication/prescription data with actions
 */
const MedicationContent = ({ medication, entry }) => {
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);

  if (!medication) return null;

  // Get status from medication data or entry
  const status = medication.status || entry?.data?.status || 'active';
  const prescriptionId = medication.id || entry?.data?.id || entry?.id;

  // Status badge configuration
  const getStatusBadge = (status) => {
    const statusConfig = {
      active: {
        label: 'Active',
        className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
      },
      on_hold: {
        label: 'On Hold',
        className: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
      },
      discontinued: {
        label: 'Discontinued',
        className: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
      },
      completed: {
        label: 'Completed',
        className: 'bg-muted text-muted-foreground border-border',
      },
      draft: {
        label: 'Draft',
        className: 'bg-muted text-muted-foreground border-border',
      },
    };
    return statusConfig[status] || statusConfig.active;
  };

  const statusBadge = getStatusBadge(status);

  // Handle action click
  const handleAction = (action) => {
    setSelectedAction(action);
    setActionDialogOpen(true);
  };

  // Check if actions should be available (only for doctors, and based on status)
  const canEdit = status === 'active' || status === 'on_hold';
  const canDiscontinue = status === 'active' || status === 'on_hold';
  const canHold = status === 'active';
  const canResume = status === 'on_hold';
  const canRenew = status === 'active' || status === 'completed';
  const hasAnyAction = canEdit || canDiscontinue || canHold || canResume || canRenew;

  return (
    <div className="space-y-2">
      {/* Header row with name and status */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium text-foreground/90">
          {medication.name || medication.medication_name}
        </h4>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            "text-[10px] px-2 py-0.5 rounded-full border font-medium",
            statusBadge.className
          )}>
            {statusBadge.label}
          </span>
          {/* Actions dropdown - only show if there are valid actions */}
          {hasAnyAction && prescriptionId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-muted"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Prescription actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {canEdit && (
                  <DropdownMenuItem onClick={() => handleAction('edit')}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Prescription
                  </DropdownMenuItem>
                )}
                {canRenew && (
                  <DropdownMenuItem onClick={() => handleAction('renew')}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Renew
                  </DropdownMenuItem>
                )}
                {(canEdit || canRenew) && (canHold || canResume || canDiscontinue) && (
                  <DropdownMenuSeparator />
                )}
                {canHold && (
                  <DropdownMenuItem onClick={() => handleAction('hold')}>
                    <PauseCircle className="h-4 w-4 mr-2" />
                    Put on Hold
                  </DropdownMenuItem>
                )}
                {canResume && (
                  <DropdownMenuItem onClick={() => handleAction('resume')}>
                    <PlayCircle className="h-4 w-4 mr-2" />
                    Resume
                  </DropdownMenuItem>
                )}
                {canDiscontinue && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleAction('discontinue')}
                      className="text-destructive focus:text-destructive"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Discontinue
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Medication details */}
      <p className="font-mono text-sm text-muted-foreground">
        {medication.dose || medication.dosage} {medication.route_display || medication.route}
        {(medication.frequency || medication.frequency_display) &&
          ` · ${medication.frequency_display || medication.frequency}`}
      </p>

      {/* Duration info */}
      {medication.duration_days && (
        <p className="text-xs text-muted-foreground">
          Duration: {medication.duration_days} days
          {medication.end_date && ` (ends ${new Date(medication.end_date).toLocaleDateString()})`}
        </p>
      )}

      {/* Instructions/notes */}
      {(medication.notes || medication.instructions) && (
        <p className="text-sm text-muted-foreground mt-2 italic">
          {medication.notes || medication.instructions}
        </p>
      )}

      {/* Discontinue reason if discontinued */}
      {status === 'discontinued' && medication.discontinue_reason && (
        <p className="text-xs text-rose-600 mt-2">
          Reason: {medication.discontinue_reason}
        </p>
      )}

      {/* Actions dialog */}
      {actionDialogOpen && (
        <Suspense fallback={null}>
          <PrescriptionActionsDialog
            open={actionDialogOpen}
            onOpenChange={setActionDialogOpen}
            prescription={{ ...medication, id: prescriptionId }}
            action={selectedAction}
            onSuccess={() => {
              // Dialog handles toast, just close
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

/**
 * ReferralContent - Renders referral/consultation data
 */
const ReferralContent = ({ referral }) => {
  if (!referral) return null;

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20';
      case 'accepted':
      case 'scheduled':
        return 'text-sky-600 bg-sky-50 dark:bg-sky-900/20';
      case 'pending':
        return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
      case 'declined':
        return 'text-rose-600 bg-rose-50 dark:bg-rose-900/20';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  return (
    <div className="space-y-3">
      {/* Header with referral number and status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {referral.referral_number}
          </span>
          {referral.is_urgent && (
            <span className="badge-chronicle-rose text-[10px]">URGENT</span>
          )}
        </div>
        <span className={cn(
          "font-mono text-xs px-2 py-0.5 rounded-full",
          getStatusColor(referral.status)
        )}>
          {referral.status_display}
        </span>
      </div>

      {/* Referral flow: from → to */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {referral.referring_department}
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
        <span className="font-medium text-foreground/90">
          {referral.referred_to_specialty || referral.referred_to_department}
        </span>
        {referral.referred_to_provider && (
          <span className="text-muted-foreground">
            ({referral.referred_to_provider})
          </span>
        )}
      </div>

      {/* Reason or specialist notes based on status */}
      {referral.status === 'completed' && referral.specialist_notes ? (
        <div className="p-3 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-lg border border-emerald-200/50 dark:border-emerald-900/30">
          <p className="font-mono text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
            Specialist Notes
          </p>
          <p className="text-sm text-foreground/80 line-clamp-3">
            {referral.specialist_notes}
          </p>
          {referral.recommendations && (
            <>
              <p className="font-mono text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mt-2 mb-1">
                Recommendations
              </p>
              <p className="text-sm text-foreground/80 line-clamp-2">
                {referral.recommendations}
              </p>
            </>
          )}
        </div>
      ) : referral.reason && (
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70 mb-1">
            Reason for Referral
          </p>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {referral.reason}
          </p>
        </div>
      )}

      {/* Questions for specialist (if any and not completed) */}
      {referral.status !== 'completed' && referral.questions_for_specialist && (
        <div className="p-2 bg-amber-50/50 dark:bg-amber-900/10 rounded-lg border border-amber-200/50 dark:border-amber-900/30">
          <p className="font-mono text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Questions for Specialist
          </p>
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {referral.questions_for_specialist}
          </p>
        </div>
      )}
    </div>
  );
};

const ChartSummaryContent = ({ entry }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <p className="font-medium text-foreground">
        {entry.data?.template_name || entry.title || 'Clinical Chart'}
      </p>
      {entry.data?.scope_type && (
        <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
          {entry.data.scope_type}
        </span>
      )}
    </div>
    {entry.content && (
      <p className="text-sm text-muted-foreground">{entry.content}</p>
    )}
    {entry.data?.notes && (
      <p className="text-xs text-muted-foreground">{entry.data.notes}</p>
    )}
  </div>
);

/**
 * Preferred ordering for clinical note sections (for preview extraction)
 */
const PREVIEW_SECTION_ORDER = [
  'subjective', 'objective', 'assessment', 'plan',
  'chief_complaint', 'chiefComplaint', 'history', 'examination',
  'diagnosis', 'treatment', 'findings', 'recommendations'
];

const NoteBodyFallback = () => (
  <div className="space-y-3">
    <div className="h-4 w-24 rounded bg-muted/80" />
    <div className="h-4 w-full rounded bg-muted/70" />
    <div className="h-4 w-5/6 rounded bg-muted/60" />
    <div className="h-4 w-2/3 rounded bg-muted/50" />
  </div>
);

const ExpandedNoteContent = ({ entry, noteBodyId }) => (
  <div className="space-y-4">
    {entry.title && (
      <h4 className="font-medium text-foreground">{entry.title}</h4>
    )}
    <div
      id={noteBodyId}
      className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '320px',
      }}
    >
      <Suspense fallback={<NoteBodyFallback />}>
        <ChronicleNoteBody
          content={entry.content}
          data={entry.data}
        />
      </Suspense>
    </div>
  </div>
);

/**
 * NotePreview - Generic preview for any note type
 *
 * Shows title and a brief summary extracted from entry data or content.
 * Works with any note structure - not hardcoded to SOAP format.
 * Extracts preview items in clinical order (e.g., SOAP order).
 */
const NotePreview = ({ entry }) => {
  const { title, content, data } = entry;

  // Extract a meaningful preview from the data
  const getPreviewItems = () => {
    if (!data || typeof data !== 'object') return [];

    const items = [];

    // Sort keys according to clinical section ordering
    const keys = Object.keys(data).sort((a, b) => {
      const indexA = PREVIEW_SECTION_ORDER.indexOf(a.toLowerCase());
      const indexB = PREVIEW_SECTION_ORDER.indexOf(b.toLowerCase());
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return 0;
    });

    // Try to extract meaningful preview items (limit to 2)
    for (const key of keys) {
      if (items.length >= 2) break;

      const value = data[key];
      if (!value) continue;

      // Get a string preview from the value
      let preview = null;
      if (typeof value === 'string') {
        preview = value.slice(0, 120);
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        // Try common field names for preview
        const previewFields = ['chief_complaint', 'chiefComplaint', 'primary_diagnosis',
          'primaryDiagnosis', 'summary', 'description', 'reason', 'findings'];
        for (const field of previewFields) {
          if (value[field] && typeof value[field] === 'string') {
            preview = value[field].slice(0, 120);
            break;
          }
        }
        // If no preview field found, get first string value
        if (!preview) {
          const firstStringVal = Object.values(value).find(v => typeof v === 'string');
          if (firstStringVal) preview = firstStringVal.slice(0, 120);
        }
      }

      if (preview) {
        // Format key to readable label
        const label = key
          .replace(/_/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/\b\w/g, c => c.toUpperCase());
        items.push({ label, preview });
      }
    }

    return items;
  };

  const previewItems = getPreviewItems();

  return (
    <div className="space-y-2">
      {title && (
        <h4 className="font-medium text-foreground/90">{title}</h4>
      )}

      {/* Show extracted preview items */}
      {previewItems.map((item, i) => (
        <div key={i}>
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70">
            {item.label}:{' '}
          </span>
          <span className="text-sm text-muted-foreground">
            {item.preview}{item.preview.length >= 120 ? '...' : ''}
          </span>
        </div>
      ))}

      {/* Fallback to content if no preview items */}
      {previewItems.length === 0 && content && (
        <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
          {content}
        </p>
      )}

      {/* Empty state */}
      {previewItems.length === 0 && !content && (
        <p className="text-sm text-muted-foreground/60 italic">
          Open details to review this entry.
        </p>
      )}
    </div>
  );
};

/**
 * TimelineGroup - Groups timeline entries by date
 */
const TimelineGroup = ({ date, entries, startIndex = 0 }) => {
  return (
    <div className="mb-8 last:mb-0">
      {/* Date header */}
      <div className="flex items-center gap-4 mb-4 ml-8">
        <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {date}
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
      </div>

      {/* Entries */}
      <div>
        {entries.map((entry, i) => (
          <TimelineEntry
            key={entry.id || `entry-${startIndex + i}`}
            entry={entry}
            index={startIndex + i}
            isRecent={i === 0 && date === 'Today'}
          />
        ))}
      </div>
    </div>
  );
};

export default TimelineEntry;
export { TimelineEntry, TimelineGroup, VitalsContent, LabResultContent, MedicationContent, ReferralContent, NotePreview };
