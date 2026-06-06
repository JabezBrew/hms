import { lazy } from 'react'
import { ROUTE_LAYOUTS, SIDEBARS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS, ROLES } from '@/shared/constants/roles'

const PatientChronicleListPage = lazy(() => import('./pages/PatientChronicleListPage'))
const FindOrRegisterPatientPage = lazy(() => import('./pages/FindOrRegisterPatientPage'))
const MyPatientsPage = lazy(() => import('./pages/MyPatientsPage'))
const PatientPage = lazy(() => import('./pages/PatientPage'))
const PatientEditPage = lazy(() => import('./pages/PatientEditPage'))
const PatientChroniclePrintPage = lazy(() => import('./pages/PatientChroniclePrintPage'))

const PATIENT_CHRONICLE_PRINT_ROLES = [ROLES.ADMIN, ...ROLE_GROUPS.CLINICAL]

export const patientRoutes = [
  {
    path: '/patients',
    component: PatientChronicleListPage,
    roles: ROLE_GROUPS.PATIENT_REGISTRY,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.PATIENTS,
    title: 'Patients | Hospital Management System',
    breadcrumbs: [{ label: 'Patients', path: '/patients' }],
  },
  {
    path: '/patients/create',
    component: FindOrRegisterPatientPage,
    roles: [ROLES.ADMIN, ROLES.RECEPTIONIST],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.PATIENTS,
    title: 'Register Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Register', path: '/patients/create' },
    ],
  },
  {
    path: '/patients/find-or-register',
    component: FindOrRegisterPatientPage,
    roles: [ROLES.ADMIN, ROLES.RECEPTIONIST, ...ROLE_GROUPS.CLINICAL],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.PATIENTS,
    title: 'Find or Register Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Find or Register', path: '/patients/find-or-register' },
    ],
  },
  {
    path: '/patients/my-patients',
    component: MyPatientsPage,
    roles: [ROLES.ADMIN, ...ROLE_GROUPS.MY_PATIENTS],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.PATIENTS,
    title: 'My Patients | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'My Patients', path: '/patients/my-patients' },
    ],
  },
  {
    path: '/patients/:id',
    component: PatientPage,
    roles: ROLE_GROUPS.PATIENT_DETAIL,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.PATIENT_WORKSPACE,
    title: 'Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Patient', path: '/patients/:id' },
    ],
  },
  {
    path: '/patients/:id/chronicle/print',
    component: PatientChroniclePrintPage,
    roles: PATIENT_CHRONICLE_PRINT_ROLES,
    features: ['patient_chronicle'],
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Patient Chronicle Print | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Print Chronicle', path: '/patients/:id/chronicle/print' },
    ],
  },
  {
    path: '/patients/:id/ward-round',
    component: PatientPage,
    roles: ROLE_GROUPS.CLINICAL,
    features: ['wards'],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.PATIENT_WORKSPACE,
    title: 'Ward Round | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Ward Round', path: '/patients/:id/ward-round' },
    ],
    props: { defaultAction: 'ward_round' },
  },
  {
    path: '/patients/:id/edit',
    component: PatientEditPage,
    roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.PATIENT_WORKSPACE,
    title: 'Edit Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Edit Patient', path: '/patients/:id/edit' },
    ],
  },
]
