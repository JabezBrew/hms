import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'

const LabCatalogPage = lazy(() => import('./pages/LabCatalogPage'))
const LabDashboardPage = lazy(() => import('./pages/LabDashboardPage'))
const LabOrdersPage = lazy(() => import('./pages/LabOrdersPage'))
const LabResultsPage = lazy(() => import('./pages/LabResultsPage'))
const LabCollectionWorklistPage = lazy(() => import('./pages/LabCollectionWorklistPage'))

const LAB_BREADCRUMB = { label: 'Laboratory', path: '/laboratory/dashboard' }

export const laboratoryRoutes = [
  {
    path: '/laboratory/catalog',
    component: LabCatalogPage,
    roles: [ROLES.ADMIN, ROLES.LAB_TECHNICIAN, ROLES.DOCTOR],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Lab Catalog | Hospital Management System',
    breadcrumbs: [LAB_BREADCRUMB, { label: 'Catalog', path: '/laboratory/catalog' }],
  },
  {
    path: '/laboratory/dashboard',
    component: LabDashboardPage,
    roles: [ROLES.ADMIN, ROLES.LAB_TECHNICIAN],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Lab Dashboard | Hospital Management System',
    breadcrumbs: [LAB_BREADCRUMB],
  },
  {
    path: '/laboratory/orders',
    component: LabOrdersPage,
    roles: [ROLES.ADMIN, ROLES.LAB_TECHNICIAN, ROLES.DOCTOR, ROLES.NURSE, ROLES.PHYSICIAN, ROLES.PRACTITIONER],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Lab Orders | Hospital Management System',
    breadcrumbs: [LAB_BREADCRUMB, { label: 'Orders', path: '/laboratory/orders' }],
  },
  {
    path: '/laboratory/results',
    component: LabResultsPage,
    roles: [ROLES.ADMIN, ROLES.LAB_TECHNICIAN, ROLES.DOCTOR, ROLES.PHYSICIAN, ROLES.PRACTITIONER],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Lab Results | Hospital Management System',
    breadcrumbs: [LAB_BREADCRUMB, { label: 'Results', path: '/laboratory/results' }],
  },
  {
    path: '/laboratory/collection',
    component: LabCollectionWorklistPage,
    roles: [ROLES.ADMIN, ROLES.LAB_TECHNICIAN, ROLES.NURSE, ROLES.HEAD_NURSE, ROLES.NURSE_PRACTITIONER],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Lab Collection | Hospital Management System',
    breadcrumbs: [LAB_BREADCRUMB, { label: 'Collection', path: '/laboratory/collection' }],
  },
]
