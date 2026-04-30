/**
 * RoleBasedRoute component tests.
 *
 * Tests for:
 * - Authentication redirect to login
 * - Role-based access control
 * - Unauthorized redirect
 * - Multiple allowed roles
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RoleBasedRoute } from '../RoleBasedRoute'

// Mock the useAuth hook
vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '@/lib/auth'

// Helper to create test query client
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

// Helper component to render routes
function renderWithRouter(ui, { initialEntries = ['/protected'] } = {}) {
  const queryClient = createTestQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/protected" element={ui} />
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/unauthorized" element={<div>Unauthorized Page</div>} />
          <Route path="/custom-redirect" element={<div>Custom Redirect Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RoleBasedRoute', () => {
  // =============================================================================
  // Authentication Tests
  // =============================================================================

  describe('Authentication', () => {
    it('redirects to login when not authenticated', () => {
      useAuth.mockReturnValue({
        user: null,
        isAuthenticated: false,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['doctor']}>
          <div>Protected Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Login Page')).toBeInTheDocument()
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    })

    it('renders children when authenticated with no role restriction', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'user@test.com', role: 'doctor' },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={[]}>
          <div>Protected Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Protected Content')).toBeInTheDocument()
    })

    it('renders children when authenticated with no allowedRoles specified', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'user@test.com', role: 'nurse' },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute>
          <div>Protected Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Protected Content')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Role-Based Access Tests
  // =============================================================================

  describe('Role-based access', () => {
    it('renders children when user role matches single allowed role', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'doctor@test.com', role: 'doctor' },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['doctor']}>
          <div>Doctor Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Doctor Content')).toBeInTheDocument()
    })

    it('renders children when user role is in allowed roles array', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'nurse@test.com', role: 'nurse' },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['doctor', 'nurse', 'admin']}>
          <div>Multi-Role Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Multi-Role Content')).toBeInTheDocument()
    })

    it('redirects to unauthorized when role not allowed', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'receptionist@test.com', role: 'receptionist' },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['doctor', 'nurse']}>
          <div>Protected Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument()
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    })

    it('renders children when user has an allowed admin capability', () => {
      useAuth.mockReturnValue({
        user: {
          id: '1',
          email: 'hod@test.com',
          role: 'doctor',
          adminAccess: {
            capabilities: ['admin.roster.manage'],
          },
        },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['admin']} allowedCapabilities={['admin.roster.manage']}>
          <div>Roster Admin Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Roster Admin Content')).toBeInTheDocument()
    })

    it('redirects to unauthorized when neither role nor capability is allowed', () => {
      useAuth.mockReturnValue({
        user: {
          id: '1',
          email: 'doctor@test.com',
          role: 'doctor',
          adminAccess: {
            capabilities: ['admin.staff.view'],
          },
        },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['admin']} allowedCapabilities={['admin.roster.manage']}>
          <div>Roster Admin Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument()
      expect(screen.queryByText('Roster Admin Content')).not.toBeInTheDocument()
    })

    it('supports custom redirect path for unauthorized access', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'patient@test.com', role: 'patient' },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['admin']} redirectTo="/custom-redirect">
          <div>Admin Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Custom Redirect Page')).toBeInTheDocument()
      expect(screen.queryByText('Admin Content')).not.toBeInTheDocument()
    })
  })

  // =============================================================================
  // Role-Specific Tests (All HMS Roles)
  // =============================================================================

  describe('Role-specific access', () => {
    const roles = [
      { role: 'admin', name: 'Admin' },
      { role: 'doctor', name: 'Doctor' },
      { role: 'nurse', name: 'Nurse' },
      { role: 'receptionist', name: 'Receptionist' },
      { role: 'lab_technician', name: 'Lab Technician' },
      { role: 'pharmacist', name: 'Pharmacist' },
      { role: 'patient', name: 'Patient' },
    ]

    roles.forEach(({ role, name }) => {
      it(`allows ${name} to access ${role}-restricted routes`, () => {
        useAuth.mockReturnValue({
          user: { id: '1', email: `${role}@test.com`, role },
          isAuthenticated: true,
        })

        renderWithRouter(
          <RoleBasedRoute allowedRoles={[role]}>
            <div>{name} Content</div>
          </RoleBasedRoute>
        )

        expect(screen.getByText(`${name} Content`)).toBeInTheDocument()
      })

      it(`denies ${name} access to admin-only routes when not admin`, () => {
        if (role === 'admin') return // Skip for admin

        useAuth.mockReturnValue({
          user: { id: '1', email: `${role}@test.com`, role },
          isAuthenticated: true,
        })

        renderWithRouter(
          <RoleBasedRoute allowedRoles={['admin']}>
            <div>Admin Only Content</div>
          </RoleBasedRoute>
        )

        expect(screen.getByText('Unauthorized Page')).toBeInTheDocument()
        expect(screen.queryByText('Admin Only Content')).not.toBeInTheDocument()
      })
    })
  })

  // =============================================================================
  // Common Route Pattern Tests
  // =============================================================================

  describe('Common route patterns', () => {
    it('allows clinical staff to access patient data routes', () => {
      const clinicalRoles = ['doctor', 'nurse']

      clinicalRoles.forEach((role) => {
        useAuth.mockReturnValue({
          user: { id: '1', email: `${role}@test.com`, role },
          isAuthenticated: true,
        })

        const { unmount } = renderWithRouter(
          <RoleBasedRoute allowedRoles={['doctor', 'nurse']}>
            <div>Patient Data Content</div>
          </RoleBasedRoute>
        )

        expect(screen.getByText('Patient Data Content')).toBeInTheDocument()
        unmount()
      })
    })

    it('allows all staff to access dashboard routes', () => {
      const staffRoles = ['admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist']

      staffRoles.forEach((role) => {
        useAuth.mockReturnValue({
          user: { id: '1', email: `${role}@test.com`, role },
          isAuthenticated: true,
        })

        const { unmount } = renderWithRouter(
          <RoleBasedRoute allowedRoles={staffRoles}>
            <div>Dashboard Content</div>
          </RoleBasedRoute>
        )

        expect(screen.getByText('Dashboard Content')).toBeInTheDocument()
        unmount()
      })
    })

    it('restricts admin routes to admin only', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'admin@test.com', role: 'admin' },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['admin']}>
          <div>Admin Panel</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Admin Panel')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('Edge cases', () => {
    it('handles undefined user role gracefully', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'user@test.com' }, // No role
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['doctor']}>
          <div>Protected Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument()
    })

    it('handles null user when isAuthenticated is false', () => {
      useAuth.mockReturnValue({
        user: null,
        isAuthenticated: false,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['doctor']}>
          <div>Protected Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Login Page')).toBeInTheDocument()
    })

    it('handles empty string role', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'user@test.com', role: '' },
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['doctor']}>
          <div>Protected Content</div>
        </RoleBasedRoute>
      )

      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument()
    })

    it('is case-sensitive for role matching', () => {
      useAuth.mockReturnValue({
        user: { id: '1', email: 'doctor@test.com', role: 'Doctor' }, // Capital D
        isAuthenticated: true,
      })

      renderWithRouter(
        <RoleBasedRoute allowedRoles={['doctor']}> {/* lowercase */}
          <div>Protected Content</div>
        </RoleBasedRoute>
      )

      // Should not match due to case sensitivity
      expect(screen.getByText('Unauthorized Page')).toBeInTheDocument()
    })
  })
})
