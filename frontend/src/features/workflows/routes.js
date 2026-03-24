import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'

const WardRoundWorkflowPage = lazy(() => import('./pages/ward-round/WardRoundWorkflowPage'))
const DischargeWorkflowPage = lazy(() => import('./pages/discharge/DischargeWorkflowPage'))

const WORKFLOW_ROLES = [ROLES.ADMIN, ROLES.DOCTOR, ROLES.PHYSICIAN, ROLES.PRACTITIONER]

export const workflowRoutes = [
  {
    path: '/workflows/ward-round',
    component: WardRoundWorkflowPage,
    roles: WORKFLOW_ROLES,
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Ward Round Workflow | Hospital Management System',
    breadcrumbs: [{ label: 'Ward Round', path: '/workflows/ward-round' }],
  },
  {
    path: '/workflows/discharge',
    component: DischargeWorkflowPage,
    roles: WORKFLOW_ROLES,
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Discharge Workflow | Hospital Management System',
    breadcrumbs: [{ label: 'Discharge', path: '/workflows/discharge' }],
  },
]
