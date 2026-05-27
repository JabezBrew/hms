import Activity from 'lucide-react/dist/esm/icons/activity.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';

const ENTRY_CONFIG = {
  progress_note: {
    icon: FileText,
    label: 'Progress Note',
    color: 'amber',
    nodeClass: 'timeline-node-amber',
  },
  soap_note: {
    icon: FileText,
    label: 'SOAP Note',
    color: 'amber',
    nodeClass: 'timeline-node-amber',
  },
  vitals: {
    icon: Activity,
    label: 'Vitals',
    color: 'emerald',
    nodeClass: 'timeline-node-emerald',
  },
  medication: {
    icon: Pill,
    label: 'Medication',
    color: 'sky',
    nodeClass: 'timeline-node-sky',
  },
  prescription: {
    icon: Pill,
    label: 'Prescription',
    color: 'sky',
    nodeClass: 'timeline-node-sky',
  },
  lab_result: {
    icon: TestTube,
    label: 'Lab Result',
    color: 'sky',
    nodeClass: 'timeline-node-sky',
  },
  order: {
    icon: ClipboardList,
    label: 'Order',
    color: 'sky',
    nodeClass: 'timeline-node-sky',
  },
  consult: {
    icon: Stethoscope,
    label: 'Consultation',
    color: 'amber',
    nodeClass: 'timeline-node-amber',
  },
  consult_note: {
    icon: Stethoscope,
    label: 'Consult Note',
    color: 'amber',
    nodeClass: 'timeline-node-amber',
  },
  admission: {
    icon: UserPlus,
    label: 'Admission',
    color: 'emerald',
    nodeClass: 'timeline-node-emerald',
  },
  admission_note: {
    icon: UserPlus,
    label: 'Admission Note',
    color: 'emerald',
    nodeClass: 'timeline-node-emerald',
  },
  discharge: {
    icon: LogOut,
    label: 'Discharge',
    color: 'emerald',
    nodeClass: 'timeline-node-emerald',
  },
  discharge_note: {
    icon: LogOut,
    label: 'Discharge Note',
    color: 'emerald',
    nodeClass: 'timeline-node-emerald',
  },
  nursing_note: {
    icon: FileText,
    label: 'Nursing Note',
    color: 'sky',
    nodeClass: 'timeline-node-sky',
  },
  procedure: {
    icon: Activity,
    label: 'Procedure',
    color: 'rose',
    nodeClass: 'timeline-node-rose',
  },
  referral: {
    icon: Send,
    label: 'Referral',
    color: 'sky',
    nodeClass: 'timeline-node-sky',
  },
  chart: {
    icon: ClipboardList,
    label: 'Chart',
    color: 'amber',
    nodeClass: 'timeline-node-amber',
  },
};

const COPYABLE_NOTE_TYPES = new Set([
  'progress_note',
  'soap_note',
  'nursing_note',
  'admission_note',
  'discharge_note',
  'consult_note',
  'procedure',
]);

const BADGE_CLASSES = {
  amber: 'badge-chronicle-amber',
  emerald: 'badge-chronicle-emerald',
  rose: 'badge-chronicle-rose',
  sky: 'badge-chronicle-sky',
};

export const getTimelineEntryConfig = (type) => ENTRY_CONFIG[type] || ENTRY_CONFIG.progress_note;

export const getTimelineEntryTimestamp = (entry) => entry.timestamp
  || entry.occurred_at
  || entry.recorded_at
  || entry.measured_at
  || entry.created_at
  || entry.updated_at
  || entry.data?.timestamp
  || entry.data?.recorded_at
  || entry.data?.measured_at
  || entry.data?.created_at
  || entry.data?.updated_at
  || null;

export const buildCopyNoteEntry = (entry, fallbackTitle) => ({
  id: entry.id,
  template: entry.template,
  template_id: entry.template_id,
  template_title: entry.template_title || entry.title || fallbackTitle,
  data: entry.data,
});

export const buildEditNotePayload = (entry) => ({
  noteId: entry.id,
  template: entry.template,
  templateId: entry.template?.id || entry.template_id,
  templateTitle: entry.template?.title || entry.template_title || entry.title,
  data: entry.data,
  title: entry.title,
});

export const isCopyableTimelineNote = (entry) => (
  Boolean(COPYABLE_NOTE_TYPES.has(entry.type)
  && entry.id
  && entry.data
  && typeof entry.data === 'object')
);

export const isEditableTimelineNote = (entry, currentUserId) => (
  Boolean(isCopyableTimelineNote(entry)
  && entry.template
  && currentUserId
  && entry.author_id
  && String(currentUserId) === String(entry.author_id))
);

export const formatTimelineTime = (timestamp) => {
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
      hour12: true,
    });
  } catch {
    return '';
  }
};

export const formatRelativeTimelineTime = (timestamp) => {
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

export const getTimelineBadgeClass = (color) => BADGE_CLASSES[color] || BADGE_CLASSES.amber;
