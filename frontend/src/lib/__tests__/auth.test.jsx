/**
 * Auth context and useAuth hook tests.
 *
 * Tests for:
 * - AuthProvider state management
 * - Login/logout flow
 * - Token refresh mechanism
 * - Session validation
 * - User state persistence
 * - Error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderHook } from '@testing-library/react'
import { AuthProvider, useAuth } from '../auth'
import { AUTH_STORAGE_KEYS } from '../auth-storage'
import { getStorageKey } from '../safe-storage'

// Mock the auth API
vi.mock('../api/auth', () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    refreshToken: vi.fn(),
    requestPasswordReset: vi.fn(),
  },
}))

// Mock notifications
vi.mock('../notifications', () => ({
  notifications: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock api-client
const mockPerformTokenRefresh = vi.fn()
vi.mock('../api-client', () => ({
  setAuthTokenProvider: vi.fn(),
  setFacilityCodeProvider: vi.fn(),
  performTokenRefresh: () => mockPerformTokenRefresh(),
}))

// Mock react-query
vi.mock('../react-query', () => ({
  queryClient: {
    clear: vi.fn(),
  },
}))

import { authApi } from '../api/auth'
import { notifications } from '../notifications'
import { queryClient } from '../react-query'

// Mock localStorage
const localStorageMock = {
  store: {},
  getItem: vi.fn((key) => localStorageMock.store[key] || null),
  setItem: vi.fn((key, value) => {
    localStorageMock.store[key] = value
  }),
  removeItem: vi.fn((key) => {
    delete localStorageMock.store[key]
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {}
  }),
}

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

const authStorageKey = (key) => getStorageKey(AUTH_STORAGE_KEYS[key].current)
const AUTH_STORAGE = {
  user: authStorageKey('user'),
  sessionStartTime: authStorageKey('sessionStartTime'),
  refreshTokenIssuedAt: authStorageKey('refreshTokenIssuedAt'),
}

// Test component that uses useAuth
function TestConsumer() {
  const auth = useAuth()
  return (
    <div>
      <div data-testid="user">{auth.user ? JSON.stringify(auth.user) : 'null'}</div>
      <div data-testid="loading">{auth.loading.toString()}</div>
      <div data-testid="isAuthenticated">{auth.isAuthenticated.toString()}</div>
      <div data-testid="passwordChangeRequired">{Boolean(auth.passwordChangeRequired).toString()}</div>
      <div data-testid="error">{auth.error || 'null'}</div>
      <button onClick={() => auth.login('test@test.com', 'password123').catch(() => {})}>Login</button>
      <button onClick={() => auth.logout()}>Logout</button>
    </div>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    mockPerformTokenRefresh.mockReset()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // =============================================================================
  // Initial State Tests
  // =============================================================================

  describe('Initial state', () => {
    it('provides initial unauthenticated state', async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      expect(screen.getByTestId('user').textContent).toBe('null')
      expect(screen.getByTestId('isAuthenticated').textContent).toBe('false')
    })

    it('restores user from localStorage on mount', async () => {
      const storedUser = {
        id: 'user-123',
        email: 'stored@test.com',
        role: 'doctor',
      }

      localStorageMock.store[AUTH_STORAGE.user] = JSON.stringify(storedUser)
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = Date.now().toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()

      mockPerformTokenRefresh.mockResolvedValue('new-access-token')

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      expect(screen.getByTestId('isAuthenticated').textContent).toBe('true')
      expect(screen.getByTestId('user').textContent).toContain('stored@test.com')
    })

    it('clears user if stored user data is invalid JSON', async () => {
      localStorageMock.store[AUTH_STORAGE.user] = 'invalid-json'

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(AUTH_STORAGE.user)
      expect(screen.getByTestId('isAuthenticated').textContent).toBe('false')
    })

    it('clears user if session is invalid', async () => {
      const storedUser = {
        id: 'user-123',
        email: 'stored@test.com',
        role: 'doctor',
      }

      // Session started 8+ hours ago (expired)
      localStorageMock.store[AUTH_STORAGE.user] = JSON.stringify(storedUser)
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = (Date.now() - 9 * 60 * 60 * 1000).toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      expect(screen.getByTestId('isAuthenticated').textContent).toBe('false')
      expect(authApi.logout).toHaveBeenCalledTimes(1)
      expect(notifications.success).not.toHaveBeenCalled()
    })

    it('still clears startup-expired session when backend logout fails', async () => {
      const storedUser = {
        id: 'user-123',
        email: 'stored@test.com',
        role: 'doctor',
      }

      localStorageMock.store[AUTH_STORAGE.user] = JSON.stringify(storedUser)
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = (Date.now() - 9 * 60 * 60 * 1000).toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()
      authApi.logout.mockRejectedValueOnce(new Error('Network error'))

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      expect(authApi.logout).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('isAuthenticated').textContent).toBe('false')
    })
  })

  // =============================================================================
  // Login Tests
  // =============================================================================

  describe('Login', () => {
    it('logs in user successfully', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      authApi.login.mockResolvedValue({
        access: 'access-token-123',
        user: {
          id: 'user-123',
          email: 'test@test.com',
          user_type: 'doctor',
        },
      })

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(screen.getByTestId('isAuthenticated').textContent).toBe('true')
      })

      expect(authApi.login).toHaveBeenCalledWith('test@test.com', 'password123', undefined)
      expect(localStorageMock.setItem).toHaveBeenCalledWith(AUTH_STORAGE.sessionStartTime, expect.any(String))
      expect(localStorageMock.setItem).toHaveBeenCalledWith(AUTH_STORAGE.refreshTokenIssuedAt, expect.any(String))
    })

    it('stores user data with role in localStorage', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      authApi.login.mockResolvedValue({
        access: 'access-token-123',
        user: {
          id: 'user-123',
          email: 'doctor@test.com',
          user_type: 'doctor',
        },
      })

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        const storedUser = JSON.parse(localStorageMock.store[AUTH_STORAGE.user])
        expect(storedUser.role).toBe('doctor')
        expect(storedUser.email).toBe('doctor@test.com')
      })
    })

    it('stores first-login password change requirement in auth state', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      authApi.login.mockResolvedValue({
        access: 'access-token-123',
        password_change_required: true,
        user: {
          id: 'user-123',
          email: 'doctor@test.com',
          user_type: 'doctor',
          must_change_password: true,
        },
      })

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(screen.getByTestId('passwordChangeRequired').textContent).toBe('true')
      })

      const storedUser = JSON.parse(localStorageMock.store[AUTH_STORAGE.user])
      expect(storedUser.passwordChangeRequired).toBe(true)
    })

    it('handles login failure', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      authApi.login.mockRejectedValue(new Error('Invalid credentials'))

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(notifications.error).toHaveBeenCalledWith('Invalid credentials')
      })

      expect(screen.getByTestId('isAuthenticated').textContent).toBe('false')
    })

    it('stores access context for off-site access', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      authApi.login.mockResolvedValue({
        access: 'access-token-123',
        user: {
          id: 'user-123',
          email: 'test@test.com',
          user_type: 'doctor',
        },
        access_context: {
          is_offsite: true,
          is_readonly: true,
        },
      })

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        const storedUser = JSON.parse(localStorageMock.store[AUTH_STORAGE.user])
        expect(storedUser.accessContext).toEqual({
          is_offsite: true,
          is_readonly: true,
        })
      })
    })
  })

  // =============================================================================
  // Logout Tests
  // =============================================================================

  describe('Logout', () => {
    it('logs out user successfully', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      // Setup logged in state
      authApi.login.mockResolvedValue({
        access: 'access-token-123',
        user: {
          id: 'user-123',
          email: 'test@test.com',
          user_type: 'doctor',
        },
      })
      authApi.logout.mockResolvedValue({})

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      // Login first
      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(screen.getByTestId('isAuthenticated').textContent).toBe('true')
      })

      // Now logout
      await user.click(screen.getByText('Logout'))

      await waitFor(() => {
        expect(screen.getByTestId('isAuthenticated').textContent).toBe('false')
      })

      expect(authApi.logout).toHaveBeenCalled()
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(AUTH_STORAGE.user)
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(AUTH_STORAGE.sessionStartTime)
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(AUTH_STORAGE.refreshTokenIssuedAt)
      expect(queryClient.clear).toHaveBeenCalled()
      expect(notifications.success).toHaveBeenCalledWith('Logged out successfully')
    })

    it('performs local-only logout when specified', async () => {
      const storedUser = {
        id: 'user-123',
        email: 'test@test.com',
        role: 'doctor',
      }

      localStorageMock.store[AUTH_STORAGE.user] = JSON.stringify(storedUser)
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = Date.now().toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()

      mockPerformTokenRefresh.mockResolvedValue('new-access-token')

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Perform local-only logout
      await act(async () => {
        await result.current.logout(true)
      })

      expect(authApi.logout).not.toHaveBeenCalled()
      expect(result.current.isAuthenticated).toBe(false)
    })

    it('handles logout API error gracefully', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      authApi.login.mockResolvedValue({
        access: 'access-token-123',
        user: {
          id: 'user-123',
          email: 'test@test.com',
          user_type: 'doctor',
        },
      })
      authApi.logout.mockRejectedValue(new Error('Network error'))

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(screen.getByTestId('isAuthenticated').textContent).toBe('true')
      })

      await user.click(screen.getByText('Logout'))

      // Should still logout locally even if API fails
      await waitFor(() => {
        expect(screen.getByTestId('isAuthenticated').textContent).toBe('false')
      })
    })

    it('deduplicates concurrent backend logout requests', async () => {
      const storedUser = {
        id: 'user-123',
        email: 'test@test.com',
        role: 'doctor',
      }

      localStorageMock.store[AUTH_STORAGE.user] = JSON.stringify(storedUser)
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = Date.now().toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()
      mockPerformTokenRefresh.mockResolvedValue('access-token-123')

      authApi.logout.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({}), 50))
      )

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
        expect(result.current.isAuthenticated).toBe(true)
      })

      await act(async () => {
        const p1 = result.current.logout(false)
        const p2 = result.current.logout(false)
        vi.advanceTimersByTime(60)
        await Promise.all([p1, p2])
      })

      expect(authApi.logout).toHaveBeenCalledTimes(1)
      expect(notifications.success).toHaveBeenCalledTimes(1)
      expect(result.current.isAuthenticated).toBe(false)
    })
  })

  // =============================================================================
  // Session Validation Tests
  // =============================================================================

  describe('Session validation', () => {
    it('isSessionValid returns true for fresh session', () => {
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = Date.now().toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      expect(result.current.isSessionValid()).toBe(true)
    })

    it('isSessionValid returns false when refresh token expired (7+ days)', () => {
      // Refresh token issued 8 days ago
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = eightDaysAgo.toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = eightDaysAgo.toString()

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      expect(result.current.isSessionValid()).toBe(false)
    })

    it('isSessionValid returns false when session exceeds 8 hours', () => {
      // Session started 9 hours ago
      const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = nineHoursAgo.toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      expect(result.current.isSessionValid()).toBe(false)
    })

    it('isSessionValid returns false when no session data exists', () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      expect(result.current.isSessionValid()).toBe(false)
    })
  })

  // =============================================================================
  // Token Refresh Tests
  // =============================================================================

  describe('Token refresh', () => {
    it('refreshes token successfully', async () => {
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = Date.now().toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()

      mockPerformTokenRefresh.mockResolvedValue('new-access-token')

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      let newToken
      await act(async () => {
        newToken = await result.current.refreshAccessToken()
      })

      expect(newToken).toBe('new-access-token')
      expect(localStorageMock.setItem).toHaveBeenCalledWith(AUTH_STORAGE.refreshTokenIssuedAt, expect.any(String))
    })

    it('logs out on refresh failure', async () => {
      const storedUser = {
        id: 'user-123',
        email: 'test@test.com',
        role: 'doctor',
      }

      localStorageMock.store[AUTH_STORAGE.user] = JSON.stringify(storedUser)
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = Date.now().toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()

      // First call during mount succeeds, second call (manual refresh) fails
      mockPerformTokenRefresh
        .mockResolvedValueOnce('initial-token')
        .mockResolvedValueOnce(null)

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      let token
      await act(async () => {
        token = await result.current.refreshAccessToken()
      })

      expect(token).toBe(null)
    })

    it('does not refresh if session is invalid', async () => {
      // Session started 9 hours ago (expired)
      localStorageMock.store[AUTH_STORAGE.sessionStartTime] = (Date.now() - 9 * 60 * 60 * 1000).toString()
      localStorageMock.store[AUTH_STORAGE.refreshTokenIssuedAt] = Date.now().toString()

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      let token
      await act(async () => {
        token = await result.current.refreshAccessToken()
      })

      expect(token).toBe(null)
      expect(mockPerformTokenRefresh).not.toHaveBeenCalled()
      expect(notifications.info).toHaveBeenCalledWith('Your session has expired. Please log in again.')
    })
  })

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('Error handling', () => {
    it('throws error when useAuth is used outside AuthProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        renderHook(() => useAuth())
      }).toThrow('useAuth must be used within an AuthProvider')

      consoleSpy.mockRestore()
    })

    it('sets error state on login failure', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      authApi.login.mockRejectedValue(new Error('Network error'))

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Network error')
      })
    })

    it('clears error state on successful login', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      // First login fails
      authApi.login.mockRejectedValueOnce(new Error('First failure'))

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('First failure')
      })

      // Second login succeeds
      authApi.login.mockResolvedValue({
        access: 'access-token-123',
        user: {
          id: 'user-123',
          email: 'test@test.com',
          user_type: 'doctor',
        },
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('null')
        expect(screen.getByTestId('isAuthenticated').textContent).toBe('true')
      })
    })
  })

  // =============================================================================
  // Password Reset Tests
  // =============================================================================

  describe('Password reset', () => {
    it('requests password reset successfully', async () => {
      authApi.requestPasswordReset.mockResolvedValue({})

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      let success
      await act(async () => {
        success = await result.current.resetPassword('user@test.com')
      })

      expect(success).toBe(true)
      expect(authApi.requestPasswordReset).toHaveBeenCalledWith('user@test.com')
    })

    it('handles password reset failure', async () => {
      authApi.requestPasswordReset.mockRejectedValue(new Error('User not found'))

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.resetPassword('unknown@test.com')
        })
      ).rejects.toThrow()

      await waitFor(() => {
        expect(notifications.error).toHaveBeenCalledWith('User not found')
      })
    })
  })
})
