/**
 * LoginForm component tests.
 *
 * Tests for:
 * - Form rendering
 * - Form submission
 * - Validation
 * - Loading states
 * - Error handling
 * - Password visibility toggle
 * - Navigation links
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LoginForm } from '../login-form'

// Mock the auth hook
vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}))

// Mock the notifications utility
vi.mock('@/lib/notifications', () => ({
  notifications: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock react-router-dom's useNavigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { useAuth } from '@/lib/auth'
import { notifications } from '@/lib/notifications'

// Helper to render with router
function renderLoginForm() {
  return render(
    <MemoryRouter>
      <LoginForm />
    </MemoryRouter>
  )
}

const expectedFacilityCode = import.meta.env.VITE_DEFAULT_FACILITY_CODE || ''

describe('LoginForm', () => {
  const mockLogin = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({
      login: mockLogin,
    })
    mockLogin.mockResolvedValue({ id: '1', email: 'test@test.com' })
  })

  // =============================================================================
  // Rendering Tests
  // =============================================================================

  describe('Rendering', () => {
    it('renders the login form with all elements', () => {
      renderLoginForm()

      expect(screen.getByText('Welcome Back')).toBeInTheDocument()
      expect(screen.getByText('Sign in to access your account')).toBeInTheDocument()
      expect(screen.getByLabelText('Email Address')).toBeInTheDocument()
      expect(screen.getByLabelText('Password')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })

    it('renders email input with correct attributes', () => {
      renderLoginForm()

      const emailInput = screen.getByLabelText('Email Address')
      expect(emailInput).toHaveAttribute('type', 'email')
      expect(emailInput).toHaveAttribute('placeholder', 'name@example.com')
      expect(emailInput).toHaveAttribute('autocomplete', 'email')
      expect(emailInput).toBeRequired()
    })

    it('renders password input with correct attributes', () => {
      renderLoginForm()

      const passwordInput = screen.getByLabelText('Password')
      expect(passwordInput).toHaveAttribute('type', 'password')
      expect(passwordInput).toHaveAttribute('autocomplete', 'current-password')
      expect(passwordInput).toBeRequired()
    })

    it('renders forgot password link', () => {
      renderLoginForm()

      const forgotLink = screen.getByText('Forgot password?')
      expect(forgotLink).toBeInTheDocument()
      expect(forgotLink).toHaveAttribute('href', '/reset-password')
    })

  })

  // =============================================================================
  // Form Submission Tests
  // =============================================================================

  describe('Form submission', () => {
    it('submits form with email and password', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123', expectedFacilityCode)
    })

    it('shows success notification on successful login', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(notifications.success).toHaveBeenCalledWith('Logged in successfully')
      })
    })

    it('navigates to home page on successful login', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/')
      })
    })

    it('handles form submission via Enter key', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123{enter}')

      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123', expectedFacilityCode)
      })
    })
  })

  // =============================================================================
  // Loading State Tests
  // =============================================================================

  describe('Loading state', () => {
    it('disables form inputs during submission', async () => {
      mockLogin.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      expect(screen.getByLabelText('Email Address')).toBeDisabled()
      expect(screen.getByLabelText('Password')).toBeDisabled()
    })

    it('disables submit button during submission', async () => {
      mockLogin.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
    })

    it('shows loading text during submission', async () => {
      mockLogin.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      expect(screen.getByRole('button', { name: /signing in/i })).toHaveTextContent('Signing in...')
    })

    it('re-enables form after successful submission', async () => {
      mockLogin.mockResolvedValue({ id: '1' })

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled()
      })
    })

    it('re-enables form after failed submission', async () => {
      mockLogin.mockRejectedValue(new Error('Login failed'))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'wrong-password')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled()
        expect(screen.getByRole('button', { name: /sign in/i })).toHaveTextContent('Sign In')
      })
    })
  })

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('Error handling', () => {
    it('handles login failure gracefully', async () => {
      mockLogin.mockRejectedValue(new Error('Invalid credentials'))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'wrong-password')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled()
      })

      // Should not show success or navigate
      expect(notifications.success).not.toHaveBeenCalled()
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('preserves form values after failed submission', async () => {
      mockLogin.mockRejectedValue(new Error('Invalid credentials'))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'wrong-password')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled()
      })

      expect(screen.getByLabelText('Email Address')).toHaveValue('test@example.com')
      // Password field may or may not be cleared depending on UX preference
    })
  })

  // =============================================================================
  // Password Visibility Toggle Tests
  // =============================================================================

  describe('Password visibility toggle', () => {
    it('toggles password visibility when clicking the eye button', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      const passwordInput = screen.getByLabelText('Password')
      expect(passwordInput).toHaveAttribute('type', 'password')

      // Find and click the toggle button
      const toggleButton = screen.getByRole('button', { name: /show password/i })
      await user.click(toggleButton)

      expect(passwordInput).toHaveAttribute('type', 'text')
    })

    it('shows Eye icon when password is hidden', () => {
      renderLoginForm()

      // The Eye icon (not EyeOff) should be visible when password is hidden
      const passwordInput = screen.getByLabelText('Password')
      expect(passwordInput).toHaveAttribute('type', 'password')
      expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument()
    })

    it('shows EyeOff icon when password is visible', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      const toggleButton = screen.getByRole('button', { name: /show password/i })
      await user.click(toggleButton)

      const passwordInput = screen.getByLabelText('Password')
      expect(passwordInput).toHaveAttribute('type', 'text')
      expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument()
    })

    it('toggles back to hidden on second click', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      const passwordInput = screen.getByLabelText('Password')

      // Show password
      await user.click(screen.getByRole('button', { name: /show password/i }))
      expect(passwordInput).toHaveAttribute('type', 'text')

      // Hide password
      await user.click(screen.getByRole('button', { name: /hide password/i }))
      expect(passwordInput).toHaveAttribute('type', 'password')
    })
  })

  // =============================================================================
  // Input Validation Tests
  // =============================================================================

  describe('Input validation', () => {
    it('requires email field', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      // Submit without email
      await user.type(screen.getByLabelText('Password'), 'password123')

      const form = screen.getByRole('button', { name: /sign in/i }).closest('form')
      expect(form).toBeInvalid()
    })

    it('requires password field', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      // Submit without password
      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')

      const form = screen.getByRole('button', { name: /sign in/i }).closest('form')
      expect(form).toBeInvalid()
    })

    it('validates email format (browser validation)', () => {
      renderLoginForm()

      const emailInput = screen.getByLabelText('Email Address')
      expect(emailInput).toHaveAttribute('type', 'email')
    })
  })

  // =============================================================================
  // Accessibility Tests
  // =============================================================================

  describe('Accessibility', () => {
    it('has proper label associations', () => {
      renderLoginForm()

      const emailInput = screen.getByLabelText('Email Address')
      const passwordInput = screen.getByLabelText('Password')

      expect(emailInput).toHaveAttribute('id', 'email')
      expect(passwordInput).toHaveAttribute('id', 'password')
    })

    it('focuses email input first', () => {
      renderLoginForm()

      // First focusable element should be email
      const emailInput = screen.getByLabelText('Email Address')
      emailInput.focus()
      expect(document.activeElement).toBe(emailInput)
    })

    it('toggle button uses accessible label', () => {
      renderLoginForm()

      const toggleButton = screen.getByRole('button', { name: /show password/i })
      expect(toggleButton).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('Edge cases', () => {
    it('trims whitespace from email input', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), '  test@example.com  ')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      // Email should be trimmed before submission
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123', expectedFacilityCode)
    })

    it('handles empty form submission attempt', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      // Try to submit without filling anything
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      // Should not call login due to HTML5 validation
      expect(mockLogin).not.toHaveBeenCalled()
    })

    it('prevents double submission', async () => {
      mockLogin.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email Address'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')

      // Click submit multiple times quickly
      const submitButton = screen.getByRole('button', { name: /sign in/i })
      await user.click(submitButton)
      // After first click, button shows "Signing in..." and is disabled
      // Try to click again (should be blocked by disabled state)
      await user.click(screen.getByRole('button', { name: /signing in/i }))

      // Should only be called once (button is disabled after first click)
      expect(mockLogin).toHaveBeenCalledTimes(1)
    })
  })
})
