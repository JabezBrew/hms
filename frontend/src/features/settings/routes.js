import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ADMIN_CAPABILITIES, ROLE_GROUPS } from '@/shared/constants/roles'

const SettingsHubPage = lazy(() => import('./pages/SettingsHubPage'))
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage'))
const SecuritySettingsPage = lazy(() => import('./pages/SecuritySettingsPage'))
const PreferencesSettingsPage = lazy(() => import('./pages/PreferencesSettingsPage'))
const FeatureEntitlementsPage = lazy(() => import('./pages/FeatureEntitlementsPage'))

const SETTINGS_BREADCRUMB = { label: 'Settings', path: '/settings' }

export const settingsRoutes = [
  {
    path: '/settings',
    component: SettingsHubPage,
    roles: null,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Settings | Hospital Management System',
    breadcrumbs: [SETTINGS_BREADCRUMB],
  },
  {
    path: '/settings/profile',
    component: ProfileSettingsPage,
    roles: null,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Profile Settings | Hospital Management System',
    breadcrumbs: [SETTINGS_BREADCRUMB, { label: 'Profile', path: '/settings/profile' }],
  },
  {
    path: '/settings/security',
    component: SecuritySettingsPage,
    roles: null,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Security Settings | Hospital Management System',
    breadcrumbs: [SETTINGS_BREADCRUMB, { label: 'Security', path: '/settings/security' }],
  },
  {
    path: '/settings/preferences',
    component: PreferencesSettingsPage,
    roles: null,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Preferences | Hospital Management System',
    breadcrumbs: [SETTINGS_BREADCRUMB, { label: 'Preferences', path: '/settings/preferences' }],
  },
  {
    path: '/settings/feature-entitlements',
    component: FeatureEntitlementsPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    capabilities: [ADMIN_CAPABILITIES.FEATURE_ENTITLEMENTS_MANAGE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Feature Entitlements | Hospital Management System',
    breadcrumbs: [SETTINGS_BREADCRUMB, { label: 'Feature Entitlements', path: '/settings/feature-entitlements' }],
  },
]
