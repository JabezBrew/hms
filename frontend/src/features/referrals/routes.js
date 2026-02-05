import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'

const ReferralInbox = lazy(() => import('./pages/ReferralInbox'))
const ReferralSent = lazy(() => import('./pages/ReferralSent'))

const REFERRAL_BREADCRUMB = { label: 'Referrals', path: '/referrals/inbox' }

export const referralRoutes = [
  {
    path: '/referrals/inbox',
    component: ReferralInbox,
    roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Referral Inbox | Hospital Management System',
    breadcrumbs: [REFERRAL_BREADCRUMB, { label: 'Inbox', path: '/referrals/inbox' }],
  },
  {
    path: '/referrals/sent',
    component: ReferralSent,
    roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Sent Referrals | Hospital Management System',
    breadcrumbs: [REFERRAL_BREADCRUMB, { label: 'Sent', path: '/referrals/sent' }],
  },
]
