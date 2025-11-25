import { useState } from "react";
import { cn } from "@/lib/utils";
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
  ChevronDown,
  ChevronRight
} from "lucide-react";

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
 */
const TimelineEntry = ({
  entry,
  index = 0,
  isRecent = false,
  isExpanded: controlledExpanded,
  onToggleExpand,
  className
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);

  // Support both controlled and uncontrolled expansion
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const toggleExpand = onToggleExpand || (() => setInternalExpanded(!internalExpanded));

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
    admission: {
      icon: UserPlus,
      label: 'Admission',
      color: 'emerald',
      nodeClass: 'timeline-node-emerald'
    },
    discharge: {
      icon: LogOut,
      label: 'Discharge',
      color: 'emerald',
      nodeClass: 'timeline-node-emerald'
    },
    procedure: {
      icon: Activity,
      label: 'Procedure',
      color: 'rose',
      nodeClass: 'timeline-node-rose'
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
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
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
  // Render content based on entry type
  // ============================================

  const renderContent = () => {
    switch (entry.type) {
      case 'vitals':
        return <VitalsContent vitals={entry.data} />;
      case 'lab_result':
        return <LabResultContent result={entry.data} />;
      case 'medication':
        return <MedicationContent medication={entry.data} />;
      default:
        return (
          <div>
            {entry.title && (
              <h4 className="font-medium text-foreground/90 mb-2">
                {entry.title}
              </h4>
            )}
            {entry.content && (
              <p className={cn(
                "text-muted-foreground text-sm leading-relaxed",
                !isExpanded && "line-clamp-3"
              )}>
                {entry.content}
              </p>
            )}
          </div>
        );
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

        {/* Expand button for long content */}
        {entry.content && entry.content.length > 200 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 font-mono text-xs text-primary p-0 h-auto opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={toggleExpand}
          >
            {isExpanded ? (
              <>
                <ChevronDown className="h-3 w-3 mr-1" />
                Show less
              </>
            ) : (
              <>
                <ChevronRight className="h-3 w-3 mr-1" />
                Read full note
              </>
            )}
          </Button>
        )}
      </div>
    </article>
  );
};

/**
 * VitalsContent - Renders vital signs data in a grid
 */
const VitalsContent = ({ vitals }) => {
  if (!vitals) return null;

  const vitalItems = [
    { label: 'Temp', value: vitals.temperature, unit: '°F' },
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
 * MedicationContent - Renders medication administration data
 */
const MedicationContent = ({ medication }) => {
  if (!medication) return null;

  return (
    <div className="space-y-1">
      <h4 className="font-medium text-foreground/90">
        {medication.name}
      </h4>
      <p className="font-mono text-sm text-muted-foreground">
        {medication.dose} {medication.route}
        {medication.frequency && ` · ${medication.frequency}`}
      </p>
      {medication.notes && (
        <p className="text-sm text-muted-foreground mt-2">
          {medication.notes}
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
export { TimelineEntry, TimelineGroup, VitalsContent, LabResultContent, MedicationContent };
