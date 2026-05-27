import format from 'date-fns/format';

/**
 * Generate prepopulated patient condition summary
 * @param {Object} patient - Patient data from monitoring
 * @param {Object} vitals - Latest vital signs
 * @param {number} alertsCount - Number of active alerts
 * @returns {string} - Formatted patient condition text
 */
function generatePatientCondition(patient, vitals, alertsCount = 0) {
  const lines = [];
  const timestamp = format(new Date(), 'h:mm a');

  // Vitals line
  if (vitals) {
    const vitalParts = [];
    if (vitals.heart_rate) vitalParts.push(`HR ${vitals.heart_rate}`);
    if (vitals.blood_pressure_systolic && vitals.blood_pressure_diastolic) {
      vitalParts.push(`BP ${vitals.blood_pressure_systolic}/${vitals.blood_pressure_diastolic}`);
    }
    if (vitals.respiratory_rate) vitalParts.push(`RR ${vitals.respiratory_rate}`);
    if (vitals.temperature) vitalParts.push(`Temp ${vitals.temperature}°C`);
    if (vitals.oxygen_saturation) vitalParts.push(`SpO2 ${vitals.oxygen_saturation}%`);
    if (vitals.pain_level !== undefined && vitals.pain_level !== null) {
      vitalParts.push(`Pain ${vitals.pain_level}/10`);
    }

    if (vitalParts.length > 0) {
      lines.push(`Vitals (${timestamp}): ${vitalParts.join(' | ')}`);
    }
  }

  // Status line
  const isCritical = patient?.is_critical;
  if (isCritical) {
    lines.push('Status: CRITICAL - requires close monitoring');
  } else if (alertsCount > 0) {
    lines.push(`Status: ${alertsCount} active alert${alertsCount > 1 ? 's' : ''} - see ongoing issues`);
  } else {
    lines.push('Status: Stable, no critical alerts');
  }

  // Location info
  if (patient?.ward_name && patient?.bed_number) {
    const admissionDays = patient?.admission_date
      ? Math.ceil((Date.now() - new Date(patient.admission_date)) / (1000 * 60 * 60 * 24))
      : null;
    const dayInfo = admissionDays ? ` (Day ${admissionDays})` : '';
    lines.push(`Location: ${patient.ward_name}, Bed ${patient.bed_number}${dayInfo}`);
  }

  return lines.join('\n');
}

/**
 * Generate prepopulated pending tasks summary
 * @param {Array} tasks - Pending nursing tasks
 * @param {Array} medicationsDue - Medications due soon
 * @returns {string} - Formatted pending tasks text
 */
function generatePendingTasks(tasks = [], medicationsDue = []) {
  const lines = [];
  const timestamp = format(new Date(), 'h:mm a');

  // Filter to pending/overdue tasks only
  const pendingTasks = tasks.filter(t =>
    t.status === 'pending' || t.status === 'overdue' || t.status === 'in_progress'
  );

  // Pending tasks section
  if (pendingTasks.length > 0) {
    lines.push(`Pending Tasks (${timestamp}):`);
    pendingTasks.forEach(task => {
      const priority = task.priority?.toUpperCase() || 'MED';
      const priorityTag = `[${priority.substring(0, 4)}]`;
      const dueTime = task.scheduled_time
        ? format(new Date(task.scheduled_time), 'h:mm a')
        : '';
      const dueText = dueTime ? ` - due ${dueTime}` : '';
      const overdueTag = task.status === 'overdue' ? ' (OVERDUE)' : '';
      lines.push(`• ${priorityTag} ${task.description || task.task_type}${dueText}${overdueTag}`);
    });
  }

  // Medications due section
  if (medicationsDue.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Medications Due:');
    medicationsDue.forEach(med => {
      const medName = med.medication_name || med.prescription_name || 'Medication';
      const dose = med.dose || med.dosage || '';
      const route = med.route || '';
      const time = med.scheduled_time
        ? format(new Date(med.scheduled_time), 'h:mm a')
        : '';
      const timeText = time ? ` @ ${time}` : '';
      lines.push(`• ${medName} ${dose} ${route}${timeText}`.trim());
    });
  }

  // Empty state
  if (lines.length === 0) {
    lines.push('No pending tasks or medications due.');
  }

  return lines.join('\n');
}

/**
 * Generate prepopulated ongoing issues from alerts
 * @param {Array} alerts - Active nursing alerts
 * @returns {string} - Formatted ongoing issues text
 */
function generateOngoingIssues(alerts = []) {
  // Filter to unacknowledged alerts only
  const activeAlerts = alerts.filter(a => !a.acknowledged && !a.resolved);

  if (activeAlerts.length === 0) {
    return '';
  }

  const lines = ['Active Alerts:'];

  // Sort by severity (critical first)
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = activeAlerts.toSorted((a, b) =>
    (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3)
  );

  sorted.forEach(alert => {
    const severity = alert.severity?.toUpperCase() || 'INFO';
    const severityTag = `[${severity.substring(0, 4)}]`;
    const message = alert.message || alert.alert_type || 'Alert';
    const time = alert.created_at
      ? format(new Date(alert.created_at), 'h:mm a')
      : '';
    const timeText = time ? ` - ${time}` : '';
    lines.push(`• ${severityTag} ${message}${timeText}`);
  });

  return lines.join('\n');
}

/**
 * Generate prepopulated medication changes summary
 * @param {Array} medEvents - Recent medication events (administered, held, refused, etc.)
 * @returns {string} - Formatted medication changes text
 */
function generateMedicationChanges(medEvents = []) {
  // Filter to notable events (held, refused, missed, PRN given)
  const notableEvents = medEvents.filter(event =>
    event.status === 'held' ||
    event.status === 'refused' ||
    event.status === 'missed' ||
    event.is_prn
  );

  if (notableEvents.length === 0) {
    return '';
  }

  const lines = ["Today's Medication Events:"];

  notableEvents.forEach(event => {
    const medName = event.medication_name || event.prescription_name || 'Medication';
    const dose = event.dose || event.dosage || '';
    const status = event.status?.toUpperCase() || '';
    const time = event.administered_at || event.scheduled_time
      ? format(new Date(event.administered_at || event.scheduled_time), 'h:mm a')
      : '';
    const reason = event.notes || event.reason || '';
    const reasonText = reason ? ` (${reason})` : '';

    if (event.is_prn && event.status === 'administered') {
      lines.push(`• PRN ${medName} ${dose} - Given at ${time}${reasonText}`);
    } else {
      lines.push(`• ${medName} ${dose} - ${status} at ${time}${reasonText}`);
    }
  });

  return lines.join('\n');
}

/**
 * Generate all handoff summaries at once
 * @param {Object} data - Object containing patient, vitals, tasks, alerts, medications
 * @returns {Object} - Object with prepopulated field values
 */
export function generateAllHandoffSummaries({
  patient,
  vitals,
  tasks = [],
  alerts = [],
  medicationsDue = [],
  medicationEvents = []
}) {
  const alertsCount = alerts.filter(a => !a.acknowledged && !a.resolved).length;

  return {
    patient_condition: generatePatientCondition(patient, vitals, alertsCount),
    pending_tasks: generatePendingTasks(tasks, medicationsDue),
    ongoing_issues: generateOngoingIssues(alerts),
    medication_changes: generateMedicationChanges(medicationEvents),
  };
}
