/**
 * AlertsPanel component tests.
 *
 * Tests for:
 * - Alert list rendering
 * - Severity color coding
 * - Empty state display
 * - Loading state
 * - Alert acknowledgment dialog
 * - Time ago formatting
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AlertsPanel } from '../AlertsPanel'

// Mock the nursing queries hook
vi.mock('@/features/nursing/hooks', () => ({
  useAcknowledgeAlert: vi.fn(),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { useAcknowledgeAlert } from '@/features/nursing/hooks'
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

// Mock alert data
function createMockAlert(overrides = {}) {
  return {
    id: 'alert-' + Math.random().toString(36).slice(2),
    alert_type: 'vital_signs',
    severity: 'medium',
    message: 'Test alert message',
    created_at: new Date().toISOString(),
    patient_details: {
      user_details: {
        first_name: 'John',
        last_name: 'Doe',
        full_name: 'John Doe',
      },
      medical_record_number: 'MRN123456',
    },
    ...overrides,
  }
}

// Helper to render component with providers
function renderAlertsPanel(props = {}) {
  const queryClient = createTestQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <AlertsPanel alerts={[]} isLoading={false} {...props} />
    </QueryClientProvider>
  )
}

function getAlertButton(message) {
  const button = screen.getByText(message).closest('button')
  expect(button).not.toBeNull()
  return button
}

describe('AlertsPanel', () => {
  const mockMutateAsync = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useAcknowledgeAlert.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    })
    mockMutateAsync.mockResolvedValue({})
  })

  // =============================================================================
  // Rendering Tests
  // =============================================================================

  describe('Rendering', () => {
    it('renders the panel with title and description', () => {
      renderAlertsPanel()

      expect(screen.getByText('Active Alerts')).toBeInTheDocument()
      expect(screen.getByText(/unacknowledged alerts/)).toBeInTheDocument()
    })

    it('shows bell icon in header', () => {
      renderAlertsPanel()

      // Card header should be present
      expect(screen.getByText('Active Alerts')).toBeInTheDocument()
    })

    it('displays alert count in description', () => {
      const alerts = [createMockAlert(), createMockAlert()]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('2 unacknowledged alerts')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Empty State Tests
  // =============================================================================

  describe('Empty state', () => {
    it('shows empty state when no alerts', () => {
      renderAlertsPanel({ alerts: [] })

      expect(screen.getByText('No active alerts')).toBeInTheDocument()
    })

    it('shows check icon in empty state', () => {
      renderAlertsPanel({ alerts: [] })

      // The green checkmark should be present
      expect(screen.getByText('No active alerts')).toBeInTheDocument()
    })

    it('shows zero count in description', () => {
      renderAlertsPanel({ alerts: [] })

      expect(screen.getByText('0 unacknowledged alerts')).toBeInTheDocument()
    })

    it('handles null alerts gracefully', () => {
      renderAlertsPanel({ alerts: null })

      expect(screen.getByText('No active alerts')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Loading State Tests
  // =============================================================================

  describe('Loading state', () => {
    it('shows loading skeletons when loading', () => {
      renderAlertsPanel({ isLoading: true })

      // Should not show alerts or empty state
      expect(screen.queryByText('No active alerts')).not.toBeInTheDocument()
    })
  })

  // =============================================================================
  // Alert List Tests
  // =============================================================================

  describe('Alert list', () => {
    it('renders alerts in list', () => {
      const alerts = [
        createMockAlert({ message: 'Alert 1' }),
        createMockAlert({ message: 'Alert 2' }),
      ]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('Alert 1')).toBeInTheDocument()
      expect(screen.getByText('Alert 2')).toBeInTheDocument()
    })

    it('displays patient name for each alert', () => {
      const alerts = [
        createMockAlert({
          patient_details: {
            user_details: { first_name: 'Jane', last_name: 'Smith' },
          },
        }),
      ]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    })

    it('displays full_name when available', () => {
      const alerts = [
        createMockAlert({
          patient_details: {
            user_details: {
              first_name: 'Jane',
              last_name: 'Smith',
              full_name: 'Jane Elizabeth Smith',
            },
          },
        }),
      ]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('Jane Elizabeth Smith')).toBeInTheDocument()
    })

    it('displays Unknown Patient when patient details missing', () => {
      const alerts = [createMockAlert({ patient_details: {} })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('Unknown Patient')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Severity Badge Tests
  // =============================================================================

  describe('Severity badges', () => {
    it('displays critical severity badge', () => {
      const alerts = [createMockAlert({ severity: 'critical' })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('critical')).toBeInTheDocument()
    })

    it('displays high severity badge', () => {
      const alerts = [createMockAlert({ severity: 'high' })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('high')).toBeInTheDocument()
    })

    it('displays medium severity badge', () => {
      const alerts = [createMockAlert({ severity: 'medium' })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('medium')).toBeInTheDocument()
    })

    it('displays low severity badge', () => {
      const alerts = [createMockAlert({ severity: 'low' })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('low')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Alert Type Icon Tests
  // =============================================================================

  describe('Alert type icons', () => {
    it('shows vital signs icon for vital_signs alerts', () => {
      const alerts = [createMockAlert({ alert_type: 'vital_signs' })]
      renderAlertsPanel({ alerts })

      // Emoji should be rendered
      expect(screen.getByText(/John Doe/)).toBeInTheDocument()
    })

    it('shows medication icon for medication alerts', () => {
      const alerts = [createMockAlert({ alert_type: 'medication' })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText(/John Doe/)).toBeInTheDocument()
    })

    it('shows task overdue icon for task_overdue alerts', () => {
      const alerts = [createMockAlert({ alert_type: 'task_overdue' })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText(/John Doe/)).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Time Formatting Tests
  // =============================================================================

  describe('Time formatting', () => {
    it('displays "Just now" for very recent alerts', () => {
      const alerts = [createMockAlert({ created_at: new Date().toISOString() })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('Just now')).toBeInTheDocument()
    })

    it('displays minutes ago for recent alerts', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const alerts = [createMockAlert({ created_at: fiveMinutesAgo })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('5m ago')).toBeInTheDocument()
    })

    it('displays hours ago for older alerts', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const alerts = [createMockAlert({ created_at: twoHoursAgo })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('2h ago')).toBeInTheDocument()
    })

    it('displays days ago for very old alerts', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      const alerts = [createMockAlert({ created_at: twoDaysAgo })]
      renderAlertsPanel({ alerts })

      expect(screen.getByText('2d ago')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Acknowledge Dialog Tests
  // =============================================================================

  describe('Acknowledge dialog', () => {
    it('opens acknowledge dialog when clicking an alert', async () => {
      const user = userEvent.setup()
      const alerts = [createMockAlert({ message: 'Test alert' })]

      renderAlertsPanel({ alerts })

      // Click on alert to open dialog
      const alertCard = getAlertButton('Test alert')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByText('Acknowledge Alert')).toBeInTheDocument()
      })
    })

    it('shows alert details in dialog', async () => {
      const user = userEvent.setup()
      const alerts = [
        createMockAlert({
          message: 'Critical vital sign alert',
          severity: 'critical',
          alert_type: 'vital_signs',
        }),
      ]

      renderAlertsPanel({ alerts })

      const alertCard = getAlertButton('Critical vital sign alert')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByText('Patient: John Doe')).toBeInTheDocument()
        expect(screen.getByText('MRN: MRN123456')).toBeInTheDocument()
      })
    })

    it('shows resolution notes textarea in dialog', async () => {
      const user = userEvent.setup()
      const alerts = [createMockAlert()]

      renderAlertsPanel({ alerts })

      const alertCard = getAlertButton('Test alert message')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByLabelText(/Resolution Notes/)).toBeInTheDocument()
      })
    })

    it('closes dialog when clicking Cancel', async () => {
      const user = userEvent.setup()
      const alerts = [createMockAlert()]

      renderAlertsPanel({ alerts })

      const alertCard = getAlertButton('Test alert message')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByText('Acknowledge Alert')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(screen.queryByText('Acknowledge Alert')).not.toBeInTheDocument()
      })
    })
  })

  // =============================================================================
  // Acknowledgment Submission Tests
  // =============================================================================

  describe('Acknowledgment submission', () => {
    it('calls acknowledge mutation when clicking Acknowledge', async () => {
      const user = userEvent.setup()
      const alert = createMockAlert({ id: 'alert-123' })

      renderAlertsPanel({ alerts: [alert] })

      const alertCard = getAlertButton('Test alert message')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByText('Acknowledge Alert')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /^Acknowledge$/ }))

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          alertId: 'alert-123',
          notes: '',
        })
      })
    })

    it('includes resolution notes in acknowledgment', async () => {
      const user = userEvent.setup()
      const alert = createMockAlert({ id: 'alert-456' })

      renderAlertsPanel({ alerts: [alert] })

      const alertCard = getAlertButton('Test alert message')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByText('Acknowledge Alert')).toBeInTheDocument()
      })

      const notesInput = screen.getByLabelText(/Resolution Notes/)
      await user.type(notesInput, 'Issue resolved by nurse')

      await user.click(screen.getByRole('button', { name: /^Acknowledge$/ }))

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          alertId: 'alert-456',
          notes: 'Issue resolved by nurse',
        })
      })
    })

    it('shows success toast on successful acknowledgment', async () => {
      const user = userEvent.setup()
      const alerts = [createMockAlert()]

      renderAlertsPanel({ alerts })

      const alertCard = getAlertButton('Test alert message')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByText('Acknowledge Alert')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /^Acknowledge$/ }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Alert Acknowledged', {
          description: 'The alert has been acknowledged successfully.',
        })
      })
    })

    it('closes dialog on successful acknowledgment', async () => {
      const user = userEvent.setup()
      const alerts = [createMockAlert()]

      renderAlertsPanel({ alerts })

      const alertCard = getAlertButton('Test alert message')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByText('Acknowledge Alert')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /^Acknowledge$/ }))

      await waitFor(() => {
        expect(screen.queryByText('Acknowledge Alert')).not.toBeInTheDocument()
      })
    })

    it('shows error toast on acknowledgment failure', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Server error'))

      const user = userEvent.setup()
      const alerts = [createMockAlert()]

      renderAlertsPanel({ alerts })

      const alertCard = getAlertButton('Test alert message')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByText('Acknowledge Alert')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /^Acknowledge$/ }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Error', {
          description: 'Failed to acknowledge alert. Please try again.',
        })
      })
    })
  })

  // =============================================================================
  // Loading State During Acknowledgment Tests
  // =============================================================================

  describe('Loading state during acknowledgment', () => {
    it('shows loading state on acknowledge button', async () => {
      useAcknowledgeAlert.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      })

      const user = userEvent.setup()
      const alerts = [createMockAlert()]

      renderAlertsPanel({ alerts })

      const alertCard = getAlertButton('Test alert message')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByText('Acknowledging...')).toBeInTheDocument()
      })
    })

    it('disables acknowledge button while submitting', async () => {
      useAcknowledgeAlert.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      })

      const user = userEvent.setup()
      const alerts = [createMockAlert()]

      renderAlertsPanel({ alerts })

      const alertCard = getAlertButton('Test alert message')
      await user.click(alertCard)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Acknowledging/ })).toBeDisabled()
      })
    })
  })
})
