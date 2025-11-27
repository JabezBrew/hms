import { useState } from "react";
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
  FileText,
  Pill,
  TestTube,
  Activity,
  Stethoscope,
  ClipboardList,
  UserPlus,
  LogOut,
  Expand,
  Send,
  ArrowRight,
  MoreHorizontal,
  Edit,
  XCircle,
  PauseCircle,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import NoteDetailModal from "./NoteDetailModal";
import PrescriptionActionsDialog from "./PrescriptionActionsDialog";

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
  className
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

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
      color: 'amber',
      nodeClass: 'timeline-node-amber'
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

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (date.toDateString() === today.toDateString()) {
        return 'Today';
      }
      if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
      }
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
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

  const hasDetailContent = () => {
    // Notes with structured data
    if (entry.data && typeof entry.data === 'object' && Object.keys(entry.data).length > 0) {
      return true;
    }
    // Notes with content longer than preview
    if (entry.content && entry.content.length > 150) return true;
    return false;
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
      default:
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
          </div>
          {entry.author && (
            <span className="font-mono text-xs text-muted-foreground">
              {entry.author}
            </span>
          )}
        </div>

        {/* Content */}
        {renderContent()}

        {/* View detail button */}
        {hasDetailContent() && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 font-mono text-xs text-primary p-0 h-auto hover:bg-transparent"
            onClick={() => setIsModalOpen(true)}
          >
            <Expand className="h-3 w-3 mr-1" />
            View full note
          </Button>
        )}
      </div>

      {/* Note detail modal */}
      <NoteDetailModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        entry={entry}
      />
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
 * LabResultContent - Renders lab result data
 */
const LabResultContent = ({ result }) => {
  if (!result) return null;

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
      <PrescriptionActionsDialog
        open={actionDialogOpen}
        onOpenChange={setActionDialogOpen}
        prescription={{ ...medication, id: prescriptionId }}
        action={selectedAction}
        onSuccess={() => {
          // Dialog handles toast, just close
        }}
      />
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

/**
 * Preferred ordering for clinical note sections (for preview extraction)
 */
const PREVIEW_SECTION_ORDER = [
  'subjective', 'objective', 'assessment', 'plan',
  'chief_complaint', 'chiefComplaint', 'history', 'examination',
  'diagnosis', 'treatment', 'findings', 'recommendations'
];

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
          Click to view details...
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
