import { lazy, Suspense } from 'react'
import { useAuth } from '@/lib/auth'
import { Layout } from '@/components/layout/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardModuleGates } from '@/features/dashboards/hooks'
import { dashboardFeaturesForRole } from '@/features/dashboards/utils/moduleGates'

// Lazy load dashboard components
const DoctorDashboard = lazy(() => import('./DoctorDashboard'))
const NurseDashboard = lazy(() => import('./NurseDashboard'))
const ReceptionistDashboard = lazy(() => import('./ReceptionistDashboard'))
const AdminDashboard = lazy(() => import('./AdminDashboard'))
const InpatientDoctorDashboard = lazy(() => import('./InpatientDoctorDashboard'))
const BillingDashboardPage = lazy(() => import('../../billing/pages/BillingDashboardPage'))
const LabDashboardPage = lazy(() => import('../../laboratory/pages/LabDashboardPage'))
const PharmacyDispensingPage = lazy(() => import('../../pharmacy/pages/PharmacyDispensingPage'))

// Loading fallback for dashboards
function DashboardLoader() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  )
}

// Role to dashboard mapping
const ROLE_DASHBOARD_MAP = {
  // Admin gets full system overview
  admin: { component: AdminDashboard, hasLayout: false },
  
  // Clinical providers
  doctor: { component: DoctorDashboard, hasLayout: true },
  physician: { component: DoctorDashboard, hasLayout: true },
  practitioner: { component: DoctorDashboard, hasLayout: true },
  inpatient_doctor: { component: InpatientDoctorDashboard, hasLayout: false },
  
  // Nursing staff
  nurse: { component: NurseDashboard, hasLayout: false },
  head_nurse: { component: NurseDashboard, hasLayout: false },
  nurse_practitioner: { component: NurseDashboard, hasLayout: false },
  
  // Front desk
  receptionist: { component: ReceptionistDashboard, hasLayout: false },
  
  // Support staff
  billing: { component: BillingDashboardPage, hasLayout: true },
  lab_technician: { component: LabDashboardPage, hasLayout: true },
  pharmacist: { component: PharmacyDispensingPage, hasLayout: true },
}

// Default dashboard for unknown roles
function DefaultDashboard({
  title = 'Welcome to HMS',
  description = 'Your dashboard is being configured.',
}) {
  const { user } = useAuth()
  
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-y-4">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground">
          Hello, {user?.full_name || user?.email}! {description}
        </p>
        <p className="text-sm text-muted-foreground">
          Role: {user?.role || 'Unknown'}
        </p>
      </div>
    </Layout>
  )
}

export default function RoleDashboard() {
  const { user } = useAuth()
  const dashboardConfig = user?.role ? ROLE_DASHBOARD_MAP[user.role] : null
  const requiredFeatures = dashboardFeaturesForRole(user?.role)
  const moduleGate = useDashboardModuleGates({ enabled: Boolean(dashboardConfig) })
  
  if (!user?.role) {
    return <DefaultDashboard />
  }
  
  if (!dashboardConfig) {
    return <DefaultDashboard />
  }

  if (requiredFeatures.length > 0 && moduleGate.isResolving) {
    return (
      <Layout>
        <DashboardLoader />
      </Layout>
    )
  }

  if (requiredFeatures.length > 0 && !moduleGate.canUse(requiredFeatures)) {
    return (
      <DefaultDashboard
        title="Dashboard unavailable"
        description="The module for your default dashboard is not enabled for this deployment."
      />
    )
  }
  
  const { component: DashboardComponent, hasLayout } = dashboardConfig
  
  // Some dashboards have their own layout, others need the Layout wrapper
  if (hasLayout) {
    return (
      <Layout>
        <Suspense fallback={<DashboardLoader />}>
          <DashboardComponent />
        </Suspense>
      </Layout>
    )
  }
  
  return (
    <Suspense fallback={<DashboardLoader />}>
      <DashboardComponent />
    </Suspense>
  )
}
