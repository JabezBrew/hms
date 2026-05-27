import { ROLE_GROUPS, ROLES } from '@/shared/constants/roles'

function roleAllowed(roles, role) {
  if (!roles || roles.length === 0) return true
  return roles.includes(role)
}

export function getOmniActionsForRole(role) {
  const r = role || ''
  return OMNI_ACTIONS.filter((action) => roleAllowed(action.roles, r))
}

const OMNI_ACTIONS = Object.freeze([
  {
    id: 'patients.register',
    label: 'Register patient',
    keywords: ['patients', 'new patient', 'registration', 'create patient'],
    roles: [ROLES.ADMIN, ROLES.RECEPTIONIST],
    run: ({ navigate }) => navigate('/patients/create'),
  },
  {
    id: 'appointments.new',
    label: 'New appointment',
    keywords: ['schedule', 'appointments', 'book', 'create appointment'],
    roles: ROLE_GROUPS.APPOINTMENTS,
    run: ({ navigate }) => navigate('/appointments/create'),
  },
  {
    id: 'encounters.new',
    label: 'New encounter',
    keywords: ['encounters', 'visit', 'create encounter'],
    roles: ROLE_GROUPS.ENCOUNTERS,
    run: ({ navigate }) => navigate('/encounters/new'),
  },
  {
    id: 'admissions.new',
    label: 'New admission',
    keywords: ['admissions', 'admit', 'ward', 'create admission'],
    roles: ROLE_GROUPS.ADMISSIONS,
    run: ({ navigate }) => navigate('/admissions/new'),
  },
  {
    id: 'inbox.open',
    label: 'Inbox',
    keywords: ['inbox', 'tasks', 'notifications'],
    roles: [
      ROLES.ADMIN,
      ROLES.DOCTOR,
      ROLES.NURSE,
      ROLES.INPATIENT_DOCTOR,
      ROLES.PRACTITIONER,
      ROLES.PHYSICIAN,
    ],
    run: ({ navigate }) => navigate('/inbox'),
  },
  {
    id: 'settings.open',
    label: 'Settings',
    keywords: ['settings', 'preferences', 'profile', 'security'],
    roles: null,
    run: ({ navigate }) => navigate('/settings'),
  },
])
