import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS } from '@/shared/constants/roles'

const PharmacyDispensingPage = lazy(() => import('./pages/PharmacyDispensingPage'))
const SupplyQueuePage = lazy(() => import('./pages/SupplyQueuePage'))

const PHARMACY_BREADCRUMB = { label: 'Pharmacy', path: '/pharmacy/dispensing' }

export const pharmacyRoutes = [
  {
    path: '/pharmacy/dispensing',
    component: PharmacyDispensingPage,
    roles: ROLE_GROUPS.PHARMACY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Pharmacy Dispensing | Hospital Management System',
    breadcrumbs: [PHARMACY_BREADCRUMB, { label: 'Dispensing', path: '/pharmacy/dispensing' }],
  },
  {
    path: '/pharmacy/supply-queue',
    component: SupplyQueuePage,
    roles: ROLE_GROUPS.PHARMACY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Supply Queue | Hospital Management System',
    breadcrumbs: [PHARMACY_BREADCRUMB, { label: 'Supply Queue', path: '/pharmacy/supply-queue' }],
  },
]
