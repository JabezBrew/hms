import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS, ROLES } from '@/shared/constants/roles'

const EncountersPage = lazy(() => import('./pages/EncountersPage'))
const EncounterCreatePage = lazy(() => import('./pages/EncounterCreatePage'))
const EncounterDetailPage = lazy(() => import('./pages/EncounterDetailPage'))
const EncounterEditPage = lazy(() => import('./pages/EncounterEditPage'))
const EncounterWorkspace = lazy(() => import('./pages/EncounterWorkspace'))

export const encounterRoutes = [
  {
    path: '/encounters',
    component: EncountersPage,
    roles: ROLE_GROUPS.ENCOUNTERS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Encounters | Hospital Management System',
    breadcrumbs: [{ label: 'Encounters', path: '/encounters' }],
  },
  {
    path: '/encounters/new',
    component: EncounterCreatePage,
    roles: ROLE_GROUPS.ENCOUNTERS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'New Encounter | Hospital Management System',
    breadcrumbs: [
      { label: 'Encounters', path: '/encounters' },
      { label: 'New Encounter', path: '/encounters/new' },
    ],
  },
  {
    path: '/encounters/:id',
    component: EncounterDetailPage,
    roles: ROLE_GROUPS.ENCOUNTERS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Encounter | Hospital Management System',
    breadcrumbs: [
      { label: 'Encounters', path: '/encounters' },
      { label: 'Encounter', path: '/encounters/:id' },
    ],
  },
  {
    path: '/encounters/:id/edit',
    component: EncounterEditPage,
    roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Edit Encounter | Hospital Management System',
    breadcrumbs: [
      { label: 'Encounters', path: '/encounters' },
      { label: 'Edit Encounter', path: '/encounters/:id/edit' },
    ],
  },
  {
    path: '/encounters/:id/workspace',
    component: EncounterWorkspace,
    roles: ROLE_GROUPS.ENCOUNTER_WORKSPACE,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Encounter Workspace | Hospital Management System',
    breadcrumbs: [
      { label: 'Encounters', path: '/encounters' },
      { label: 'Workspace', path: '/encounters/:id/workspace' },
    ],
  },
]
