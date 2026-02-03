/**
 * VitalSignsForm component tests.
 *
 * Tests for:
 * - Form rendering with all vital sign fields
 * - Input validation (ranges, required fields)
 * - Blood pressure pair validation
 * - Form submission
 * - Success handling and form reset
 * - Error handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VitalSignsForm } from '../VitalSignsForm'

// Mock the nursing queries hook
vi.mock('@/features/nursing/hooks', () => ({
  useCreateVitalSigns: vi.fn(),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { useCreateVitalSigns } from '@/features/nursing/hooks'
import { toast } from 'sonner'

// Helper to create test query client
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

// Helper to render component with providers
function renderVitalSignsForm(props = {}) {
  const queryClient = createTestQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <VitalSignsForm
        patientId="patient-123"
        recordedBy="nurse-456"
        {...props}
      />
    </QueryClientProvider>
  )
}

describe('VitalSignsForm', () => {
  const mockMutateAsync = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useCreateVitalSigns.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    })
    mockMutateAsync.mockResolvedValue({ id: 'vitals-1' })
  })

  // =============================================================================
  // Rendering Tests
  // =============================================================================

  describe('Rendering', () => {
    it('renders the form with title and description', () => {
      renderVitalSignsForm()

      // Use getAllByText since "Record Vital Signs" appears as both title and button
      expect(screen.getAllByText('Record Vital Signs').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Enter patient vital signs measurements')).toBeInTheDocument()
    })

    it('renders all vital sign input fields', () => {
      renderVitalSignsForm()

      expect(screen.getByLabelText(/Temperature/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Heart Rate/)).toBeInTheDocument()
      expect(screen.getByLabelText(/BP Systolic/)).toBeInTheDocument()
      expect(screen.getByLabelText(/BP Diastolic/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Respiratory Rate/)).toBeInTheDocument()
      expect(screen.getByLabelText(/SpO2/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Pain Level/)).toBeInTheDocument()
      expect(screen.getByLabelText(/Notes/)).toBeInTheDocument()
    })

    it('renders submit button', () => {
      renderVitalSignsForm()

      expect(screen.getByRole('button', { name: /Record Vital Signs/i })).toBeInTheDocument()
    })

    it('renders input fields with correct types', () => {
      renderVitalSignsForm()

      expect(screen.getByLabelText(/Temperature/)).toHaveAttribute('type', 'number')
      expect(screen.getByLabelText(/Heart Rate/)).toHaveAttribute('type', 'number')
      expect(screen.getByLabelText(/Pain Level/)).toHaveAttribute('type', 'number')
    })

    it('renders input fields with correct min/max ranges', () => {
      renderVitalSignsForm()

      const tempInput = screen.getByLabelText(/Temperature/)
      expect(tempInput).toHaveAttribute('min', '35')
      expect(tempInput).toHaveAttribute('max', '45')

      const hrInput = screen.getByLabelText(/Heart Rate/)
      expect(hrInput).toHaveAttribute('min', '30')
      expect(hrInput).toHaveAttribute('max', '250')

      const painInput = screen.getByLabelText(/Pain Level/)
      expect(painInput).toHaveAttribute('min', '0')
      expect(painInput).toHaveAttribute('max', '10')
    })
  })

  // =============================================================================
  // Input Handling Tests
  // =============================================================================

  describe('Input handling', () => {
    it('updates form state when typing in temperature', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      const tempInput = screen.getByLabelText(/Temperature/)
      await user.type(tempInput, '37.5')

      expect(tempInput).toHaveValue(37.5)
    })

    it('updates form state when typing in heart rate', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      const hrInput = screen.getByLabelText(/Heart Rate/)
      await user.type(hrInput, '72')

      expect(hrInput).toHaveValue(72)
    })

    it('updates notes textarea', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      const notesInput = screen.getByLabelText(/Notes/)
      await user.type(notesInput, 'Patient appears stable')

      expect(notesInput).toHaveValue('Patient appears stable')
    })

    it('allows decimal values for temperature', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      const tempInput = screen.getByLabelText(/Temperature/)
      await user.clear(tempInput)
      await user.type(tempInput, '36.8')

      expect(tempInput).toHaveValue(36.8)
    })
  })

  // =============================================================================
  // Validation Tests
  // =============================================================================

  describe('Validation', () => {
    it('shows error when submitting without any vital signs', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      expect(toast.error).toHaveBeenCalledWith('Validation Error', {
        description: 'Please record at least one vital sign.',
      })
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('shows error when only systolic BP is entered', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/BP Systolic/), '120')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      expect(toast.error).toHaveBeenCalledWith('Validation Error', {
        description: 'Please enter both systolic and diastolic blood pressure values.',
      })
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('shows error when only diastolic BP is entered', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/BP Diastolic/), '80')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      // Form requires at least one complete vital sign (diastolic alone is incomplete)
      expect(toast.error).toHaveBeenCalledWith('Validation Error', {
        description: 'Please record at least one vital sign.',
      })
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('allows submission when both BP values are entered', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/BP Systolic/), '120')
      await user.type(screen.getByLabelText(/BP Diastolic/), '80')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      expect(mockMutateAsync).toHaveBeenCalled()
    })
  })

  // =============================================================================
  // Submission Tests
  // =============================================================================

  describe('Form submission', () => {
    it('submits form with temperature only', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/Temperature/), '37.2')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          patient: 'patient-123',
          recorded_by: 'nurse-456',
          temperature: '37.2',
        })
      )
    })

    it('submits form with all vital signs', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/Temperature/), '36.8')
      await user.type(screen.getByLabelText(/Heart Rate/), '72')
      await user.type(screen.getByLabelText(/BP Systolic/), '120')
      await user.type(screen.getByLabelText(/BP Diastolic/), '80')
      await user.type(screen.getByLabelText(/Respiratory Rate/), '16')
      await user.type(screen.getByLabelText(/SpO2/), '98')
      await user.type(screen.getByLabelText(/Pain Level/), '2')
      await user.type(screen.getByLabelText(/Notes/), 'Patient stable')

      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          patient: 'patient-123',
          recorded_by: 'nurse-456',
          temperature: '36.8',
          heart_rate: '72',
          blood_pressure_systolic: '120',
          blood_pressure_diastolic: '80',
          respiratory_rate: '16',
          oxygen_saturation: '98',
          pain_level: '2',
          notes: 'Patient stable',
        })
      )
    })

    it('includes recorded_at timestamp in submission', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/Temperature/), '37')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          recorded_at: expect.any(String),
        })
      )
    })

    it('excludes empty fields from submission', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/Temperature/), '37')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      const submittedData = mockMutateAsync.mock.calls[0][0]
      expect(submittedData).not.toHaveProperty('heart_rate')
      expect(submittedData).not.toHaveProperty('blood_pressure_systolic')
    })
  })

  // =============================================================================
  // Success Handling Tests
  // =============================================================================

  describe('Success handling', () => {
    it('shows success toast on successful submission', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/Temperature/), '37')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Success', {
          description: 'Vital signs recorded successfully.',
        })
      })
    })

    it('resets form after successful submission', async () => {
      const user = userEvent.setup()

      renderVitalSignsForm()

      const tempInput = screen.getByLabelText(/Temperature/)
      const hrInput = screen.getByLabelText(/Heart Rate/)
      const notesInput = screen.getByLabelText(/Notes/)

      await user.type(tempInput, '37')
      await user.type(hrInput, '72')
      await user.type(notesInput, 'Test notes')

      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      await waitFor(() => {
        expect(tempInput).toHaveValue(null)
        expect(hrInput).toHaveValue(null)
        expect(notesInput).toHaveValue('')
      })
    })

    it('calls onSuccess callback after successful submission', async () => {
      const onSuccess = vi.fn()
      const user = userEvent.setup()

      renderVitalSignsForm({ onSuccess })

      await user.type(screen.getByLabelText(/Temperature/), '37')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
      })
    })
  })

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('Error handling', () => {
    it('shows error toast on submission failure', async () => {
      mockMutateAsync.mockRejectedValue({ response: { data: { message: 'Server error' } } })

      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/Temperature/), '37')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Error', {
          description: 'Server error',
        })
      })
    })

    it('shows default error message when no response message', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Network error'))

      const user = userEvent.setup()

      renderVitalSignsForm()

      await user.type(screen.getByLabelText(/Temperature/), '37')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Error', {
          description: 'Failed to record vital signs. Please try again.',
        })
      })
    })

    it('does not reset form after failed submission', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Network error'))

      const user = userEvent.setup()

      renderVitalSignsForm()

      const tempInput = screen.getByLabelText(/Temperature/)
      await user.type(tempInput, '37')
      await user.click(screen.getByRole('button', { name: /Record Vital Signs/i }))

      await waitFor(() => {
        expect(tempInput).toHaveValue(37)
      })
    })
  })

  // =============================================================================
  // Loading State Tests
  // =============================================================================

  describe('Loading state', () => {
    it('disables submit button while submitting', async () => {
      useCreateVitalSigns.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      })

      renderVitalSignsForm()

      const submitButton = screen.getByRole('button', { name: /Recording/i })
      expect(submitButton).toBeDisabled()
    })

    it('shows loading text while submitting', async () => {
      useCreateVitalSigns.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      })

      renderVitalSignsForm()

      expect(screen.getByText('Recording...')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Accessibility Tests
  // =============================================================================

  describe('Accessibility', () => {
    it('has proper label associations', () => {
      renderVitalSignsForm()

      const tempInput = screen.getByLabelText(/Temperature/)
      expect(tempInput).toHaveAttribute('id', 'temperature')

      const hrInput = screen.getByLabelText(/Heart Rate/)
      expect(hrInput).toHaveAttribute('id', 'heart_rate')
    })

    it('has proper placeholders', () => {
      renderVitalSignsForm()

      expect(screen.getByPlaceholderText('36.5')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('72')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('120')).toBeInTheDocument()
    })
  })
})
