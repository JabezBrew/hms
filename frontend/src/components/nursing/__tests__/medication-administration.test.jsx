/**
 * MedicationAdministration component tests.
 *
 * Tests for:
 * - MAR display and filtering
 * - Medication status badges
 * - Due/overdue medication highlighting
 * - Administration dialog
 * - Status selection and submission
 * - Error handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MedicationAdministration } from '../MedicationAdministration'

// Mock the nursing queries hooks
vi.mock('@/features/nursing/hooks', () => ({
  usePatientMAR: vi.fn(),
  useReadyForAdmin: vi.fn(),
  useAdministerMedication: vi.fn(),
  useMedicationsDueNow: vi.fn(),
  useOverdueMedications: vi.fn(),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import {
  usePatientMAR,
  useReadyForAdmin,
  useAdministerMedication,
} from '@/features/nursing/hooks'
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

// Mock patient data
const mockPatient = {
  id: 'patient-123',
  name: 'John Doe',
  medical_record_number: 'MRN123456',
}

// Mock medication data factory
function createMockMedication(overrides = {}) {
  return {
    id: 'med-' + Math.random().toString(36).slice(2),
    medication_name: 'Amoxicillin',
    dosage: '500mg',
    route: 'oral',
    frequency: 'tid',
    scheduled_time: new Date().toISOString(),
    status: 'scheduled',
    is_dispensed: true,
    administered_time: null,
    administration_notes: null,
    reason_not_given: null,
    administered_by_details: null,
    prescribed_by_details: {
      user: { full_name: 'Dr. Smith' },
    },
    ...overrides,
  }
}

// Helper to render component with providers
function renderMedicationAdministration(props = {}) {
  const queryClient = createTestQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <MedicationAdministration patient={mockPatient} {...props} />
    </QueryClientProvider>
  )
}

describe('MedicationAdministration', () => {
  const mockMutateAsync = vi.fn()
  const mockRefetch = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    usePatientMAR.mockReturnValue({
      data: { medications: [] },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    })

    useReadyForAdmin.mockReturnValue({
      data: [],
      isLoading: false,
    })

    useAdministerMedication.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    })

    mockMutateAsync.mockResolvedValue({})
  })

  // =============================================================================
  // Rendering Tests
  // =============================================================================

  describe('Rendering', () => {
    it('shows patient selection prompt when no patient provided', () => {
      const queryClient = createTestQueryClient()

      render(
        <QueryClientProvider client={queryClient}>
          <MedicationAdministration patient={null} />
        </QueryClientProvider>
      )

      expect(screen.getByText('Select a patient to view medications')).toBeInTheDocument()
    })

    it('renders search input', () => {
      renderMedicationAdministration()

      expect(screen.getByPlaceholderText('Search medications...')).toBeInTheDocument()
    })

    it('renders date filter', () => {
      renderMedicationAdministration()

      expect(screen.getByLabelText('Date')).toBeInTheDocument()
    })

    it('renders tabs for Due, Scheduled, and Completed', () => {
      renderMedicationAdministration()

      expect(screen.getByRole('tab', { name: /Due/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /Scheduled/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /Completed/i })).toBeInTheDocument()
    })

    it('renders refresh button', () => {
      renderMedicationAdministration()

      expect(
        screen.getByRole('button', { name: /Refresh medication administration record/i })
      ).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Loading State Tests
  // =============================================================================

  describe('Loading state', () => {
    it('shows loading skeleton when loading', () => {
      usePatientMAR.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      // Should show skeleton, not content
      expect(screen.queryByText('No medications due')).not.toBeInTheDocument()
    })
  })

  // =============================================================================
  // Error State Tests
  // =============================================================================

  describe('Error state', () => {
    it('shows error message when loading fails', () => {
      usePatientMAR.mockReturnValue({
        data: null,
        isLoading: false,
        error: { message: 'Failed to load' },
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      expect(screen.getByText('Error Loading Medications')).toBeInTheDocument()
      expect(screen.getByText('Failed to load')).toBeInTheDocument()
    })

    it('shows try again button on error', () => {
      usePatientMAR.mockReturnValue({
        data: null,
        isLoading: false,
        error: { message: 'Network error' },
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument()
    })

    it('refetches when clicking Try Again', async () => {
      const user = userEvent.setup()

      usePatientMAR.mockReturnValue({
        data: null,
        isLoading: false,
        error: { message: 'Network error' },
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('button', { name: /Try Again/i }))

      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  // =============================================================================
  // Empty State Tests
  // =============================================================================

  describe('Empty states', () => {
    it('shows empty message when no medications due', () => {
      usePatientMAR.mockReturnValue({
        data: { medications: [] },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      expect(screen.getByText('No medications due')).toBeInTheDocument()
    })

    it('shows empty message in scheduled tab', async () => {
      const user = userEvent.setup()

      usePatientMAR.mockReturnValue({
        data: { medications: [] },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Scheduled/i }))

      expect(screen.getByText('No scheduled medications for this date')).toBeInTheDocument()
    })

    it('shows empty message in completed tab', async () => {
      const user = userEvent.setup()

      usePatientMAR.mockReturnValue({
        data: { medications: [] },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Completed/i }))

      expect(screen.getByText('No completed administrations for this date')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Medication List Tests
  // =============================================================================

  describe('Medication list', () => {
    it('displays medications in scheduled tab', async () => {
      const user = userEvent.setup()
      const medications = [
        createMockMedication({ medication_name: 'Amoxicillin' }),
        createMockMedication({ medication_name: 'Ibuprofen' }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Scheduled/i }))

      // Use getAllByText since medication names may appear multiple times
      expect(screen.getAllByText('Amoxicillin').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Ibuprofen').length).toBeGreaterThanOrEqual(1)
    })

    it('displays medication dosage and route', async () => {
      const user = userEvent.setup()
      const medications = [
        createMockMedication({
          medication_name: 'Metformin',
          dosage: '500mg',
          route: 'oral',
        }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Scheduled/i }))

      expect(screen.getByText('500mg')).toBeInTheDocument()
      expect(screen.getByText('oral')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Status Badge Tests
  // =============================================================================

  describe('Status badges', () => {
    it('shows Administered badge for administered medications', async () => {
      const user = userEvent.setup()
      const medications = [
        createMockMedication({ status: 'administered' }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Completed/i }))

      // "Administered" appears as both table header and status badge
      const administeredElements = screen.getAllByText('Administered')
      expect(administeredElements.length).toBeGreaterThanOrEqual(1)
    })

    it('shows Missed badge for missed medications', async () => {
      const user = userEvent.setup()
      const medications = [
        createMockMedication({ status: 'missed' }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Completed/i }))

      expect(screen.getByText('Missed')).toBeInTheDocument()
    })

    it('shows Refused badge for refused medications', async () => {
      const user = userEvent.setup()
      const medications = [
        createMockMedication({ status: 'refused' }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Completed/i }))

      expect(screen.getByText('Refused')).toBeInTheDocument()
    })

    it('shows Held badge for held medications', async () => {
      const user = userEvent.setup()
      const medications = [
        createMockMedication({ status: 'held' }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Completed/i }))

      expect(screen.getByText('Held')).toBeInTheDocument()
    })

    it('shows Awaiting Dispensing badge for undispensed medications', async () => {
      const user = userEvent.setup()
      const medications = [
        createMockMedication({ status: 'scheduled', is_dispensed: false }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Scheduled/i }))

      expect(screen.getByText('Awaiting Dispensing')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Search Filter Tests
  // =============================================================================

  describe('Search filter', () => {
    it('filters medications by name', async () => {
      const user = userEvent.setup()
      const medications = [
        createMockMedication({ medication_name: 'Amoxicillin' }),
        createMockMedication({ medication_name: 'Ibuprofen' }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Scheduled/i }))

      const searchInput = screen.getByPlaceholderText('Search medications...')
      await user.type(searchInput, 'Amox')

      // Medication name may appear multiple times in UI
      expect(screen.getAllByText('Amoxicillin').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByText('Ibuprofen')).not.toBeInTheDocument()
    })

    it('filters medications by dosage', async () => {
      const user = userEvent.setup()
      const medications = [
        createMockMedication({ medication_name: 'Med A', dosage: '500mg' }),
        createMockMedication({ medication_name: 'Med B', dosage: '250mg' }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      await user.click(screen.getByRole('tab', { name: /Scheduled/i }))

      const searchInput = screen.getByPlaceholderText('Search medications...')
      await user.type(searchInput, '500')

      // Medication name may appear multiple times in UI
      expect(screen.getAllByText('Med A').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByText('Med B')).not.toBeInTheDocument()
    })
  })

  // =============================================================================
  // Administration Dialog Tests
  // =============================================================================

  describe('Administration dialog', () => {
    it('opens dialog when clicking Administer button', async () => {
      const user = userEvent.setup()
      const now = new Date()
      const medications = [
        createMockMedication({
          status: 'scheduled',
          is_dispensed: true,
          scheduled_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(), // 30 min ago
        }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      // Click the Administer button
      const adminButton = screen.getAllByRole('button', { name: /Administer/i })[0]
      await user.click(adminButton)

      await waitFor(() => {
        expect(screen.getByText('Record Medication Administration')).toBeInTheDocument()
      })
    })

    it('shows medication details in dialog', async () => {
      const user = userEvent.setup()
      const now = new Date()
      const medications = [
        createMockMedication({
          medication_name: 'Lisinopril',
          dosage: '10mg',
          route: 'oral',
          frequency: 'daily',
          status: 'scheduled',
          is_dispensed: true,
          scheduled_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      const adminButton = screen.getAllByRole('button', { name: /Administer/i })[0]
      await user.click(adminButton)

      await waitFor(() => {
        // Medication name may appear multiple times (in list and dialog)
        expect(screen.getAllByText(/Lisinopril/).length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText(/10mg/).length).toBeGreaterThanOrEqual(1)
      })
    })

    it('shows status selection dropdown', async () => {
      const user = userEvent.setup()
      const now = new Date()
      const medications = [
        createMockMedication({
          status: 'scheduled',
          is_dispensed: true,
          scheduled_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      const adminButton = screen.getAllByRole('button', { name: /Administer/i })[0]
      await user.click(adminButton)

      await waitFor(() => {
        expect(screen.getByText('Administration Status')).toBeInTheDocument()
      })
    })

    it('closes dialog when clicking Cancel', async () => {
      const user = userEvent.setup()
      const now = new Date()
      const medications = [
        createMockMedication({
          status: 'scheduled',
          is_dispensed: true,
          scheduled_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      const adminButton = screen.getAllByRole('button', { name: /Administer/i })[0]
      await user.click(adminButton)

      await waitFor(() => {
        expect(screen.getByText('Record Medication Administration')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Cancel/i }))

      await waitFor(() => {
        expect(screen.queryByText('Record Medication Administration')).not.toBeInTheDocument()
      })
    })
  })

  // =============================================================================
  // Administration Submission Tests
  // =============================================================================

  describe('Administration submission', () => {
    it('submits administration with administered status', async () => {
      const user = userEvent.setup()
      const now = new Date()
      const medication = createMockMedication({
        id: 'med-123',
        status: 'scheduled',
        is_dispensed: true,
        scheduled_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      })

      usePatientMAR.mockReturnValue({
        data: { medications: [medication] },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      const adminButton = screen.getAllByRole('button', { name: /Administer/i })[0]
      await user.click(adminButton)

      await waitFor(() => {
        expect(screen.getByText('Record Medication Administration')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Record Administration/i }))

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          medicationId: 'med-123',
          data: expect.objectContaining({
            status: 'administered',
          }),
        })
      })
    })

    it('shows success toast on successful administration', async () => {
      const user = userEvent.setup()
      const now = new Date()
      const medication = createMockMedication({
        status: 'scheduled',
        is_dispensed: true,
        scheduled_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      })

      usePatientMAR.mockReturnValue({
        data: { medications: [medication] },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      const adminButton = screen.getAllByRole('button', { name: /Administer/i })[0]
      await user.click(adminButton)

      await waitFor(() => {
        expect(screen.getByText('Record Medication Administration')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Record Administration/i }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Medication administered successfully')
      })
    })

    it('refetches MAR after successful administration', async () => {
      const user = userEvent.setup()
      const now = new Date()
      const medication = createMockMedication({
        status: 'scheduled',
        is_dispensed: true,
        scheduled_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      })

      usePatientMAR.mockReturnValue({
        data: { medications: [medication] },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      const adminButton = screen.getAllByRole('button', { name: /Administer/i })[0]
      await user.click(adminButton)

      await waitFor(() => {
        expect(screen.getByText('Record Medication Administration')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Record Administration/i }))

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })

    it('shows error toast on administration failure', async () => {
      mockMutateAsync.mockRejectedValue(new Error('Server error'))

      const user = userEvent.setup()
      const now = new Date()
      const medication = createMockMedication({
        status: 'scheduled',
        is_dispensed: true,
        scheduled_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      })

      usePatientMAR.mockReturnValue({
        data: { medications: [medication] },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      const adminButton = screen.getAllByRole('button', { name: /Administer/i })[0]
      await user.click(adminButton)

      await waitFor(() => {
        expect(screen.getByText('Record Medication Administration')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Record Administration/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Server error')
      })
    })
  })

  // =============================================================================
  // Due Now Alert Tests
  // =============================================================================

  describe('Due now alert', () => {
    it('shows due now alert when medications are overdue', () => {
      const pastTime = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
      const medications = [
        createMockMedication({
          status: 'scheduled',
          is_dispensed: true,
          scheduled_time: pastTime,
        }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      expect(screen.getByText(/Medication.*Due Now/)).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Tab Count Tests
  // =============================================================================

  describe('Tab counts', () => {
    it('shows correct count in Due tab', () => {
      const pastTime = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const medications = [
        createMockMedication({ status: 'scheduled', is_dispensed: true, scheduled_time: pastTime }),
        createMockMedication({ status: 'scheduled', is_dispensed: true, scheduled_time: pastTime }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      expect(screen.getByRole('tab', { name: /Due \(2\)/i })).toBeInTheDocument()
    })

    it('shows correct count in Scheduled tab', () => {
      const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour from now
      const medications = [
        createMockMedication({ status: 'scheduled', is_dispensed: true, scheduled_time: futureTime }),
        createMockMedication({ status: 'scheduled', is_dispensed: true, scheduled_time: futureTime }),
        createMockMedication({ status: 'scheduled', is_dispensed: true, scheduled_time: futureTime }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      expect(screen.getByRole('tab', { name: /Scheduled \(3\)/i })).toBeInTheDocument()
    })

    it('shows correct count in Completed tab', () => {
      const medications = [
        createMockMedication({ status: 'administered' }),
        createMockMedication({ status: 'missed' }),
      ]

      usePatientMAR.mockReturnValue({
        data: { medications },
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      })

      renderMedicationAdministration()

      expect(screen.getByRole('tab', { name: /Completed \(2\)/i })).toBeInTheDocument()
    })
  })
})
