import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import Send from 'lucide-react/dist/esm/icons/send.js';

/**
 * Entry type configuration for Chronicle timeline entries.
 * Maps entry types to their icon, label, color, and timeline node CSS class.
 */
export const entryConfig = {
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

export const defaultEntryConfig = entryConfig.progress_note;

/**
 * Get config for an entry type, falling back to progress_note defaults.
 */
export function getEntryConfig(type) {
  return entryConfig[type] || defaultEntryConfig;
}

/**
 * Color class mapping for timeline dots used in compact index entries.
 */
const dotColorClasses = {
  amber: 'bg-[oklch(0.75_0.18_55)]',
  emerald: 'bg-[oklch(0.70_0.17_155)]',
  rose: 'bg-[oklch(0.65_0.22_15)]',
  sky: 'bg-[oklch(0.70_0.15_230)]',
};

export function getDotColorClass(color) {
  return dotColorClasses[color] || dotColorClasses.amber;
}

/**
 * Badge color class mapping.
 */
const badgeClasses = {
  amber: 'badge-chronicle-amber',
  emerald: 'badge-chronicle-emerald',
  rose: 'badge-chronicle-rose',
  sky: 'badge-chronicle-sky',
};

export function getBadgeClass(color) {
  return badgeClasses[color] || badgeClasses.amber;
}

/**
 * Generate a compact one-line summary for a timeline entry.
 * Used in the timeline index for the master-detail view.
 */
export function getEntryIndexSummary(entry) {
  if (!entry) return '';

  switch (entry.type) {
    case 'vitals': {
      const d = entry.data || {};
      const parts = [];
      if (d.temperature) parts.push(`${d.temperature}°C`);
      if (d.blood_pressure) parts.push(`BP ${d.blood_pressure}`);
      if (d.heart_rate) parts.push(`HR ${d.heart_rate}`);
      if (d.spo2) parts.push(`SpO2 ${d.spo2}%`);
      if (d.respiratory_rate) parts.push(`RR ${d.respiratory_rate}`);
      return parts.join(' · ') || 'Vitals recorded';
    }

    case 'medication':
    case 'prescription': {
      const med = entry.data || {};
      const name = med.name || med.medication_name || 'Medication';
      const dose = med.dose || med.dosage || '';
      const freq = med.frequency_display || med.frequency || '';
      return [name, dose, freq].filter(Boolean).join(' ');
    }

    case 'lab_result': {
      const d = entry.data || {};
      const summary = d.results_summary;
      const parts = [];
      if (summary?.critical > 0) parts.push(`${summary.critical} critical`);
      if (summary?.abnormal > 0) parts.push(`${summary.abnormal} abnormal`);
      if (summary?.normal > 0) parts.push(`${summary.normal} normal`);
      const label = d.order_number ? `${d.order_number}` : '';
      const counts = parts.join(', ');
      return [label, counts].filter(Boolean).join(' · ') || 'Lab results';
    }

    case 'referral': {
      const r = entry.data || {};
      const specialty = r.referred_to_specialty || r.referred_to_department || 'Referral';
      const status = r.status_display || r.status || '';
      return [specialty, status].filter(Boolean).join(' · ');
    }

    case 'chart': {
      return entry.data?.template_name || entry.title || 'Clinical chart';
    }

    case 'admission': {
      const d = entry.data || {};
      return d.ward_name
        ? `Admitted to ${d.ward_name}`
        : entry.content || 'Patient admitted';
    }

    case 'discharge': {
      return entry.content || 'Patient discharged';
    }

    default: {
      // Notes: use title, or extract first meaningful line from content/data
      if (entry.title) return entry.title;
      if (entry.content) return entry.content.slice(0, 80);
      // Try to extract from data
      if (entry.data && typeof entry.data === 'object') {
        const firstVal = Object.values(entry.data).find(
          (v) => typeof v === 'string' && v.length > 0
        );
        if (firstVal) return firstVal.slice(0, 80);
      }
      return getEntryConfig(entry.type).label;
    }
  }
}
