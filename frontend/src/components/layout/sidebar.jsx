const DEFAULT_EMPTY_OBJECT = {};

import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.js'
import Calendar from 'lucide-react/dist/esm/icons/calendar.js'
import Inbox from 'lucide-react/dist/esm/icons/inbox.js'
import Settings from 'lucide-react/dist/esm/icons/settings.js'
import Activity from 'lucide-react/dist/esm/icons/activity.js'
import FileText from 'lucide-react/dist/esm/icons/file-text.js'
import Pill from 'lucide-react/dist/esm/icons/pill.js'
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js'
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js'
import Shield from 'lucide-react/dist/esm/icons/shield.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import Clock from 'lucide-react/dist/esm/icons/clock.js'
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import FileSearch from 'lucide-react/dist/esm/icons/file-search.js'
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js'
import ArrowLeftRight from 'lucide-react/dist/esm/icons/arrow-left-right.js'
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js'
import Gauge from 'lucide-react/dist/esm/icons/gauge.js'
import FolderTree from 'lucide-react/dist/esm/icons/folder-tree.js'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Warehouse from 'lucide-react/dist/esm/icons/warehouse.js'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js'
import FileBox from 'lucide-react/dist/esm/icons/file-box.js'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js'
import UserRound from 'lucide-react/dist/esm/icons/user-round.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js'
import IdCard from 'lucide-react/dist/esm/icons/id-card.js'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarFooter,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useAuth } from '@/lib/auth'
import { useInboxCount } from '@/features/inbox/hooks'
import { isOpsDashboardHost } from '@/features/ops/host'
import { useSystemCapabilities } from '@/hooks/useSystemQueries'
import { ADMIN_CAPABILITIES, ROLES, ROLE_GROUPS } from '@/shared/constants/roles'
import { userCanAccess } from '@/shared/lib/access'
import { areFeaturesEnabled } from '@/shared/lib/features'
import { useSidebarState } from '@/hooks/useSidebarState'
import { SIDEBARS } from '@/app/routes/routeTypes'
import { useLocation, useParams } from 'react-router-dom'

const DASHBOARD_ROLES = [
  ROLES.ADMIN,
  ROLES.DOCTOR,
  ROLES.NURSE,
  ROLES.RECEPTIONIST,
  ROLES.PRACTITIONER,
  ROLES.PHYSICIAN,
  ROLES.HEAD_NURSE,
  ROLES.NURSE_PRACTITIONER,
  ROLES.INPATIENT_DOCTOR,
  ROLES.PHARMACIST,
  ROLES.LAB_TECHNICIAN,
  ROLES.BILLING,
  ROLES.STORE_KEEPER,
  'front_desk',
]

const INBOX_ROLES = [
  ROLES.ADMIN,
  ROLES.DOCTOR,
  ROLES.NURSE,
  ROLES.INPATIENT_DOCTOR,
  ROLES.PRACTITIONER,
  ROLES.PHYSICIAN,
]

const LAB_CATALOG_ROLES = [ROLES.ADMIN, ROLES.LAB_TECHNICIAN, ROLES.DOCTOR]
const LAB_RESULTS_ROLES = [
  ROLES.ADMIN,
  ROLES.LAB_TECHNICIAN,
  ROLES.DOCTOR,
  ROLES.PHYSICIAN,
  ROLES.PRACTITIONER,
]
const NOTE_TEMPLATE_ROLES = [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE]
const CHART_TEMPLATE_ROLES = [
  ROLES.ADMIN,
  ROLES.DOCTOR,
  ROLES.NURSE,
  ROLES.HEAD_NURSE,
  ROLES.NURSE_PRACTITIONER,
  ROLES.PHYSICIAN,
  ROLES.PRACTITIONER,
]
const DUTY_ROSTER_ROLES = [ROLES.ADMIN, ROLES.HEAD_NURSE]

function getDashboardUrl(role) {
  if ([ROLES.NURSE, ROLES.HEAD_NURSE, ROLES.NURSE_PRACTITIONER].includes(role)) {
    return '/dashboards/nurse'
  }
  if ([ROLES.DOCTOR, ROLES.INPATIENT_DOCTOR].includes(role)) {
    return '/dashboards/inpatient'
  }
  if ([ROLES.RECEPTIONIST, 'front_desk'].includes(role)) {
    return '/dashboards/reception'
  }
  if (role === ROLES.ADMIN) {
    return '/dashboards/admin'
  }
  if ([ROLES.PHARMACIST, ROLES.PHARMACY_TECH].includes(role)) {
    return '/pharmacy/dispensing'
  }
  if (role === ROLES.LAB_TECHNICIAN) {
    return '/laboratory/dashboard'
  }
  if (role === ROLES.BILLING) {
    return '/billing'
  }
  if (role === ROLES.STORE_KEEPER) {
    return '/inventory'
  }
  return '/dashboard/provider'
}

function getDashboardFeatures(role) {
  if ([ROLES.NURSE, ROLES.HEAD_NURSE, ROLES.NURSE_PRACTITIONER].includes(role)) {
    return ['nursing_workflows']
  }
  if ([ROLES.DOCTOR, ROLES.INPATIENT_DOCTOR].includes(role)) {
    return ['inpatient_admissions']
  }
  if ([ROLES.PHARMACIST, ROLES.PHARMACY_TECH].includes(role)) {
    return ['pharmacy']
  }
  if (role === ROLES.LAB_TECHNICIAN) {
    return ['laboratory']
  }
  if (role === ROLES.BILLING) {
    return ['billing']
  }
  if (role === ROLES.STORE_KEEPER) {
    return ['inventory']
  }
  return []
}

const item = ({
  key,
  label,
  href,
  icon,
  roles,
  capabilities,
  features,
  children,
  exact,
  badge,
  props,
  host,
}) => ({
  key,
  label,
  href,
  icon,
  roles,
  capabilities,
  features,
  children,
  exact,
  badge,
  props,
  host,
})

const section = (key, label, items) => ({ key, label, items })

const dashboardItem = item({
  key: 'dashboard',
  label: 'Dashboard',
  href: ({ user }) => getDashboardUrl(user?.role || user?.user_type || ''),
  icon: LayoutDashboard,
  roles: DASHBOARD_ROLES,
  features: ({ user }) => getDashboardFeatures(user?.role || user?.user_type || ''),
  exact: true,
  props: { 'data-onboarding': 'nav-dashboard' },
})

const inboxItem = item({
  key: 'inbox',
  label: 'Inbox',
  href: '/inbox',
  icon: Inbox,
  roles: INBOX_ROLES,
  exact: true,
  badge: 'inbox',
})

const patientRegistryItem = item({
  key: 'patients',
  label: 'Patient Registry',
  href: '/patients',
  icon: BookOpen,
  roles: ROLE_GROUPS.PATIENT_REGISTRY,
  features: ['patient_chronicle'],
  exact: true,
  props: { 'data-onboarding': 'nav-patients' },
})

const shortcutItems = [dashboardItem, inboxItem, patientRegistryItem]

const globalSections = [
  section('menu', 'Menu', [
    dashboardItem,
    inboxItem,
    patientRegistryItem,
    item({
      key: 'appointments',
      label: 'Appointments',
      icon: Calendar,
      features: ['appointments'],
      children: [
        item({
          key: 'schedule',
          label: 'Schedule',
          href: '/appointments',
          icon: Calendar,
          roles: ROLE_GROUPS.APPOINTMENTS,
          exact: true,
        }),
        item({
          key: 'availability',
          label: 'Availability',
          href: '/practitioner-availability',
          icon: Clock,
          roles: ROLE_GROUPS.PRACTITIONER_AVAILABILITY,
          exact: true,
        }),
      ],
    }),
  ]),
  section('operations', 'Operations', [
    item({
      key: 'wards',
      label: 'Wards',
      href: '/wards',
      icon: Activity,
      roles: ROLE_GROUPS.WARDS,
      features: ['wards'],
      exact: true,
    }),
    item({
      key: 'shift-handoff',
      label: 'Shift Handoff',
      href: '/nursing/shift-handoff',
      icon: ArrowLeftRight,
      roles: ROLE_GROUPS.NURSING_DASHBOARD,
      features: ['nursing_workflows'],
      exact: true,
    }),
    item({
      key: 'ward-stock-requests',
      label: 'Ward Stock',
      href: '/nursing/ward-stock-requests',
      icon: Package,
      roles: ROLE_GROUPS.NURSING_DASHBOARD,
      features: ['nursing_workflows', 'inventory'],
      exact: true,
    }),
    item({
      key: 'laboratory',
      label: 'Laboratory',
      icon: FlaskConical,
      features: ['laboratory'],
      children: [
        item({
          key: 'lab-catalog',
          label: 'Catalog',
          href: '/laboratory/catalog',
          icon: FlaskConical,
          roles: LAB_CATALOG_ROLES,
          exact: true,
        }),
        item({
          key: 'lab-worklist',
          label: 'Worklist',
          href: '/laboratory/dashboard',
          icon: ClipboardList,
          roles: ROLE_GROUPS.LAB_TECHS,
          exact: true,
        }),
        item({
          key: 'lab-orders',
          label: 'Orders',
          href: '/laboratory/orders',
          icon: TestTube2,
          roles: ROLE_GROUPS.LAB_ACCESS,
          exact: true,
        }),
        item({
          key: 'lab-results',
          label: 'Results',
          href: '/laboratory/results',
          icon: FileText,
          roles: LAB_RESULTS_ROLES,
          exact: true,
        }),
      ],
    }),
    item({
      key: 'pharmacy',
      label: 'Pharmacy',
      icon: Pill,
      roles: ROLE_GROUPS.PHARMACY,
      features: ['pharmacy'],
      children: [
        item({
          key: 'pharmacy-dispensing',
          label: 'Dispensing',
          href: '/pharmacy/dispensing',
          icon: Pill,
          exact: true,
        }),
      ],
    }),
    item({
      key: 'billing',
      label: 'Billing',
      href: '/billing',
      icon: CreditCard,
      roles: ROLE_GROUPS.BILLING,
      features: ['billing'],
      exact: true,
    }),
    item({
      key: 'inventory',
      label: 'Inventory',
      icon: Package,
      roles: ROLE_GROUPS.INVENTORY,
      features: ['inventory'],
      children: [
        item({ key: 'inventory-dashboard', label: 'Dashboard', href: '/inventory', icon: LayoutDashboard, exact: true }),
        item({ key: 'inventory-items', label: 'Items', href: '/inventory/items', icon: Package, exact: false }),
        item({ key: 'inventory-locations', label: 'Locations', href: '/inventory/locations', icon: Warehouse, exact: true }),
        item({ key: 'inventory-requisitions', label: 'Requisitions', href: '/inventory/requisitions', icon: ClipboardList, exact: false }),
        item({ key: 'inventory-purchase-orders', label: 'Purchase Orders', href: '/inventory/purchase-orders', icon: ShoppingCart, exact: false }),
        item({ key: 'inventory-grns', label: 'GRNs', href: '/inventory/grns', icon: FileBox, exact: false }),
        item({ key: 'inventory-transfers', label: 'Transfers', href: '/inventory/transfers', icon: Truck, exact: true }),
        item({ key: 'inventory-controlled', label: 'Controlled', href: '/inventory/controlled', icon: AlertTriangle, exact: false }),
        item({ key: 'inventory-analytics', label: 'Analytics', href: '/inventory/analytics', icon: BarChart3, exact: true }),
      ],
    }),
    item({
      key: 'clinical-content',
      label: 'Clinical Content',
      icon: FileText,
      features: ['clinical_notes'],
      props: { 'data-onboarding': 'nav-clinical-content-toggle' },
      children: [
        item({
          key: 'note-templates',
          label: 'Note Templates',
          href: '/clinical-notes/templates',
          icon: ClipboardList,
          roles: NOTE_TEMPLATE_ROLES,
          exact: true,
          props: { 'data-onboarding': 'nav-note-templates' },
        }),
      ],
    }),
    item({
      key: 'administration',
      label: 'Administration',
      icon: Shield,
      children: [
        item({
          key: 'staff',
          label: 'Staff',
          href: '/staff',
          icon: Shield,
          roles: ROLE_GROUPS.ADMIN_ONLY,
          capabilities: [ADMIN_CAPABILITIES.STAFF_VIEW],
          exact: false,
        }),
        item({
          key: 'organization',
          label: 'Organization',
          href: '/admin/organization',
          icon: FolderTree,
          roles: ROLE_GROUPS.ADMIN_ONLY,
          capabilities: [ADMIN_CAPABILITIES.ORGANIZATION_MANAGE],
          exact: false,
        }),
        item({
          key: 'duty-roster',
          label: 'Duty Roster',
          href: '/admin/organization/duty-roster',
          icon: CalendarClock,
          roles: DUTY_ROSTER_ROLES,
          capabilities: [ADMIN_CAPABILITIES.ROSTER_VIEW],
          features: ['department_rosters'],
          exact: true,
        }),
        item({
          key: 'audit-logs',
          label: 'Audit Logs',
          href: '/admin/audit-logs',
          icon: FileSearch,
          roles: ROLE_GROUPS.ADMIN_ONLY,
          capabilities: [ADMIN_CAPABILITIES.AUDIT_VIEW],
          features: ['audit'],
          exact: true,
        }),
        item({
          key: 'ops-dashboard',
          label: 'Ops Dashboard',
          href: '/system/ops',
          icon: Gauge,
          roles: [],
          capabilities: [ADMIN_CAPABILITIES.SYSTEM_OPS_VIEW],
          host: 'ops',
          exact: true,
        }),
      ],
    }),
  ]),
]

const patientSections = [
  section('patients', 'Patients', [
    patientRegistryItem,
    item({
      key: 'my-patients',
      label: 'My Patients',
      href: '/patients/my-patients',
      icon: Users,
      roles: ROLE_GROUPS.MY_PATIENTS,
      features: ['patient_chronicle'],
      exact: true,
    }),
    item({
      key: 'register-patient',
      label: 'Register Patient',
      href: '/patients/create',
      icon: UserPlus,
      roles: [ROLES.ADMIN, ROLES.RECEPTIONIST],
      features: ['patient_chronicle', 'patient_registration'],
      exact: true,
    }),
  ]),
]

const patientWorkspaceSections = [
  section('patient-workspace', 'Patient Workspace', [
    patientRegistryItem,
    item({
      key: 'patient-chronicle',
      label: 'Chronicle',
      href: ({ params }) => params.id ? `/patients/${params.id}` : null,
      icon: BookOpen,
      roles: ROLE_GROUPS.PATIENT_DETAIL,
      features: ['patient_chronicle'],
      exact: true,
    }),
    item({
      key: 'edit-demographics',
      label: 'Edit Demographics',
      href: ({ params }) => params.id ? `/patients/${params.id}/edit` : null,
      icon: IdCard,
      roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE],
      features: ['patient_chronicle', 'patient_registration'],
      exact: true,
    }),
    item({
      key: 'ward-round',
      label: 'Ward Round',
      href: ({ params }) => params.id ? `/patients/${params.id}/ward-round` : null,
      icon: ClipboardList,
      roles: ROLE_GROUPS.CLINICAL,
      features: ['patient_chronicle', 'wards'],
      exact: true,
    }),
  ]),
]

const billingSections = [
  section('billing', 'Billing', [
    item({ key: 'billing-dashboard', label: 'Dashboard', href: '/billing', icon: LayoutDashboard, roles: ROLE_GROUPS.BILLING, features: ['billing'], exact: true }),
    item({ key: 'invoices', label: 'Invoices', href: '/billing/invoices', icon: FileText, roles: ROLE_GROUPS.BILLING, features: ['billing'], exact: false }),
    item({ key: 'payments', label: 'Payments', href: '/billing/payments', icon: CreditCard, roles: ROLE_GROUPS.BILLING, features: ['billing'], exact: true }),
    item({ key: 'cash-sessions', label: 'Cash Sessions', href: '/billing/cash-sessions', icon: Clock, roles: ROLE_GROUPS.BILLING, features: ['billing'], exact: true }),
    item({ key: 'claims', label: 'Claims', href: '/billing/claims', icon: ClipboardList, roles: ROLE_GROUPS.BILLING, features: ['billing', 'insurance_claims'], exact: true }),
    item({ key: 'nhis', label: 'NHIS', href: '/billing/nhis', icon: Shield, roles: ROLE_GROUPS.BILLING, features: ['billing', 'insurance_claims'], exact: false }),
    item({ key: 'insurance', label: 'Insurance', href: '/billing/insurance', icon: IdCard, roles: ROLE_GROUPS.BILLING, features: ['billing'], exact: true }),
    item({ key: 'billing-discharges', label: 'Discharges', href: '/billing/discharges', icon: ArrowLeftRight, roles: ROLE_GROUPS.BILLING, features: ['billing', 'discharge_workflows'], exact: true }),
    item({ key: 'catalog', label: 'Catalog', href: '/billing/catalog', icon: BookOpen, roles: ROLE_GROUPS.BILLING, features: ['billing'], exact: true }),
  ]),
]

const inventorySections = [
  section('inventory', 'Inventory', [
    item({ key: 'inventory-dashboard', label: 'Dashboard', href: '/inventory', icon: LayoutDashboard, roles: ROLE_GROUPS.INVENTORY, features: ['inventory'], exact: true }),
    item({ key: 'inventory-items', label: 'Items', href: '/inventory/items', icon: Package, roles: ROLE_GROUPS.INVENTORY, features: ['inventory'], exact: false }),
    item({ key: 'inventory-locations', label: 'Locations', href: '/inventory/locations', icon: Warehouse, roles: ROLE_GROUPS.INVENTORY, features: ['inventory'], exact: true }),
    item({ key: 'inventory-requisitions', label: 'Requisitions', href: '/inventory/requisitions', icon: ClipboardList, roles: ROLE_GROUPS.INVENTORY, features: ['inventory'], exact: false }),
    item({ key: 'inventory-purchase-orders', label: 'Purchase Orders', href: '/inventory/purchase-orders', icon: ShoppingCart, roles: ROLE_GROUPS.INVENTORY, features: ['inventory'], exact: false }),
    item({ key: 'inventory-grns', label: 'GRNs', href: '/inventory/grns', icon: FileBox, roles: ROLE_GROUPS.INVENTORY, features: ['inventory'], exact: false }),
    item({ key: 'inventory-transfers', label: 'Transfers', href: '/inventory/transfers', icon: Truck, roles: ROLE_GROUPS.INVENTORY, features: ['inventory'], exact: true }),
    item({ key: 'inventory-controlled', label: 'Controlled', href: '/inventory/controlled', icon: AlertTriangle, roles: ROLE_GROUPS.INVENTORY, features: ['inventory'], exact: false }),
    item({ key: 'inventory-analytics', label: 'Analytics', href: '/inventory/analytics', icon: BarChart3, roles: ROLE_GROUPS.INVENTORY, features: ['inventory'], exact: true }),
  ]),
]

const laboratorySections = [
  section('laboratory', 'Laboratory', [
    item({ key: 'lab-dashboard', label: 'Worklist', href: '/laboratory/dashboard', icon: LayoutDashboard, roles: ROLE_GROUPS.LAB_TECHS, features: ['laboratory'], exact: true }),
    item({ key: 'lab-catalog', label: 'Catalog', href: '/laboratory/catalog', icon: FlaskConical, roles: LAB_CATALOG_ROLES, features: ['laboratory'], exact: true }),
    item({ key: 'lab-orders', label: 'Orders', href: '/laboratory/orders', icon: TestTube2, roles: ROLE_GROUPS.LAB_ACCESS, features: ['laboratory'], exact: true }),
    item({ key: 'lab-results', label: 'Results', href: '/laboratory/results', icon: FileText, roles: LAB_RESULTS_ROLES, features: ['laboratory'], exact: true }),
  ]),
]

const pharmacySections = [
  section('pharmacy', 'Pharmacy', [
    item({ key: 'pharmacy-dispensing', label: 'Dispensing', href: '/pharmacy/dispensing', icon: Pill, roles: ROLE_GROUPS.PHARMACY, features: ['pharmacy'], exact: true }),
  ]),
]

const adminSections = [
  section('administration', 'Administration', [
    item({ key: 'staff', label: 'Staff', href: '/staff', icon: Shield, roles: ROLE_GROUPS.ADMIN_ONLY, capabilities: [ADMIN_CAPABILITIES.STAFF_VIEW], exact: false }),
    item({ key: 'organization', label: 'Organization', href: '/admin/organization', icon: FolderTree, roles: ROLE_GROUPS.ADMIN_ONLY, capabilities: [ADMIN_CAPABILITIES.ORGANIZATION_MANAGE], exact: false }),
    item({ key: 'duty-roster', label: 'Duty Roster', href: '/admin/organization/duty-roster', icon: CalendarClock, roles: DUTY_ROSTER_ROLES, capabilities: [ADMIN_CAPABILITIES.ROSTER_VIEW], features: ['department_rosters'], exact: true }),
    item({ key: 'audit-logs', label: 'Audit Logs', href: '/admin/audit-logs', icon: FileSearch, roles: ROLE_GROUPS.ADMIN_ONLY, capabilities: [ADMIN_CAPABILITIES.AUDIT_VIEW], features: ['audit'], exact: true }),
    item({ key: 'ops-dashboard', label: 'Ops Dashboard', href: '/system/ops', icon: Gauge, roles: [], capabilities: [ADMIN_CAPABILITIES.SYSTEM_OPS_VIEW], host: 'ops', exact: true }),
  ]),
]

const settingsSections = [
  section('settings', 'Settings', [
    item({ key: 'settings-hub', label: 'Settings', href: '/settings', icon: Settings, exact: true }),
    item({ key: 'profile-settings', label: 'Profile', href: '/settings/profile', icon: UserRound, exact: true }),
    item({ key: 'security-settings', label: 'Security', href: '/settings/security', icon: Lock, exact: true }),
    item({ key: 'preferences-settings', label: 'Preferences', href: '/settings/preferences', icon: SlidersHorizontal, exact: true }),
    item({
      key: 'feature-entitlements',
      label: 'Feature Entitlements',
      href: '/settings/feature-entitlements',
      icon: KeyRound,
      roles: ROLE_GROUPS.ADMIN_ONLY,
      capabilities: [ADMIN_CAPABILITIES.FEATURE_ENTITLEMENTS_MANAGE],
      exact: true,
    }),
  ]),
]

const SIDEBAR_SECTIONS = {
  [SIDEBARS.GLOBAL]: globalSections,
  [SIDEBARS.PATIENTS]: patientSections,
  [SIDEBARS.PATIENT_WORKSPACE]: patientWorkspaceSections,
  [SIDEBARS.BILLING]: billingSections,
  [SIDEBARS.INVENTORY]: inventorySections,
  [SIDEBARS.LABORATORY]: laboratorySections,
  [SIDEBARS.PHARMACY]: pharmacySections,
  [SIDEBARS.ADMIN]: adminSections,
  [SIDEBARS.SETTINGS]: settingsSections,
}

function resolveHref(href, context) {
  if (typeof href === 'function') {
    return href(context)
  }
  return href
}

function resolveEntryFeatures(features, context) {
  return typeof features === 'function' ? features(context) : features
}

function hasFeatureAccess(features, enabledFeatures, context) {
  return areFeaturesEnabled(resolveEntryFeatures(features, context), enabledFeatures)
}

function hasAccess(user, entry) {
  return userCanAccess(user, { roles: entry.roles, capabilities: entry.capabilities })
}

function normalizePath(path) {
  if (!path || path === '/') {
    return path || ''
  }
  return path.replace(/\/+$/, '')
}

function sidebarItemIsActive(entry, href, pathname) {
  const currentPath = normalizePath(pathname)
  const itemPath = normalizePath(href)

  if (!itemPath) {
    return false
  }
  if (entry.exact) {
    return currentPath === itemPath
  }
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`)
}

function formatBadge(value) {
  if (!value || Number(value) <= 0) {
    return null
  }
  return value > 99 ? '99+' : String(value)
}

function resolveItem(entry, context) {
  if (entry.host === 'ops' && !isOpsDashboardHost()) {
    return null
  }

  if (!hasFeatureAccess(entry.features, context.enabledFeatures, context) || !hasAccess(context.user, entry)) {
    return null
  }

  const href = resolveHref(entry.href, context)
  const children = Array.isArray(entry.children)
    ? entry.children.flatMap((child) => {
      const resolvedChild = resolveItem(child, context)
      return resolvedChild ? [resolvedChild] : []
    })
    : null

  if (entry.children && children.length === 0) {
    return null
  }
  if (!entry.children && !href) {
    return null
  }

  const active = Boolean(href) && sidebarItemIsActive(entry, href, context.location.pathname)
  const childActive = children?.some((child) => child.active || child.childActive) || false

  return {
    ...entry,
    href,
    children,
    active,
    childActive,
  }
}

function dedupeSections(sections) {
  const seenHrefs = new Set()

  return sections
    .map((currentSection) => {
      const items = currentSection.items.filter((currentItem) => {
        if (!currentItem.href) {
          return true
        }
        if (seenHrefs.has(currentItem.href)) {
          return false
        }
        seenHrefs.add(currentItem.href)
        return true
      })
      return { ...currentSection, items }
    })
    .filter((currentSection) => currentSection.items.length > 0)
}

/* eslint-disable react-refresh/only-export-components */
// False positive: this resolver is exported only for sidebar contract tests, while runtime callers stay in this module.
// react-doctor-disable-next-line react-doctor/only-export-components
export function resolveSidebarSections({ sidebar, user, enabledFeatures, inboxCount, location, params }) {
  const sidebarKey = SIDEBAR_SECTIONS[sidebar] ? sidebar : SIDEBARS.GLOBAL
  const baseSections = SIDEBAR_SECTIONS[sidebarKey]
  const context = {
    user,
    enabledFeatures,
    location,
    params,
    badges: {
      inbox: inboxCount,
    },
  }
  const resolvedSections = baseSections
    .map((currentSection) => ({
      ...currentSection,
      items: currentSection.items.flatMap((currentItem) => {
        const resolvedItem = resolveItem(currentItem, context)
        return resolvedItem ? [resolvedItem] : []
      }),
    }))
    .filter((currentSection) => currentSection.items.length > 0)

  if (sidebarKey === SIDEBARS.GLOBAL) {
    return resolvedSections
  }

  const shortcutSection = {
    key: 'shortcuts',
    label: 'Shortcuts',
    items: shortcutItems.flatMap((currentItem) => {
      const resolvedItem = resolveItem(currentItem, context)
      return resolvedItem ? [resolvedItem] : []
    }),
  }

  return dedupeSections([...resolvedSections, shortcutSection])
}
/* eslint-enable react-refresh/only-export-components */

function SidebarLeafItem({ entry, badgeValue, nested = false }) {
  const Icon = entry.icon
  const content = (
    <>
      {Icon ? <Icon className={nested ? 'size-4' : undefined} /> : null}
      <span>{entry.label}</span>
      {!nested && badgeValue ? <SidebarMenuBadge>{badgeValue}</SidebarMenuBadge> : null}
    </>
  )

  if (nested) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton href={entry.href} isActive={entry.active} {...(entry.props || {})}>
          {content}
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={entry.label}
        href={entry.href}
        isActive={entry.active}
        {...(entry.props || {})}
      >
        {content}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarGroupItem({ entry, getCollapsibleProps }) {
  const Icon = entry.icon
  const openState = getCollapsibleProps(entry.key)
  const forcedOpen = entry.childActive

  return (
    <Collapsible
      asChild
      className="group/collapsible"
      open={forcedOpen || openState.open}
      onOpenChange={openState.onOpenChange}
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={entry.label} isActive={entry.active || entry.childActive} {...(entry.props || {})}>
            {Icon ? <Icon /> : null}
            <span>{entry.label}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {entry.children.map((child) => (
              <SidebarLeafItem key={child.key} entry={child} nested />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

export function SidebarRenderer({ sections, badges = DEFAULT_EMPTY_OBJECT }) {
  const { getCollapsibleProps } = useSidebarState()

  return (
    <>
      {sections.map((currentSection, index) => (
        <div key={currentSection.key}>
          {index > 0 ? <SidebarSeparator /> : null}
          <SidebarGroup>
            <SidebarGroupLabel>{currentSection.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {currentSection.items.map((currentItem) => {
                  if (currentItem.children) {
                    return (
                      <SidebarGroupItem
                        key={currentItem.key}
                        entry={currentItem}
                        getCollapsibleProps={getCollapsibleProps}
                      />
                    )
                  }
                  return (
                    <SidebarLeafItem
                      key={currentItem.key}
                      entry={currentItem}
                      badgeValue={formatBadge(badges[currentItem.badge])}
                    />
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      ))}
    </>
  )
}

export function AppSidebar({ sidebar = SIDEBARS.GLOBAL }) {
  const { user } = useAuth()
  const { count: inboxCount } = useInboxCount()
  const { data: deploymentCapabilities } = useSystemCapabilities()
  const enabledFeatures = deploymentCapabilities?.features
  const location = useLocation()
  const params = useParams()
  const sections = resolveSidebarSections({
    sidebar,
    user,
    enabledFeatures,
    inboxCount,
    location,
    params,
  })

  return (
    <SidebarContent>
      <SidebarRenderer sections={sections} badges={{ inbox: inboxCount }} />

      {sidebar !== SIDEBARS.SETTINGS ? (
        <div className="mt-auto">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarLeafItem
                  entry={{
                    key: 'settings-footer',
                    label: 'Settings',
                    href: '/settings',
                    icon: Settings,
                    active: sidebarItemIsActive({ exact: false }, '/settings', location.pathname),
                  }}
                />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      ) : (
        <div className="mt-auto" />
      )}

      <SidebarFooter>
        <div className="px-2 text-xs text-muted-foreground">
          HMS v2.0
        </div>
      </SidebarFooter>
    </SidebarContent>
  )
}
