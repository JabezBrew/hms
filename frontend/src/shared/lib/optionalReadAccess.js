// Optional previews use current authorization facts; a compatibility role is
// navigation metadata and cannot grant a protected Rust read.
export function optionalReadAccess(user) {
  const capabilities = Array.isArray(user?.adminAccess?.capabilities) ? user.adminAccess.capabilities : [];
  const features = Array.isArray(user?.accessContext?.features) ? user.accessContext.features : [];
  const visibility = Array.isArray(user?.accessContext?.patient_visibility) ? user.accessContext.patient_visibility : [];
  const allows = (permissions, requiredFeatures, demographics = false) => Boolean(user)
    && permissions.every((permission) => capabilities.includes(permission))
    && requiredFeatures.every((feature) => features.includes(feature))
    && (!demographics || (capabilities.includes('patient.demographics.view') && visibility.includes('demographics')));

  return {
    notifications: allows(['notification.view'], ['dashboards']),
    dashboardSnapshot: allows(['dashboard.view'], ['dashboards']),
    appointmentPreview: allows(['appointment.view'], ['appointments'], true),
    inpatientPreview: allows(['ward.view', 'admission.manage', 'nursing.task.manage'], ['wards', 'admissions', 'nursing'], true),
  };
}
