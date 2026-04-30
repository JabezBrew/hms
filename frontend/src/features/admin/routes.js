import { lazy } from 'react'
import { ROUTE_LAYOUTS, SIDEBARS } from '@/app/routes/routeTypes'
import { ADMIN_CAPABILITIES, ROLES, ROLE_GROUPS } from '@/shared/constants/roles'

const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'))
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
    capabilities: [ADMIN_CAPABILITIES.AUDIT_VIEW],
    features: ['audit'],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.ADMIN,
    title: 'Audit Logs | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, { label: 'Audit Logs', path: '/admin/audit-logs' }],
  },
  {
    path: '/admin/organization',
    component: OrganizationPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    capabilities: [ADMIN_CAPABILITIES.ORGANIZATION_MANAGE],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.ADMIN,
    title: 'Organization | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB],
  },
  {
    path: '/admin/organization/unit-types',
    component: UnitTypesPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    capabilities: [ADMIN_CAPABILITIES.ORGANIZATION_MANAGE],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.ADMIN,
    title: 'Unit Types | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Unit Types', path: '/admin/organization/unit-types' }],
  },
  {
    path: '/admin/organization/leadership-roles',
    component: LeadershipRolesPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    capabilities: [ADMIN_CAPABILITIES.ORGANIZATION_MANAGE],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.ADMIN,
    title: 'Leadership Roles | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Leadership Roles', path: '/admin/organization/leadership-roles' }],
  },
  {
    path: '/admin/organization/duty-roster',
    component: DutyRosterPage,
    roles: [ROLES.ADMIN, ROLES.HEAD_NURSE],
    capabilities: [ADMIN_CAPABILITIES.ROSTER_VIEW],
    features: ['department_rosters'],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.ADMIN,
    title: 'Duty Roster | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Duty Roster', path: '/admin/organization/duty-roster' }],
  },
  {
    path: '/admin/organization/roster-setup',
    component: RosterSetupPage,
    roles: [ROLES.ADMIN, ROLES.HEAD_NURSE],
    capabilities: [ADMIN_CAPABILITIES.ROSTER_MANAGE],
    features: ['department_rosters'],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.ADMIN,
    title: 'Roster Setup | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Roster Setup', path: '/admin/organization/roster-setup' }],
  },
  {
    path: '/admin/organization/roster-builder',
    component: RosterBuilderPage,
    roles: [ROLES.ADMIN, ROLES.HEAD_NURSE],
    capabilities: [ADMIN_CAPABILITIES.ROSTER_MANAGE],
    features: ['department_rosters'],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.ADMIN,
    title: 'Roster Builder | Hospital Management System',
    breadcrumbs: [ADMIN_BREADCRUMB, ORG_BREADCRUMB, { label: 'Roster Builder', path: '/admin/organization/roster-builder' }],
  },
]
