import Activity from 'lucide-react/dist/esm/icons/activity.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import isValid from 'date-fns/isValid';

export const formatEncounterDate = (dateString) => {
  if (!dateString) return null;
  try {
    const date = parseISO(dateString);
    return isValid(date) ? format(date, 'MMM d, yyyy h:mm a') : null;
  } catch {
    return null;
  }
};

export const formatEncounterDateShort = (dateString) => {
  if (!dateString) return null;
  try {
    const date = parseISO(dateString);
    return isValid(date) ? format(date, 'MMM d, yyyy') : null;
  } catch {
    return null;
  }
};

export const getEncounterStatusConfig = (status) => {
  const configs = {
    planned: {
      label: 'Planned',
      badgeClass: 'bg-muted text-muted-foreground border-border',
      icon: Clock,
    },
    'in-progress': {
      label: 'In Progress',
      badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
      icon: Activity,
    },
    finished: {
      label: 'Completed',
      badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
      icon: CheckCircle,
    },
    cancelled: {
      label: 'Cancelled',
      badgeClass: 'bg-destructive/10 text-destructive border-destructive/30',
      icon: XCircle,
    },
  };

  return configs[status] || configs.planned;
};

export const getEncounterTypeConfig = (type) => {
  const configs = {
    inpatient: {
      label: 'Inpatient Admission',
      shortLabel: 'Inpatient',
      badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
      icon: Building2,
    },
    outpatient: {
      label: 'Outpatient Visit',
      shortLabel: 'Outpatient',
      badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
      icon: Calendar,
    },
    emergency: {
      label: 'Emergency Visit',
      shortLabel: 'Emergency',
      badgeClass: 'bg-destructive/10 text-destructive border-destructive/30',
      icon: AlertTriangle,
    },
  };

  return configs[type] || configs.outpatient;
};

export const buildEncounterTimelineEntries = (clinicalNotes) => {
  if (!clinicalNotes || clinicalNotes.length === 0) return [];

  return clinicalNotes.map((note) => ({
    id: note.id,
    type: note.note_type || 'doctor_note',
    title: note.title,
    content: note.content,
    timestamp: note.created_at,
    author: note.author_name,
    data: note,
  }));
};

export const getEncounterActionState = (encounter, rustV2Mode) => {
  const canEdit = encounter.status === 'planned' || encounter.status === 'in-progress';
  const isActiveInpatient = encounter.encounter_type === 'inpatient'
    && encounter.status === 'in-progress'
    && !encounter.end_time;

  return {
    canEdit,
    canCancel: canEdit,
    canDischarge: !rustV2Mode && isActiveInpatient,
    dischargeHandledByAdmissionWorkflow: rustV2Mode && isActiveInpatient,
  };
};
