import { areFeaturesEnabled, featureList } from '@/shared/lib/features'

export const DASHBOARD_FEATURES = {
  appointments: ['appointments'],
  audit: ['audit'],
  billing: ['billing'],
  clinicalNotes: ['clinical_notes'],
  dischargeWorkflows: ['discharge_workflows'],
  emergencyEncounters: ['emergency_encounters'],
  inpatientAdmissions: ['inpatient_admissions'],
  laboratory: ['laboratory'],
  nursingWorkflows: ['nursing_workflows'],
  outpatientEncounters: ['outpatient_encounters'],
  patientChronicle: ['patient_chronicle'],
  patientRegistration: ['patient_registration'],
  pharmacy: ['pharmacy'],
  referrals: ['referrals'],
  rosters: ['department_rosters'],
  wards: ['wards'],
}

const ROLE_DASHBOARD_FEATURES = {
  admin: [],
  doctor: DASHBOARD_FEATURES.outpatientEncounters,
  physician: DASHBOARD_FEATURES.outpatientEncounters,
  practitioner: DASHBOARD_FEATURES.outpatientEncounters,
  inpatient_doctor: DASHBOARD_FEATURES.inpatientAdmissions,
  nurse: DASHBOARD_FEATURES.nursingWorkflows,
  head_nurse: DASHBOARD_FEATURES.nursingWorkflows,
  nurse_practitioner: DASHBOARD_FEATURES.nursingWorkflows,
  receptionist: [],
  billing: DASHBOARD_FEATURES.billing,
  lab_technician: DASHBOARD_FEATURES.laboratory,
  pharmacist: DASHBOARD_FEATURES.pharmacy,
}

const HREF_FEATURE_RULES = [
  { test: (path) => path === '/patients/create', features: DASHBOARD_FEATURES.patientRegistration },
  { test: (path) => path.startsWith('/appointments'), features: DASHBOARD_FEATURES.appointments },
  { test: (path) => path.startsWith('/referrals'), features: DASHBOARD_FEATURES.referrals },
  { test: (path) => path.startsWith('/triage'), features: DASHBOARD_FEATURES.emergencyEncounters },
  { test: (path) => path.startsWith('/billing'), features: DASHBOARD_FEATURES.billing },
  { test: (path) => path.startsWith('/laboratory'), features: DASHBOARD_FEATURES.laboratory },
  { test: (path) => path.startsWith('/pharmacy'), features: DASHBOARD_FEATURES.pharmacy },
  { test: (path) => path.startsWith('/wards'), features: DASHBOARD_FEATURES.wards },
  { test: (path) => path.startsWith('/admissions'), features: DASHBOARD_FEATURES.inpatientAdmissions },
  { test: (path) => path.startsWith('/workflows/ward-round'), features: DASHBOARD_FEATURES.wards },
  { test: (path) => path.startsWith('/workflows/discharge'), features: DASHBOARD_FEATURES.dischargeWorkflows },
  { test: (path) => path.startsWith('/clinical-notes'), features: DASHBOARD_FEATURES.clinicalNotes },
  { test: (path) => path.startsWith('/charts'), features: DASHBOARD_FEATURES.clinicalNotes },
  { test: (path) => path.startsWith('/patients/'), features: DASHBOARD_FEATURES.patientChronicle },
  { test: (path) => path === '/patients', features: DASHBOARD_FEATURES.patientChronicle },
]

function canUseFeatures(enabledFeatures, requiredFeatures) {
  return areFeaturesEnabled(requiredFeatures, enabledFeatures)
}

export function dashboardFeaturesForRole(role) {
  return featureList(ROLE_DASHBOARD_FEATURES[role])
}

export function getHrefFeatureRequirements(href) {
  if (!href || typeof href !== 'string') {
    return []
  }

  let url
  try {
    url = new URL(href, 'https://hms.local')
  } catch {
    return []
  }

  const required = new Set()
  const { pathname, searchParams } = url
  const patientAction = searchParams.get('action')

  if (patientAction === 'ward_round') {
    DASHBOARD_FEATURES.patientChronicle.forEach((feature) => required.add(feature))
    DASHBOARD_FEATURES.wards.forEach((feature) => required.add(feature))
  }

  if (patientAction === 'discharge') {
    DASHBOARD_FEATURES.patientChronicle.forEach((feature) => required.add(feature))
    DASHBOARD_FEATURES.dischargeWorkflows.forEach((feature) => required.add(feature))
  }

  HREF_FEATURE_RULES.forEach((rule) => {
    if (rule.test(pathname)) {
      rule.features.forEach((feature) => required.add(feature))
    }
  })

  return [...required]
}

function isDashboardHrefEnabled(href, enabledFeatures) {
  return canUseFeatures(enabledFeatures, getHrefFeatureRequirements(href))
}

export function filterDashboardItemsByFeature(items, enabledFeatures, getHref = (item) => item.href) {
  return (items || []).filter((item) => {
    const itemFeaturesEnabled = canUseFeatures(enabledFeatures, item?.features)
    const hrefEnabled = isDashboardHrefEnabled(getHref(item), enabledFeatures)
    return itemFeaturesEnabled && hrefEnabled
  })
}

export function buildDashboardFeatureGates(enabledFeatures = {}) {
  const canUse = (requiredFeatures) => canUseFeatures(enabledFeatures, requiredFeatures)

  return {
    appointmentsEnabled: canUse(DASHBOARD_FEATURES.appointments),
    auditEnabled: canUse(DASHBOARD_FEATURES.audit),
    billingEnabled: canUse(DASHBOARD_FEATURES.billing),
    clinicalNotesEnabled: canUse(DASHBOARD_FEATURES.clinicalNotes),
    dischargeWorkflowsEnabled: canUse(DASHBOARD_FEATURES.dischargeWorkflows),
    emergencyEncountersEnabled: canUse(DASHBOARD_FEATURES.emergencyEncounters),
    inpatientAdmissionsEnabled: canUse(DASHBOARD_FEATURES.inpatientAdmissions),
    laboratoryEnabled: canUse(DASHBOARD_FEATURES.laboratory),
    nursingWorkflowsEnabled: canUse(DASHBOARD_FEATURES.nursingWorkflows),
    outpatientEncountersEnabled: canUse(DASHBOARD_FEATURES.outpatientEncounters),
    patientChronicleEnabled: canUse(DASHBOARD_FEATURES.patientChronicle),
    patientRegistrationEnabled: canUse(DASHBOARD_FEATURES.patientRegistration),
    pharmacyEnabled: canUse(DASHBOARD_FEATURES.pharmacy),
    referralsEnabled: canUse(DASHBOARD_FEATURES.referrals),
    rostersEnabled: canUse(DASHBOARD_FEATURES.rosters),
    wardsEnabled: canUse(DASHBOARD_FEATURES.wards),
    canUse,
  }
}
