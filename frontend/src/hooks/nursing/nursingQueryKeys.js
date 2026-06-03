import { keyWith } from '@/shared/lib/queryKeys';

export const nursingKeys = {
  patientMonitoring: (wardId, page, pageSize, monitoringFilter = 'all') => (
    keyWith('patient-monitoring', wardId, page, pageSize, monitoringFilter)
  ),
  patientMonitoringAll: () => keyWith('patient-monitoring'),
  patientDetail: (patientId) => keyWith('patient-detail', patientId),
  vitalSigns: (patient, admission, encounter, date, startDate, endDate) =>
    keyWith('vital-signs', patient, admission, encounter, date, startDate, endDate),
  vitalSignsWindow: (patientId, window) => keyWith('vital-signs', patientId, window),
  vitalSignsAll: () => keyWith('vital-signs'),
  vitalSignsTrends: (patientId, days, encounterId, admissionId, startDate, endDate) =>
    keyWith('vital-signs-trends', patientId, days, encounterId, admissionId, startDate, endDate),
  vitalSignsTrendsByPatient: (patientId) => keyWith('vital-signs-trends', patientId),
  nursingTasks: (patient, status, ward, date, taskType, priority) =>
    keyWith('nursing-tasks', patient, status, ward, date, taskType, priority),
  nursingTasksAll: () => keyWith('nursing-tasks'),
  nursingTasksToday: () => keyWith('nursing-tasks-today'),
  nursingAlerts: (patient, ward, severity, status) => keyWith('nursing-alerts', patient, ward, severity, status),
  nursingAlertsAll: () => keyWith('nursing-alerts'),
  nursingAlertsActive: () => keyWith('nursing-alerts-active'),
  medicationAdministrations: (patient, admission, date, status) =>
    keyWith('medication-administrations', patient, admission, date, status),
  medicationAdministrationsAll: () => keyWith('medication-administrations'),
  medicationsDueNow: () => keyWith('medications-due-now'),
  medicationsOverdue: () => keyWith('medications-overdue'),
  medicationAdministrationHistory: (patient, status, startDate, endDate, ordering, page, pageSize) =>
    keyWith('medication-administration-history', patient, status, startDate, endDate, ordering, page, pageSize),
  patientMar: (patientId, date) => keyWith('patient-mar', patientId, date),
  patientMarAll: () => keyWith('patient-mar'),
  marGrid: (admissionId, startDate, days) => keyWith('mar-grid', admissionId, startDate, days),
  marGridAll: () => keyWith('mar-grid'),
  pendingDispensing: (patientId) => keyWith('pending-dispensing', patientId),
  pendingDispensingAll: () => keyWith('pending-dispensing'),
  pendingDispensingGrouped: (patientId) => keyWith('pending-dispensing', 'grouped', patientId),
  readyForAdmin: (patientId) => keyWith('ready-for-admin', patientId),
  readyForAdminAll: () => keyWith('ready-for-admin'),
  shiftHandoffs: (ward, date, shift) => keyWith('shift-handoffs', ward, date, shift),
  shiftHandoffsAll: () => keyWith('shift-handoffs'),
  shiftHandoffsToday: () => keyWith('shift-handoffs-today'),
  treatmentSheet: (admissionId) => keyWith('treatment-sheet', admissionId),
  treatmentSheetAll: () => keyWith('treatment-sheet'),
  treatmentSheetEntry: (entryId) => keyWith('treatment-sheet-entry', entryId),
  treatmentSheetLowSupply: () => keyWith('treatment-sheet-low-supply'),
  supplyStatus: (entryId) => keyWith('supply-status', entryId),
  supplyRequests: (status) => keyWith('supply-requests', status),
  supplyRequestsAll: () => keyWith('supply-requests'),
  supplyRequest: (requestId) => keyWith('supply-request', requestId),
  fluidBalance: (patientId, admissionId, entryType, date, startDate, endDate) =>
    keyWith('fluid-balance', patientId, admissionId, entryType, date, startDate, endDate),
  fluidBalanceAll: () => keyWith('fluid-balance'),
  fluidBalanceTrends: (patientId, admissionId, startDate, endDate) =>
    keyWith('fluid-balance-trends', patientId, admissionId, startDate, endDate),
  fluidBalanceSummary: (patientId, date) => keyWith('fluid-balance-summary', patientId, date),
  fluidBalanceSummaryAll: () => keyWith('fluid-balance-summary'),
  fluidBalanceToday: (patientId) => keyWith('fluid-balance-today', patientId),
  fluidBalanceTodayAll: () => keyWith('fluid-balance-today'),
  fluidBalanceSettings: () => keyWith('fluid-balance-settings'),
  fluidBalanceAlerts: (patientId, date) => keyWith('fluid-balance-alerts', patientId, date),
};
