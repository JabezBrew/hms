import { lazy } from 'react'
import { ROUTE_LAYOUTS, SIDEBARS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS } from '@/shared/constants/roles'

const BillingDashboardPage = lazy(() => import('./pages/BillingDashboardPage'))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'))
const InvoiceCreatePage = lazy(() => import('./pages/InvoiceCreatePage'))
const InvoiceDetailPage = lazy(() => import('./pages/InvoiceDetailPage'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const ServiceCatalogPage = lazy(() => import('./pages/ServiceCatalogPage'))
const PspReconciliationPage = lazy(() => import('./pages/PspReconciliationPage'))
const ClaimsPage = lazy(() => import('./pages/ClaimsPage'))
const NhisClaimsArPage = lazy(() => import('./pages/NhisClaimsArPage'))
const NhisServiceMappingsPage = lazy(() => import('./pages/NhisServiceMappingsPage'))
const InsuranceManagementPage = lazy(() => import('./pages/InsuranceManagementPage'))
const CashSessionsPage = lazy(() => import('./pages/CashSessionsPage'))
const BillingDischargesPage = lazy(() => import('@/features/discharge/pages/BillingDischargesPage'))

const BILLING_BREADCRUMB = { label: 'Billing', path: '/billing' }

export const billingRoutes = [
  {
    path: '/billing',
    component: BillingDashboardPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'Billing Dashboard | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB],
  },
  {
    path: '/billing/invoices',
    component: InvoicesPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'Invoices | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Invoices', path: '/billing/invoices' }],
  },
  {
    path: '/billing/invoices/new',
    component: InvoiceCreatePage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'New Invoice | Hospital Management System',
    breadcrumbs: [
      BILLING_BREADCRUMB,
      { label: 'Invoices', path: '/billing/invoices' },
      { label: 'New Invoice', path: '/billing/invoices/new' },
    ],
  },
  {
    path: '/billing/invoices/:id',
    component: InvoiceDetailPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'Invoice Details | Hospital Management System',
    breadcrumbs: [
      BILLING_BREADCRUMB,
      { label: 'Invoices', path: '/billing/invoices' },
      { label: 'Invoice', path: '/billing/invoices/:id' },
    ],
  },
  {
    path: '/billing/payments',
    component: PaymentsPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'Payments | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Payments', path: '/billing/payments' }],
  },
  {
    path: '/billing/catalog',
    component: ServiceCatalogPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'Service Catalog | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Catalog', path: '/billing/catalog' }],
  },
  {
    path: '/billing/psp',
    component: PspReconciliationPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'PSP Collections | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'PSP', path: '/billing/psp' }],
  },
  {
    path: '/billing/cash-sessions',
    component: CashSessionsPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'Cash Sessions | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Cash Sessions', path: '/billing/cash-sessions' }],
  },
  {
    path: '/billing/claims',
    component: ClaimsPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'Claims | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Claims', path: '/billing/claims' }],
  },
  {
    path: '/billing/nhis',
    component: NhisClaimsArPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'NHIS Claims + AR | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'NHIS', path: '/billing/nhis' }],
  },
  {
    path: '/billing/nhis/mappings',
    component: NhisServiceMappingsPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'NHIS Service Mappings | Hospital Management System',
    breadcrumbs: [
      BILLING_BREADCRUMB,
      { label: 'NHIS', path: '/billing/nhis' },
      { label: 'Mappings', path: '/billing/nhis/mappings' },
    ],
  },
  {
    path: '/billing/insurance',
    component: InsuranceManagementPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'Insurance Management | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Insurance', path: '/billing/insurance' }],
  },
  {
    path: '/billing/discharges',
    component: BillingDischargesPage,
    roles: ROLE_GROUPS.BILLING,
    features: ['discharge_workflows'],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.BILLING,
    title: 'Billing Discharges | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Discharges', path: '/billing/discharges' }],
  },
]
