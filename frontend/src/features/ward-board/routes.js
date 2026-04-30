import { lazy } from 'react';
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes';
import { combineRoles, ROLE_GROUPS, ROLES } from '@/shared/constants/roles';

const WardBoardPage = lazy(() => import('./pages/WardBoardPage'));

const WARD_BOARD_ROLES = combineRoles([ROLES.ADMIN], ROLE_GROUPS.CLINICAL);
const WARD_BOARD_FEATURES = ['wards', 'inpatient_admissions', 'nursing_workflows', 'discharge_workflows'];

export const wardBoardRoutes = [
  {
    path: '/ward-board',
    component: WardBoardPage,
    roles: WARD_BOARD_ROLES,
    features: WARD_BOARD_FEATURES,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Ward Clinical Task Board | Hospital Management System',
    breadcrumbs: [{ label: 'Ward Board', path: '/ward-board' }],
  },
  {
    path: '/wards/:wardId/board',
    component: WardBoardPage,
    roles: WARD_BOARD_ROLES,
    features: WARD_BOARD_FEATURES,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Ward Clinical Task Board | Hospital Management System',
    breadcrumbs: [
      { label: 'Wards', path: '/wards' },
      { label: 'Board', path: '/wards/:wardId/board' },
    ],
  },
];
