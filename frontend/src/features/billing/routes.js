import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES, ROLE_GROUPS } from '@/shared/constants/roles'

const BillingDashboardPage = lazy(() => import('./pages/BillingDashboardPage'))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'))
const InvoiceCreatePage = lazy(() => import('./pages/InvoiceCreatePage'))
const InvoiceDetailPage = lazy(() => import('./pages/InvoiceDetailPage'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const ClaimsPage = lazy(() => import('./pages/ClaimsPage'))
const InsuranceManagementPage = lazy(() => import('./pages/InsuranceManagementPage'))

const BILLING_BREADCRUMB = { label: 'Billing', path: '/billing' }

export const billingRoutes = [
  {
    path: '/billing',
    component: BillingDashboardPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Billing Dashboard | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB],
  },
  {
    path: '/billing/invoices',
    component: InvoicesPage,
    roles: ROLE_GROUPS.BILLING,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Invoices | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Invoices', path: '/billing/invoices' }],
  },
  {
    path: '/billing/invoices/new',
    component: InvoiceCreatePage,
    roles: [ROLES.ADMIN, ROLES.BILLING, ROLES.RECEPTIONIST],
    layout: ROUTE_LAYOUTS.APP,
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
    roles: [ROLES.ADMIN, ROLES.BILLING, ROLES.RECEPTIONIST],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Payments | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Payments', path: '/billing/payments' }],
  },
  {
    path: '/billing/claims',
    component: ClaimsPage,
    roles: [ROLES.ADMIN, ROLES.BILLING],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Claims | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Claims', path: '/billing/claims' }],
  },
  {
    path: '/billing/insurance',
    component: InsuranceManagementPage,
    roles: [ROLES.ADMIN, ROLES.BILLING, ROLES.RECEPTIONIST],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Insurance Management | Hospital Management System',
    breadcrumbs: [BILLING_BREADCRUMB, { label: 'Insurance', path: '/billing/insurance' }],
  },
]
