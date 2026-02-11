import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'

const SettingsHubPage = lazy(() => import('./pages/SettingsHubPage'))
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage'))
const SecuritySettingsPage = lazy(() => import('./pages/SecuritySettingsPage'))
const PreferencesSettingsPage = lazy(() => import('./pages/PreferencesSettingsPage'))

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
]
