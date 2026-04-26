import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS, ROLES } from '@/shared/constants/roles'

const PatientChronicleListPage = lazy(() => import('./pages/PatientChronicleListPage'))
const PatientCreatePage = lazy(() => import('./pages/PatientCreatePage'))
const MyPatientsPage = lazy(() => import('./pages/MyPatientsPage'))
const PatientPage = lazy(() => import('./pages/PatientPage'))
const PatientEditPage = lazy(() => import('./pages/PatientEditPage'))

export const patientRoutes = [
  {
    path: '/patients',
    component: PatientChronicleListPage,
    roles: ROLE_GROUPS.PATIENT_REGISTRY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Patients | Hospital Management System',
    breadcrumbs: [{ label: 'Patients', path: '/patients' }],
  },
  {
    path: '/patients/create',
    component: PatientCreatePage,
    roles: [ROLES.ADMIN, ROLES.RECEPTIONIST],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Register Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Register', path: '/patients/create' },
    ],
  },
  {
    path: '/patients/my-patients',
    component: MyPatientsPage,
    roles: ROLE_GROUPS.MY_PATIENTS,
    layout: ROUTE_LAYOUTS.APP,
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
    title: 'Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Patient', path: '/patients/:id' },
    ],
  },
  {
    path: '/patients/:id/ward-round',
    component: PatientPage,
    roles: ROLE_GROUPS.CLINICAL,
    features: ['wards'],
    layout: ROUTE_LAYOUTS.APP,
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
    title: 'Edit Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Edit Patient', path: '/patients/:id/edit' },
    ],
  },
]
