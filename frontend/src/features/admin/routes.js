import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES, ROLE_GROUPS } from '@/shared/constants/roles'

const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'))
const SystemJobsPage = lazy(() => import('./pages/SystemJobsPage'))
const OrganizationPage = lazy(() => import('./pages/organization/OrganizationPage'))
const UnitTypesPage = lazy(() => import('./pages/organization/UnitTypesPage'))
const LeadershipRolesPage = lazy(() => import('./pages/organization/LeadershipRolesPage'))
const DutyRosterPage = lazy(() => import('./pages/organization/DutyRosterPage'))
const RosterSetupPage = lazy(() => import('./pages/organization/RosterSetupPage'))
const RosterBuilderPage = lazy(() => import('./pages/organization/RosterBuilderPage'))

const ADMIN_BREADCRUMB = { label: 'Admin', path: '/admin/organization' }
const ORG_BREADCRUMB = { label: 'Organization', path: '/admin/organization' }

export const adminRoutes = [
  {
    path: '/admin/audit-logs',
    component: AuditLogsPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Audit Logs | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, { label: 'Audit Logs', path: '/admin/audit-logs' }],
  },
  {
    path: '/admin/system-jobs',
    component: SystemJobsPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Background Jobs | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, { label: 'Background Jobs', path: '/admin/system-jobs' }],
  },
  {
    path: '/admin/organization',
    component: OrganizationPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Organization | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB],
  },
  {
    path: '/admin/organization/unit-types',
    component: UnitTypesPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Unit Types | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Unit Types', path: '/admin/organization/unit-types' }],
  },
  {
    path: '/admin/organization/leadership-roles',
    component: LeadershipRolesPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Leadership Roles | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Leadership Roles', path: '/admin/organization/leadership-roles' }],
  },
  {
    path: '/admin/organization/duty-roster',
    component: DutyRosterPage,
    roles: [ROLES.ADMIN, ROLES.HEAD_NURSE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Duty Roster | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Duty Roster', path: '/admin/organization/duty-roster' }],
  },
  {
    path: '/admin/organization/roster-setup',
    component: RosterSetupPage,
    roles: [ROLES.ADMIN, ROLES.HEAD_NURSE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Roster Setup | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Roster Setup', path: '/admin/organization/roster-setup' }],
  },
  {
    path: '/admin/organization/roster-builder',
    component: RosterBuilderPage,
    roles: [ROLES.ADMIN, ROLES.HEAD_NURSE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Roster Builder | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Roster Builder', path: '/admin/organization/roster-builder' }],
  },
]
