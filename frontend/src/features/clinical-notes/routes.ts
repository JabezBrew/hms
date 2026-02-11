import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'

const CreateClinicalNotePage = lazy(() => import('./pages/CreateClinicalNotePage'))
const TemplateListPage = lazy(() => import('./pages/TemplateListPage'))

const CLINICAL_NOTES_BREADCRUMB = { label: 'Clinical Notes', path: '/clinical-notes/templates' }

export const clinicalNotesRoutes = [
  {
    path: '/encounters/:id/clinical-notes',
    component: CreateClinicalNotePage,
    roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Clinical Note | Hospital Management System',
    breadcrumbs: [CLINICAL_NOTES_BREADCRUMB, { label: 'New Note', path: '/encounters/:id/clinical-notes' }],
  },
  {
    path: '/clinical-notes/templates',
    component: TemplateListPage,
    roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Clinical Note Templates | Hospital Management System',
    breadcrumbs: [CLINICAL_NOTES_BREADCRUMB, { label: 'Templates', path: '/clinical-notes/templates' }],
  },
]
