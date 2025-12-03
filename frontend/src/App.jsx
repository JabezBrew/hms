import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './components/theme-provider'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { ViewModeProvider } from './contexts/ViewModeContext'
import { WorkflowProvider } from './contexts/WorkflowContext'
import { ReadOnlyModeProvider } from './contexts/ReadOnlyModeContext'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from './lib/react-query'
import { Layout } from './components/layout/layout'
import { Toaster } from './components/ui/sonner'
import { BreadcrumbProvider } from './components/layout/PageBreadcrumb'
import { Skeleton } from './components/ui/skeleton'
import { LoginForm } from './components/auth/login-form'
import { RegisterForm } from './components/auth/register-form'
import { ResetPasswordForm } from './components/auth/reset-password-form'
import { ResetPasswordConfirmForm } from './components/auth/reset-password-confirm-form'
import { RoleBasedRoute } from './components/auth/RoleBasedRoute'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OfflineIndicator } from './components/OfflineIndicator'
import { SessionTimeoutWarning } from './components/SessionTimeoutWarning'
import { CriticalAlertsMonitor } from './components/dashboard'
import { PWAPrompt } from './components/pwa'
import { ReadOnlyBanner } from './components/readonly'

// Lazy load page components for code splitting
const PatientDetailPage = lazy(() => import('./pages/PatientDetailPage'))
const PatientEditPage = lazy(() => import('./pages/PatientEditPage'))
const PatientCreatePage = lazy(() => import('./pages/PatientCreatePage'))
const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage'))
const AppointmentDetailPage = lazy(() => import('./pages/AppointmentDetailPage'))
const AppointmentCreatePage = lazy(() => import('./pages/AppointmentCreatePage'))
const AppointmentEditPage = lazy(() => import('./pages/AppointmentEditPage'))
const StaffListPage = lazy(() => import('./pages/StaffListPage'))
const StaffCreatePage = lazy(() => import('./pages/StaffCreatePage'))
const StaffDetailPage = lazy(() => import('./pages/StaffDetailPage'))
const UnauthorizedPage = lazy(() => import('./pages/UnauthorizedPage'))
const PractitionerAvailabilityPage = lazy(() => import('./pages/PractitionerAvailabilityPage'))
const PractitionerAvailabilityDetailPage = lazy(() => import('./pages/PractitionerAvailabilityDetailPage'))
const ScheduleSlotsPage = lazy(() => import('./pages/ScheduleSlotsPage'))
const WardsPage = lazy(() => import('./pages/wards/WardsPage'))
const WardDetailPage = lazy(() => import('./pages/wards/WardDetailPage'))
const NewWardPage = lazy(() => import('./pages/wards/NewWardPage'))
const EditWardPage = lazy(() => import('./pages/wards/EditWardPage'))
const WardReportsPage = lazy(() => import('./pages/wards/WardReportsPage'))
const AdmissionCreatePage = lazy(() => import('./pages/admissions/AdmissionCreatePage'))
const AdmissionDetailPage = lazy(() => import('./pages/admissions/AdmissionDetailPage'))
const EncountersPage = lazy(() => import('./pages/encounters/EncountersPage'))
const EncounterCreatePage = lazy(() => import('./pages/encounters/EncounterCreatePage'))
const EncounterDetailPage = lazy(() => import('./pages/encounters/EncounterDetailPage'))
const EncounterEditPage = lazy(() => import('./pages/encounters/EncounterEditPage'))
const CreateClinicalNotePage = lazy(() => import('./pages/clinical-notes/CreateClinicalNotePage'))
const TemplateListPage = lazy(() => import('./pages/clinical-notes/TemplateListPage'))
const NursingDashboardPage = lazy(() => import('./pages/nursing/NursingDashboardPage'))
const TreatmentSheetPage = lazy(() => import('./pages/nursing/TreatmentSheetPage'))
const SupplyQueuePage = lazy(() => import('./pages/pharmacy/SupplyQueuePage'))
const DoctorDashboard = lazy(() => import('./pages/dashboards/DoctorDashboard'))
const ProviderDashboard = lazy(() => import('./pages/dashboards/ProviderDashboard'))
const NurseDashboard = lazy(() => import('./pages/dashboards/NurseDashboard'))
const InpatientDoctorDashboard = lazy(() => import('./pages/dashboards/InpatientDoctorDashboard'))
const ReceptionistDashboard = lazy(() => import('./pages/dashboards/ReceptionistDashboard'))
const AdminDashboard = lazy(() => import('./pages/dashboards/AdminDashboard'))
const EncounterWorkspace = lazy(() => import('./pages/encounters/EncounterWorkspace'))
const ConsultationWorkflow = lazy(() => import('./workflows/consultation/ConsultationWorkflow').then(m => ({ default: m.ConsultationWorkflow })))
const WardRoundWorkflowPage = lazy(() => import('./pages/workflows/ward-round/WardRoundWorkflowPage'))
const AdmissionWorkflowPage = lazy(() => import('./pages/workflows/admission/AdmissionWorkflowPage'))
const DischargeWorkflowPage = lazy(() => import('./pages/workflows/discharge/DischargeWorkflowPage'))

// Chronicle Design System Pages
const PatientChronicleListPage = lazy(() => import('./pages/patients/PatientChronicleListPage'))
const PatientChroniclePage = lazy(() => import('./pages/patients/PatientChroniclePage'))

// Admin Pages
const AuditLogsPage = lazy(() => import('./pages/admin/AuditLogsPage'))

// Referral Pages
const ReferralInbox = lazy(() => import('./components/referrals/ReferralInbox'))
const ReferralSent = lazy(() => import('./components/referrals/ReferralSent'))

// Pharmacy Pages
const PharmacyDispensingPage = lazy(() => import('./pages/pharmacy/PharmacyDispensingPage'))

// Laboratory Pages
const LabCatalogPage = lazy(() => import('./pages/laboratory/LabCatalogPage'))
const LabDashboardPage = lazy(() => import('./pages/laboratory/LabDashboardPage'))
const LabOrdersPage = lazy(() => import('./pages/laboratory/LabOrdersPage'))
const LabResultsPage = lazy(() => import('./pages/laboratory/LabResultsPage'))
const LabCollectionWorklistPage = lazy(() => import('./pages/laboratory/LabCollectionWorklistPage'))

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="space-y-4">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  </div>
)

// Main app content with routes
function AppContent() {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col">
        {/* Skeleton for header */}
        <header className="border-b">
          <div className="flex h-16 items-center px-4">
            <Skeleton className="h-8 w-40" />
            <div className="ml-auto flex items-center space-x-4">
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        </header>

        {/* Skeleton for main content */}
        <div className="flex flex-1">
          {/* Skeleton for sidebar */}
          <aside className="hidden w-64 border-r bg-muted/40 lg:block">
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-36" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-38" />
            </div>
          </aside>

          {/* Skeleton for main content area */}
          <main className="flex-1 p-8">
            <div className="space-y-6">
              <Skeleton className="h-10 w-1/4" />
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Skeleton className="h-40 w-full rounded-lg" />
                <Skeleton className="h-40 w-full rounded-lg" />
                <Skeleton className="h-40 w-full rounded-lg" />
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={
          <div className="flex min-h-screen items-center justify-center">
            <LoginForm />
          </div>
        } />
        <Route path="/register" element={
          <div className="flex min-h-screen items-center justify-center">
            <RegisterForm />
          </div>
        } />
        <Route path="/reset-password" element={
          <div className="flex min-h-screen items-center justify-center">
            <ResetPasswordForm />
          </div>
        } />
        <Route path="/reset-password/confirm" element={
          <div className="flex min-h-screen items-center justify-center">
            <ResetPasswordConfirmForm />
          </div>
        } />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    )
  }

  return (
    <ErrorBoundary>
      <ReadOnlyModeProvider>
        <ReadOnlyBanner />
        <Suspense fallback={<PageLoader />}>
          <Routes>
          {/* Dashboard - accessible to all authenticated users */}
          <Route path="/" element={
            <Layout>
              <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <h1 className="text-3xl font-bold">Hospital Management System</h1>
                <p className="text-muted-foreground">Welcome to the HMS Dashboard</p>
              </div>
            </Layout>
          } />

          {/* Unauthorized page */}
          <Route path="/unauthorized" element={
            <Layout>
              <UnauthorizedPage />
            </Layout>
          } />

          {/* Patient routes - Chronicle Design System */}
          <Route path="/patients" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'billing']}>
              <Layout>
                <PatientChronicleListPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/patients/create" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <PatientCreatePage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/patients/:id" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'billing', 'patient']}>
              <Layout>
                <PatientChroniclePage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/patients/:id/edit" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse']}>
              <Layout>
                <PatientEditPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Appointment routes */}
          <Route path="/appointments" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <AppointmentsPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/appointments/create" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <AppointmentCreatePage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/appointments/:id" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <AppointmentDetailPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/appointments/:id/edit" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <AppointmentEditPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Staff routes */}
          <Route path="/staff" element={
            <RoleBasedRoute allowedRoles={['admin']}>
              <Layout>
                <StaffListPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/staff/create" element={
            <RoleBasedRoute allowedRoles={['admin']}>
              <Layout>
                <StaffCreatePage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/staff/:id" element={
            <RoleBasedRoute allowedRoles={['admin']}>
              <Layout>
                <StaffDetailPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Practitioner Availability routes */}
          <Route path="/practitioner-availability" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'physician', 'practitioner']}>
              <Layout>
                <PractitionerAvailabilityPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/practitioner-availability/:id" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'physician', 'practitioner']}>
              <Layout>
                <PractitionerAvailabilityDetailPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Schedule Slots route */}
          <Route path="/schedules/:id/slots" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <ScheduleSlotsPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Ward management routes */}
          <Route path="/wards" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse']}>
              <Layout>
                <WardsPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/wards/new" element={
            <RoleBasedRoute allowedRoles={['admin']}>
              <Layout>
                <NewWardPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/wards/reports" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse']}>
              <Layout>
                <WardReportsPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/wards/:wardId/edit" element={
            <RoleBasedRoute allowedRoles={['admin']}>
              <Layout>
                <EditWardPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/wards/:wardId" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse']}>
              <Layout>
                <WardDetailPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Admission routes */}
          <Route path="/admissions/new" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <AdmissionCreatePage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/admissions/:admissionId" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <AdmissionDetailPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Encounter routes */}
          <Route path="/encounters" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <EncountersPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/encounters/new" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <EncounterCreatePage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/encounters/:id" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'receptionist']}>
              <Layout>
                <EncounterDetailPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/encounters/:id/edit" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse']}>
              <Layout>
                <EncounterEditPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/encounters/:id/clinical-notes" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse']}>
              <Layout>
                <CreateClinicalNotePage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Clinical Notes Template Management */}
          <Route path="/clinical-notes/templates" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse']}>
              <Layout>
                <TemplateListPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Referral routes */}
          <Route path="/referrals/inbox" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse']}>
              <Layout>
                <ReferralInbox />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/referrals/sent" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse']}>
              <Layout>
                <ReferralSent />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Nursing routes */}
          <Route path="/nursing/dashboard" element={
            <RoleBasedRoute allowedRoles={['admin', 'nurse', 'head_nurse', 'nurse_practitioner']}>
              <NursingDashboardPage />
            </RoleBasedRoute>
          } />

          <Route path="/nursing/treatment-sheet" element={
            <RoleBasedRoute allowedRoles={['admin', 'nurse', 'doctor', 'head_nurse', 'nurse_practitioner']}>
              <Layout>
                <TreatmentSheetPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Pharmacy routes */}
          <Route path="/pharmacy/dispensing" element={
            <RoleBasedRoute allowedRoles={['admin', 'pharmacist', 'pharmacy_tech']}>
              <Layout>
                <PharmacyDispensingPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/pharmacy/supply-queue" element={
            <RoleBasedRoute allowedRoles={['admin', 'pharmacist', 'pharmacy_tech']}>
              <Layout>
                <SupplyQueuePage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Laboratory routes */}
          <Route path="/laboratory/catalog" element={
            <RoleBasedRoute allowedRoles={['admin', 'lab_technician', 'doctor']}>
              <Layout>
                <LabCatalogPage />
              </Layout>
            </RoleBasedRoute>
          } />
          <Route path="/laboratory/dashboard" element={
            <RoleBasedRoute allowedRoles={['admin', 'lab_technician']}>
              <Layout>
                <LabDashboardPage />
              </Layout>
            </RoleBasedRoute>
          } />
          <Route path="/laboratory/orders" element={
            <RoleBasedRoute allowedRoles={['admin', 'lab_technician', 'doctor', 'nurse', 'physician', 'practitioner']}>
              <Layout>
                <LabOrdersPage />
              </Layout>
            </RoleBasedRoute>
          } />
          <Route path="/laboratory/results" element={
            <RoleBasedRoute allowedRoles={['admin', 'lab_technician', 'doctor', 'physician', 'practitioner']}>
              <Layout>
                <LabResultsPage />
              </Layout>
            </RoleBasedRoute>
          } />
          <Route path="/laboratory/collection" element={
            <RoleBasedRoute allowedRoles={['admin', 'lab_technician', 'nurse', 'head_nurse', 'nurse_practitioner']}>
              <Layout>
                <LabCollectionWorklistPage />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Role-Based Dashboards */}
          <Route path="/dashboards/nurse" element={
            <RoleBasedRoute allowedRoles={['admin', 'nurse', 'head_nurse', 'nurse_practitioner']}>
              <NurseDashboard />
            </RoleBasedRoute>
          } />

          <Route path="/dashboards/inpatient" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'physician', 'practitioner']}>
              <InpatientDoctorDashboard />
            </RoleBasedRoute>
          } />

          <Route path="/dashboards/reception" element={
            <RoleBasedRoute allowedRoles={['admin', 'receptionist']}>
              <ReceptionistDashboard />
            </RoleBasedRoute>
          } />

          <Route path="/dashboards/admin" element={
            <RoleBasedRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </RoleBasedRoute>
          } />

          {/* Doctor Dashboard */}
          <Route path="/dashboard/doctor" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'physician', 'practitioner']}>
              <Layout>
                <DoctorDashboard />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Workflow routes */}
          <Route path="/workflows/consultation" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'physician', 'practitioner']}>
              <Layout>
                <ConsultationWorkflow />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="/workflows/ward-round" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'physician', 'practitioner']}>
              <WardRoundWorkflowPage />
            </RoleBasedRoute>
          } />

          <Route path="/workflows/admission" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'physician', 'practitioner']}>
              <AdmissionWorkflowPage />
            </RoleBasedRoute>
          } />

          <Route path="/workflows/discharge" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'physician', 'practitioner']}>
              <DischargeWorkflowPage />
            </RoleBasedRoute>
          } />

          {/* Provider Dashboard */}
          <Route path="/dashboard/provider" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'practitioner', 'physician']}>
              <Layout>
                <ProviderDashboard />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Encounter Workspace */}
          <Route path="/encounters/:id/workspace" element={
            <RoleBasedRoute allowedRoles={['admin', 'doctor', 'nurse', 'practitioner', 'physician']}>
              {/* Note: Workspace has its own layout/header, so we might not want the main Layout here,
               but for now keeping it consistent or we can remove Layout if it duplicates the header.
               The design says "Sticky context", implying full screen.
               Let's try without Layout for full immersion or with Layout if sidebar is needed.
               Design guide implies a "Command Center" feel.
               I'll use Layout for sidebar navigation but the workspace itself handles the header.
           */}
              <Layout>
                <EncounterWorkspace />
              </Layout>
            </RoleBasedRoute>
          } />

          {/* Admin routes */}
          <Route path="/admin/audit-logs" element={
            <RoleBasedRoute allowedRoles={['admin']}>
              <Layout>
                <AuditLogsPage />
              </Layout>
            </RoleBasedRoute>
          } />

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
        {/* Mount critical alerts monitor only for authenticated users */}
        <CriticalAlertsMonitor />
      </ReadOnlyModeProvider>
    </ErrorBoundary>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <HelmetProvider>
          <AuthProvider>
            <BrowserRouter>
              <BreadcrumbProvider>
                <ViewModeProvider>
                  <WorkflowProvider>
                    <AppContent />
                    <Toaster />
                    <OfflineIndicator />
                    <SessionTimeoutWarning />
                    <PWAPrompt />
                  </WorkflowProvider>
                </ViewModeProvider>
              </BreadcrumbProvider>
            </BrowserRouter>
          </AuthProvider>
        </HelmetProvider>
      </ThemeProvider>
      {/* Add React Query Devtools - only in development */}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}

export default App
