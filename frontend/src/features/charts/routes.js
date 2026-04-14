import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'

const ChartBuilderPage = lazy(() => import('./pages/ChartBuilderPage'))
const ChartTemplateListPage = lazy(() => import('./pages/ChartTemplateListPage'))

const CHARTS_BREADCRUMB = { label: 'Charts', path: '/charts/templates' }
const CHARTS_ROLES = [
  ROLES.ADMIN,
  ROLES.HEAD_NURSE,
]

export const chartRoutes = [
  {
    path: '/charts/templates',
    component: ChartTemplateListPage,
    roles: CHARTS_ROLES,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Chart Templates | Hospital Management System',
    breadcrumbs: [CHARTS_BREADCRUMB, { label: 'Templates', path: '/charts/templates' }],
  },
  {
    path: '/charts/builder',
    component: ChartBuilderPage,
    roles: CHARTS_ROLES,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Chart Builder | Hospital Management System',
    breadcrumbs: [CHARTS_BREADCRUMB, { label: 'Builder', path: '/charts/builder' }],
  },
  {
    path: '/charts/builder/:id',
    component: ChartBuilderPage,
    roles: CHARTS_ROLES,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Chart Builder | Hospital Management System',
    breadcrumbs: [CHARTS_BREADCRUMB, { label: 'Builder', path: '/charts/builder/:id' }],
  },
]
