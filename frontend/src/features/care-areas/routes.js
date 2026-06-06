import { lazy } from 'react';

import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes';
import { combineRoles, ROLE_GROUPS, ROLES } from '@/shared/constants/roles';

const OutpatientCareAreaPage = lazy(() => import('./pages/OutpatientCareAreaPage'));
const InpatientCareAreaPage = lazy(() => import('./pages/InpatientCareAreaPage'));
const EmergencyCareAreaPage = lazy(() => import('./pages/EmergencyCareAreaPage'));

const OUTPATIENT_ROLES = combineRoles([ROLES.ADMIN, ROLES.RECEPTIONIST], ROLE_GROUPS.CLINICAL);
const INPATIENT_ROLES = combineRoles([ROLES.ADMIN], ROLE_GROUPS.CLINICAL);
const EMERGENCY_ROLES = combineRoles([ROLES.ADMIN, ROLES.RECEPTIONIST], ROLE_GROUPS.CLINICAL);

export const careAreaRoutes = [
  {
    path: '/care-areas/outpatient',
    component: OutpatientCareAreaPage,
    roles: OUTPATIENT_ROLES,
    features: ['outpatient_encounters'],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Outpatient | Hospital Management System',
    breadcrumbs: [
      { label: 'Care Areas', path: '/my-work' },
      { label: 'Outpatient', path: '/care-areas/outpatient' },
    ],
  },
  {
    path: '/care-areas/inpatient',
    component: InpatientCareAreaPage,
    roles: INPATIENT_ROLES,
    features: ['ward_task_board', 'patient_chronicle', 'wards', 'inpatient_admissions', 'nursing_workflows'],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Inpatient | Hospital Management System',
    breadcrumbs: [
      { label: 'Care Areas', path: '/my-work' },
      { label: 'Inpatient', path: '/care-areas/inpatient' },
    ],
  },
  {
    path: '/care-areas/emergency',
    component: EmergencyCareAreaPage,
    roles: EMERGENCY_ROLES,
    features: ['emergency_encounters'],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Emergency | Hospital Management System',
    breadcrumbs: [
      { label: 'Care Areas', path: '/my-work' },
      { label: 'Emergency', path: '/care-areas/emergency' },
    ],
  },
];
