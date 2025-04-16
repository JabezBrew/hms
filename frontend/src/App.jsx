import { useState, useEffect } from 'react'
import './App.css'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './components/theme-provider'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { Layout } from './components/layout/layout'
import { Toaster } from './components/ui/sonner'
import { Skeleton } from './components/ui/skeleton'
import { LoginForm } from './components/auth/login-form'
import { RegisterForm } from './components/auth/register-form'
import { ResetPasswordForm } from './components/auth/reset-password-form'
import PatientDashboard from './components/patients/PatientDashboard'
import PatientDetailPage from './pages/PatientDetailPage'
import PatientEditPage from './pages/PatientEditPage'
import PatientCreatePage from './pages/PatientCreatePage'

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
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={
        <Layout>
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
            <h1 className="text-3xl font-bold">Hospital Management System</h1>
            <p className="text-muted-foreground">Welcome to the HMS Dashboard</p>
          </div>
        </Layout>
      } />
      <Route path="/patients" element={
        <Layout>
          <PatientDashboard />
        </Layout>
      } />
      <Route path="/patients/create" element={
        <Layout>
          <PatientCreatePage />
        </Layout>
      } />
      <Route path="/patients/:id" element={
        <Layout>
          <PatientDetailPage />
        </Layout>
      } />
      <Route path="/patients/:id/edit" element={
        <Layout>
          <PatientEditPage />
        </Layout>
      } />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppContent />
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
