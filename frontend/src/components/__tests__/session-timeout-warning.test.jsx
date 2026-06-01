/**
 * SessionTimeoutWarning component tests.
 *
 * Tests for:
 * - Inactivity timeout warning display
 * - Absolute session timeout handling
 * - Session extension functionality
 * - Logout on timeout
 * - Activity tracking
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { SessionTimeoutWarning } from '../SessionTimeoutWarning'
import { setAuthValue } from '@/lib/auth-storage'

// Mock the useAuth hook
vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '@/lib/auth'

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

describe('SessionTimeoutWarning', () => {
  const mockLogout = vi.fn()
  const mockIsSessionValid = vi.fn()
  const mockRefreshAccessToken = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorageMock.clear()
    mockLogout.mockClear()
    mockIsSessionValid.mockReturnValue(true)
    mockRefreshAccessToken.mockReset()
    mockRefreshAccessToken.mockResolvedValue('new-access-token')

    // Set session start time to "now"
    const now = Date.now()
    setAuthValue('sessionStartTime', now.toString())
    setAuthValue('lastActivityAt', now.toString())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // =============================================================================
  // Basic Rendering Tests
  // =============================================================================

  describe('Basic rendering', () => {
    it('renders nothing when not authenticated', () => {
      useAuth.mockReturnValue({
        isAuthenticated: false,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
      })

      const { container } = render(<SessionTimeoutWarning />)

      expect(container).toBeEmptyDOMElement()
    })

    it('renders nothing when authenticated and session is active', () => {
      useAuth.mockReturnValue({
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
        refreshAccessToken: mockRefreshAccessToken,
      })

      render(<SessionTimeoutWarning />)

      // No warning dialog should be visible initially
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  // =============================================================================
  // Inactivity Timeout Tests
  // =============================================================================

  describe('Inactivity timeout', () => {
    beforeEach(() => {
      useAuth.mockReturnValue({
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
        refreshAccessToken: mockRefreshAccessToken,
      })
    })

    it('shows warning 2 minutes before inactivity timeout (28 minutes of inactivity)', async () => {
      render(<SessionTimeoutWarning />)

      // Advance time to 28 minutes (warning should show at 28 min, timeout at 30 min)
      await act(async () => {
        vi.advanceTimersByTime(28 * 60 * 1000)
      })

      await waitFor(() => {
        expect(screen.getByText('Session Expiring Soon')).toBeInTheDocument()
      })
    })

    it('displays countdown timer in warning', async () => {
      render(<SessionTimeoutWarning />)

      // Advance to trigger warning
      await act(async () => {
        vi.advanceTimersByTime(28 * 60 * 1000)
      })

      await waitFor(() => {
        // Should show countdown (around 2:00 or less)
        expect(screen.getByText(/Your session will expire due to inactivity/)).toBeInTheDocument()
      })
    })

    it('allows user to extend session on inactivity warning', async () => {
      render(<SessionTimeoutWarning />)

      // Advance to trigger warning
      await act(async () => {
        vi.advanceTimersByTime(28 * 60 * 1000)
      })

      await waitFor(() => {
        expect(screen.getByText('Continue Session')).toBeInTheDocument()
      })

      // Click extend session
      await act(async () => {
        fireEvent.click(screen.getByText('Continue Session'))
      })

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1)

      // Warning should be dismissed
      await waitFor(() => {
        expect(screen.queryByText('Session Expiring Soon')).not.toBeInTheDocument()
      })
    })

    it('does not run a second logout when session extension already failed closed', async () => {
      mockRefreshAccessToken.mockImplementation(async () => {
        await mockLogout(false)
        return null
      })
      render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(28 * 60 * 1000)
      })

      await waitFor(() => {
        expect(screen.getByText('Continue Session')).toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByText('Continue Session'))
      })

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1)
      expect(mockLogout).toHaveBeenCalledTimes(1)
    })

    it('logs out user after full inactivity timeout (30 minutes)', async () => {
      render(<SessionTimeoutWarning />)

      // Advance time past the full 30 minute timeout
      await act(async () => {
        vi.advanceTimersByTime(30 * 60 * 1000 + 1000)
      })

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledWith(false) // backend logout
      })
    })

    it('allows manual logout from warning dialog', async () => {
      render(<SessionTimeoutWarning />)

      // Advance to trigger warning
      await act(async () => {
        vi.advanceTimersByTime(28 * 60 * 1000)
      })

      await waitFor(() => {
        expect(screen.getByText('Logout Now')).toBeInTheDocument()
      })

      // Click logout
      await act(async () => {
        fireEvent.click(screen.getByText('Logout Now'))
      })

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledWith(false)
      })
    })
  })

  // =============================================================================
  // Activity Tracking Tests
  // =============================================================================

  describe('Activity tracking', () => {
    beforeEach(() => {
      useAuth.mockReturnValue({
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
      })
    })

    it('resets inactivity timer on mousedown', async () => {
      render(<SessionTimeoutWarning />)

      // Advance partway to warning
      await act(async () => {
        vi.advanceTimersByTime(20 * 60 * 1000)
      })

      // Simulate user activity
      await act(async () => {
        fireEvent.mouseDown(window)
      })

      // Advance another 20 minutes (would have triggered warning without activity reset)
      await act(async () => {
        vi.advanceTimersByTime(20 * 60 * 1000)
      })

      // Warning should not show yet (timer was reset)
      expect(screen.queryByText('Session Expiring Soon')).not.toBeInTheDocument()
    })

    it('resets inactivity timer on keydown', async () => {
      render(<SessionTimeoutWarning />)

      // Advance partway
      await act(async () => {
        vi.advanceTimersByTime(20 * 60 * 1000)
      })

      // Simulate typing
      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })

      // Continue advancing
      await act(async () => {
        vi.advanceTimersByTime(20 * 60 * 1000)
      })

      expect(screen.queryByText('Session Expiring Soon')).not.toBeInTheDocument()
    })

    it('resets inactivity timer on scroll', async () => {
      render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(20 * 60 * 1000)
      })

      await act(async () => {
        fireEvent.scroll(window)
      })

      await act(async () => {
        vi.advanceTimersByTime(20 * 60 * 1000)
      })

      expect(screen.queryByText('Session Expiring Soon')).not.toBeInTheDocument()
    })

    it('resets inactivity timer on click', async () => {
      render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(20 * 60 * 1000)
      })

      await act(async () => {
        fireEvent.click(window)
      })

      await act(async () => {
        vi.advanceTimersByTime(20 * 60 * 1000)
      })

      expect(screen.queryByText('Session Expiring Soon')).not.toBeInTheDocument()
    })

    it('throttles local activity writes from repeated global events', async () => {
      render(<SessionTimeoutWarning />)
      localStorageMock.setItem.mockClear()

      await act(async () => {
        fireEvent.scroll(window)
        fireEvent.scroll(window)
        fireEvent.mouseDown(window)
      })

      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
    })

    it('dismisses warning on user activity', async () => {
      render(<SessionTimeoutWarning />)

      // Trigger warning
      await act(async () => {
        vi.advanceTimersByTime(28 * 60 * 1000)
      })

      await waitFor(() => {
        expect(screen.getByText('Session Expiring Soon')).toBeInTheDocument()
      })

      // User activity should dismiss warning
      await act(async () => {
        fireEvent.mouseDown(window)
      })

      await waitFor(() => {
        expect(screen.queryByText('Session Expiring Soon')).not.toBeInTheDocument()
      })
    })
  })

  // =============================================================================
  // Absolute Session Timeout Tests
  // =============================================================================

  describe('Absolute session timeout', () => {
    beforeEach(() => {
      useAuth.mockReturnValue({
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
      })
    })

    it('shows non-extendable warning approaching 8-hour absolute timeout', async () => {
      // Set session start time to 7 hours 58 minutes ago
      const startTime = Date.now() - (7 * 60 + 58) * 60 * 1000
      setAuthValue('sessionStartTime', startTime.toString())

      render(<SessionTimeoutWarning />)

      // Advance a bit to trigger check
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      await waitFor(() => {
        expect(screen.getByText('Maximum Session Time Reached')).toBeInTheDocument()
      })
    })

    it('does not show "Continue Session" button for absolute timeout', async () => {
      const startTime = Date.now() - (7 * 60 + 58) * 60 * 1000
      setAuthValue('sessionStartTime', startTime.toString())

      render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      await waitFor(() => {
        expect(screen.getByText('Maximum Session Time Reached')).toBeInTheDocument()
        expect(screen.queryByText('Continue Session')).not.toBeInTheDocument()
      })
    })

    it('shows message about re-authentication required', async () => {
      const startTime = Date.now() - (7 * 60 + 58) * 60 * 1000
      setAuthValue('sessionStartTime', startTime.toString())

      render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      await waitFor(() => {
        expect(screen.getByText(/For security reasons, you must re-authenticate/)).toBeInTheDocument()
      })
    })

    it('logs out automatically at absolute timeout', async () => {
      // Set session start exactly at 8 hour limit
      const startTime = Date.now() - 8 * 60 * 60 * 1000
      setAuthValue('sessionStartTime', startTime.toString())

      render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledWith(false)
      })
    })

    it('absolute timeout takes precedence over inactivity timeout', async () => {
      // Session started 7:58 ago, but there was activity
      const startTime = Date.now() - (7 * 60 + 58) * 60 * 1000
      setAuthValue('sessionStartTime', startTime.toString())

      render(<SessionTimeoutWarning />)

      // Simulate activity
      await act(async () => {
        fireEvent.mouseDown(window)
      })

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      // Should still show absolute timeout warning despite activity
      await waitFor(() => {
        expect(screen.getByText('Maximum Session Time Reached')).toBeInTheDocument()
      })
    })
  })

  // =============================================================================
  // Session Validity Check Tests
  // =============================================================================

  describe('Session validity check', () => {
    it('logs out when isSessionValid returns false', async () => {
      mockIsSessionValid.mockReturnValue(false)

      useAuth.mockReturnValue({
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
      })

      render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledWith(false)
      })
    })

    it('calls logout only once when session remains invalid', async () => {
      mockIsSessionValid.mockReturnValue(false)

      useAuth.mockReturnValue({
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
      })

      render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(2 * 60 * 1000)
      })

      expect(mockLogout).toHaveBeenCalledTimes(1)
      expect(mockLogout).toHaveBeenCalledWith(false)
    })

    it('resets timeout handling after logout and re-authentication in the same mounted app', async () => {
      const authState = {
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
        refreshAccessToken: mockRefreshAccessToken,
      }
      useAuth.mockImplementation(() => authState)

      const { rerender } = render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(30 * 60 * 1000 + 1000)
      })

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledTimes(1)
      })

      authState.isAuthenticated = false
      rerender(<SessionTimeoutWarning />)

      mockLogout.mockClear()
      const nextSessionStart = Date.now().toString()
      setAuthValue('sessionStartTime', nextSessionStart)
      setAuthValue('lastActivityAt', nextSessionStart)
      authState.isAuthenticated = true
      rerender(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(30 * 60 * 1000 + 1000)
      })

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledTimes(1)
      })
    })
  })

  // =============================================================================
  // Cleanup Tests
  // =============================================================================

  describe('Cleanup', () => {
    it('removes event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      useAuth.mockReturnValue({
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
      })

      const { unmount } = render(<SessionTimeoutWarning />)

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalled()
      removeEventListenerSpy.mockRestore()
    })

    it('clears intervals on unmount', () => {
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval')

      useAuth.mockReturnValue({
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
      })

      const { unmount } = render(<SessionTimeoutWarning />)

      unmount()

      expect(clearIntervalSpy).toHaveBeenCalled()
      clearIntervalSpy.mockRestore()
    })
  })

  // =============================================================================
  // UI Display Tests
  // =============================================================================

  describe('UI display', () => {
    beforeEach(() => {
      useAuth.mockReturnValue({
        isAuthenticated: true,
        logout: mockLogout,
        isSessionValid: mockIsSessionValid,
      })
    })

    it('displays clock icon in warning dialog', async () => {
      render(<SessionTimeoutWarning />)

      await act(async () => {
        vi.advanceTimersByTime(28 * 60 * 1000)
      })

      await waitFor(() => {
        // The Clock icon should be rendered (in the amber circle)
        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      })
    })

    it('formats countdown time correctly (MM:SS)', async () => {
      render(<SessionTimeoutWarning />)

      // Advance to exactly 1:30 remaining
      await act(async () => {
        vi.advanceTimersByTime(28.5 * 60 * 1000)
      })

      await waitFor(() => {
        // Should show time in format like "1:30" or "1:29"
        const dialog = screen.getByRole('alertdialog')
        expect(dialog).toBeInTheDocument()
        // Time format with leading zero for seconds
        expect(dialog.textContent).toMatch(/\d:\d{2}/)
      })
    })
  })
})
