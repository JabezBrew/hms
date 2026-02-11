import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS } from '@/shared/constants/roles'

const InventoryDashboardPage = lazy(() => import('./pages/InventoryDashboardPage'))
const ItemsPage = lazy(() => import('./pages/ItemsPage'))
const ItemDetailPage = lazy(() => import('./pages/ItemDetailPage'))
const LocationsPage = lazy(() => import('./pages/LocationsPage'))
const RequisitionsPage = lazy(() => import('./pages/RequisitionsPage'))
const RequisitionDetailPage = lazy(() => import('./pages/RequisitionDetailPage'))
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage'))
const PurchaseOrderDetailPage = lazy(() => import('./pages/PurchaseOrderDetailPage'))
const GRNsPage = lazy(() => import('./pages/GRNsPage'))
const GRNDetailPage = lazy(() => import('./pages/GRNDetailPage'))
const InternalRequisitionsPage = lazy(() => import('./pages/InternalRequisitionsPage'))
const StandingOrdersPage = lazy(() => import('./pages/StandingOrdersPage'))
const TransferRequestsPage = lazy(() => import('./pages/TransferRequestsPage'))
const ControlledSubstancesPage = lazy(() => import('./pages/ControlledSubstancesPage'))
const ControlledRegisterDetailPage = lazy(() => import('./pages/ControlledRegisterDetailPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))

const INVENTORY_BREADCRUMB = { label: 'Inventory', path: '/inventory' }

export const inventoryRoutes = [
  {
    path: '/inventory',
    component: InventoryDashboardPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Inventory Dashboard | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB],
  },
  {
    path: '/inventory/items',
    component: ItemsPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Inventory Items | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'Items', path: '/inventory/items' }],
  },
  {
    path: '/inventory/items/:id',
    component: ItemDetailPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Inventory Item | Hospital Management System',
    breadcrumbs: [
      INVENTORY_BREADCRUMB,
      { label: 'Items', path: '/inventory/items' },
      { label: 'Item', path: '/inventory/items/:id' },
    ],
  },
  {
    path: '/inventory/locations',
    component: LocationsPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Inventory Locations | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'Locations', path: '/inventory/locations' }],
  },
  {
    path: '/inventory/requisitions',
    component: RequisitionsPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Inventory Requisitions | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'Requisitions', path: '/inventory/requisitions' }],
  },
  {
    path: '/inventory/requisitions/:id',
    component: RequisitionDetailPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Requisition Details | Hospital Management System',
    breadcrumbs: [
      INVENTORY_BREADCRUMB,
      { label: 'Requisitions', path: '/inventory/requisitions' },
      { label: 'Requisition', path: '/inventory/requisitions/:id' },
    ],
  },
  {
    path: '/inventory/purchase-orders',
    component: PurchaseOrdersPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Purchase Orders | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'Purchase Orders', path: '/inventory/purchase-orders' }],
  },
  {
    path: '/inventory/purchase-orders/:id',
    component: PurchaseOrderDetailPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Purchase Order Details | Hospital Management System',
    breadcrumbs: [
      INVENTORY_BREADCRUMB,
      { label: 'Purchase Orders', path: '/inventory/purchase-orders' },
      { label: 'Purchase Order', path: '/inventory/purchase-orders/:id' },
    ],
  },
  {
    path: '/inventory/grns',
    component: GRNsPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Goods Received Notes | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'GRNs', path: '/inventory/grns' }],
  },
  {
    path: '/inventory/grns/:id',
    component: GRNDetailPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'GRN Details | Hospital Management System',
    breadcrumbs: [
      INVENTORY_BREADCRUMB,
      { label: 'GRNs', path: '/inventory/grns' },
      { label: 'GRN', path: '/inventory/grns/:id' },
    ],
  },
  {
    path: '/inventory/internal-requisitions',
    component: InternalRequisitionsPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Internal Requisitions | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'Internal Requisitions', path: '/inventory/internal-requisitions' }],
  },
  {
    path: '/inventory/standing-orders',
    component: StandingOrdersPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Standing Orders | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'Standing Orders', path: '/inventory/standing-orders' }],
  },
  {
    path: '/inventory/transfers',
    component: TransferRequestsPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Transfer Requests | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'Transfers', path: '/inventory/transfers' }],
  },
  {
    path: '/inventory/controlled',
    component: ControlledSubstancesPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Controlled Substances | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'Controlled Substances', path: '/inventory/controlled' }],
  },
  {
    path: '/inventory/controlled/:id',
    component: ControlledRegisterDetailPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Controlled Register | Hospital Management System',
    breadcrumbs: [
      INVENTORY_BREADCRUMB,
      { label: 'Controlled Substances', path: '/inventory/controlled' },
      { label: 'Register', path: '/inventory/controlled/:id' },
    ],
  },
  {
    path: '/inventory/analytics',
    component: AnalyticsPage,
    roles: ROLE_GROUPS.INVENTORY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Inventory Analytics | Hospital Management System',
    breadcrumbs: [INVENTORY_BREADCRUMB, { label: 'Analytics', path: '/inventory/analytics' }],
  },
]
