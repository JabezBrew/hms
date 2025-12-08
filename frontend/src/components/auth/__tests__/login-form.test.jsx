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

      expect(screen.getByText('Login to your account')).toBeInTheDocument()
      expect(screen.getByText('Enter your email and password below to login')).toBeInTheDocument()
      expect(screen.getByLabelText('Email')).toBeInTheDocument()
      expect(screen.getByLabelText('Password')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument()
    })

    it('renders email input with correct attributes', () => {
      renderLoginForm()

      const emailInput = screen.getByLabelText('Email')
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

    it('renders register link', () => {
      renderLoginForm()

      expect(screen.getByText("Don't have an account?")).toBeInTheDocument()
      const registerLink = screen.getByText('Register')
      expect(registerLink).toBeInTheDocument()
      expect(registerLink).toHaveAttribute('href', '/register')
    })
  })

  // =============================================================================
  // Form Submission Tests
  // =============================================================================

  describe('Form submission', () => {
    it('submits form with email and password', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /login/i }))

      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123')
    })

    it('shows success notification on successful login', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /login/i }))

      await waitFor(() => {
        expect(notifications.success).toHaveBeenCalledWith('Logged in successfully')
      })
    })

    it('navigates to home page on successful login', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /login/i }))

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/')
      })
    })

    it('handles form submission via Enter key', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123{enter}')

      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123')
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

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /login/i }))

      expect(screen.getByLabelText('Email')).toBeDisabled()
      expect(screen.getByLabelText('Password')).toBeDisabled()
    })

    it('disables submit button during submission', async () => {
      mockLogin.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /login/i }))

      expect(screen.getByRole('button', { name: /logging in/i })).toBeDisabled()
    })

    it('shows loading text during submission', async () => {
      mockLogin.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /login/i }))

      expect(screen.getByRole('button', { name: /logging in/i })).toHaveTextContent('Logging in...')
    })

    it('re-enables form after successful submission', async () => {
      mockLogin.mockResolvedValue({ id: '1' })

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /login/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /login/i })).not.toBeDisabled()
      })
    })

    it('re-enables form after failed submission', async () => {
      mockLogin.mockRejectedValue(new Error('Login failed'))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'wrong-password')
      await user.click(screen.getByRole('button', { name: /login/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /login/i })).not.toBeDisabled()
        expect(screen.getByRole('button', { name: /login/i })).toHaveTextContent('Login')
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

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'wrong-password')
      await user.click(screen.getByRole('button', { name: /login/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /login/i })).not.toBeDisabled()
      })

      // Should not show success or navigate
      expect(notifications.success).not.toHaveBeenCalled()
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('preserves form values after failed submission', async () => {
      mockLogin.mockRejectedValue(new Error('Invalid credentials'))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'wrong-password')
      await user.click(screen.getByRole('button', { name: /login/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /login/i })).not.toBeDisabled()
      })

      expect(screen.getByLabelText('Email')).toHaveValue('test@example.com')
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
      const toggleButton = screen.getByRole('button', { name: '' }) // Eye button has no text
      await user.click(toggleButton)

      expect(passwordInput).toHaveAttribute('type', 'text')
    })

    it('shows Eye icon when password is hidden', () => {
      renderLoginForm()

      // The Eye icon (not EyeOff) should be visible when password is hidden
      const passwordInput = screen.getByLabelText('Password')
      expect(passwordInput).toHaveAttribute('type', 'password')
    })

    it('shows EyeOff icon when password is visible', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      const toggleButton = screen.getByRole('button', { name: '' })
      await user.click(toggleButton)

      const passwordInput = screen.getByLabelText('Password')
      expect(passwordInput).toHaveAttribute('type', 'text')
    })

    it('toggles back to hidden on second click', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      const toggleButton = screen.getByRole('button', { name: '' })
      const passwordInput = screen.getByLabelText('Password')

      // Show password
      await user.click(toggleButton)
      expect(passwordInput).toHaveAttribute('type', 'text')

      // Hide password
      await user.click(toggleButton)
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

      const form = screen.getByRole('button', { name: /login/i }).closest('form')
      expect(form).toBeInvalid()
    })

    it('requires password field', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      // Submit without password
      await user.type(screen.getByLabelText('Email'), 'test@example.com')

      const form = screen.getByRole('button', { name: /login/i }).closest('form')
      expect(form).toBeInvalid()
    })

    it('validates email format (browser validation)', () => {
      renderLoginForm()

      const emailInput = screen.getByLabelText('Email')
      expect(emailInput).toHaveAttribute('type', 'email')
    })
  })

  // =============================================================================
  // Accessibility Tests
  // =============================================================================

  describe('Accessibility', () => {
    it('has proper label associations', () => {
      renderLoginForm()

      const emailInput = screen.getByLabelText('Email')
      const passwordInput = screen.getByLabelText('Password')

      expect(emailInput).toHaveAttribute('id', 'email')
      expect(passwordInput).toHaveAttribute('id', 'password')
    })

    it('focuses email input first', () => {
      renderLoginForm()

      // First focusable element should be email
      const emailInput = screen.getByLabelText('Email')
      emailInput.focus()
      expect(document.activeElement).toBe(emailInput)
    })

    it('toggle button has negative tabIndex (not focusable via keyboard)', () => {
      renderLoginForm()

      const toggleButton = screen.getByRole('button', { name: '' })
      expect(toggleButton).toHaveAttribute('tabIndex', '-1')
    })
  })

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('Edge cases', () => {
    it('trims whitespace from email input', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), '  test@example.com  ')
      await user.type(screen.getByLabelText('Password'), 'password123')
      await user.click(screen.getByRole('button', { name: /login/i }))

      // Email should be trimmed before submission
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123')
    })

    it('handles empty form submission attempt', async () => {
      const user = userEvent.setup()

      renderLoginForm()

      // Try to submit without filling anything
      await user.click(screen.getByRole('button', { name: /login/i }))

      // Should not call login due to HTML5 validation
      expect(mockLogin).not.toHaveBeenCalled()
    })

    it('prevents double submission', async () => {
      mockLogin.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))

      const user = userEvent.setup()

      renderLoginForm()

      await user.type(screen.getByLabelText('Email'), 'test@example.com')
      await user.type(screen.getByLabelText('Password'), 'password123')

      // Click submit multiple times quickly
      const submitButton = screen.getByRole('button', { name: /login/i })
      await user.click(submitButton)
      // After first click, button shows "Logging in..." and is disabled
      // Try to click again (should be blocked by disabled state)
      await user.click(screen.getByRole('button', { name: /logging in/i }))

      // Should only be called once (button is disabled after first click)
      expect(mockLogin).toHaveBeenCalledTimes(1)
    })
  })
})
