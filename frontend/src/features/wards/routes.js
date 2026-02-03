import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS, ROLES } from '@/shared/constants/roles'

const WardsPage = lazy(() => import('./pages/WardsPage'))
const NewWardPage = lazy(() => import('./pages/NewWardPage'))
const WardReportsPage = lazy(() => import('./pages/WardReportsPage'))
const EditWardPage = lazy(() => import('./pages/EditWardPage'))
const WardDetailPage = lazy(() => import('./pages/WardDetailPage'))

export const wardRoutes = [
  {
    path: '/wards',
    component: WardsPage,
    roles: ROLE_GROUPS.WARDS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Wards | Hospital Management System',
    breadcrumbs: [{ label: 'Wards', path: '/wards' }],
  },
  {
    path: '/wards/new',
    component: NewWardPage,
    roles: [ROLES.ADMIN],
    layout: ROUTE_LAYOUTS.APP,
    title: 'New Ward | Hospital Management System',
    breadcrumbs: [
      { label: 'Wards', path: '/wards' },
      { label: 'New Ward', path: '/wards/new' },
    ],
  },
  {
    path: '/wards/reports',
    component: WardReportsPage,
    roles: ROLE_GROUPS.WARDS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Ward Reports | Hospital Management System',
    breadcrumbs: [
      { label: 'Wards', path: '/wards' },
      { label: 'Reports', path: '/wards/reports' },
    ],
  },
  {
    path: '/wards/:wardId/edit',
    component: EditWardPage,
    roles: [ROLES.ADMIN],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Edit Ward | Hospital Management System',
    breadcrumbs: [
      { label: 'Wards', path: '/wards' },
      { label: 'Edit Ward', path: '/wards/:wardId/edit' },
    ],
  },
  {
    path: '/wards/:wardId',
    component: WardDetailPage,
    roles: ROLE_GROUPS.WARDS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Ward Details | Hospital Management System',
    breadcrumbs: [
      { label: 'Wards', path: '/wards' },
      { label: 'Ward', path: '/wards/:wardId' },
    ],
  },
]
