import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import PatientChronicleListPage from '../PatientChronicleListPage'
import { usePatientSearch } from '@/features/patients/hooks/usePatientQueries'
import { prefetchPatientChronicleData } from '@/features/patients/prefetch'

vi.mock('@/features/patients/hooks/usePatientQueries', () => ({
  usePatientSearch: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}))

vi.mock('@/features/wards/hooks/useWardQueries', () => ({
  useWards: () => ({ data: { results: [] }, isLoading: false }),
}))

vi.mock('@/hooks/useOrganization', () => ({
  useClinicalUnits: () => ({ data: { results: [] }, isLoading: false }),
}))

vi.mock('@/hooks/useStaffQueries', () => ({
  useSearchPractitioners: () => ({
    data: [],
    isLoading: false,
    setSearchTerm: vi.fn(),
  }),
}))

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}))

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value) => value,
}))

vi.mock('@/features/patients/prefetch', () => ({
  prefetchMyPatientsRoute: vi.fn(),
  prefetchPatientChronicleData: vi.fn(),
  prefetchPatientDetailRoute: vi.fn(),
  prefetchPatientRegistryRoute: vi.fn(),
}))

const mockUsePatientSearch = vi.mocked(usePatientSearch)

function createSearchResponse(total, rows = []) {
  return {
    total,
    count: total,
    page: 1,
    page_size: 25,
    next: null,
    previous: null,
    results: rows,
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PatientChronicleListPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('PatientChronicleListPage registry scope behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePatientSearch.mockImplementation((params) => {
      const scope = params?.registry_scope || 'all'
      const query = params?.query || ''

      const baseRows = [
        {
          id: 'patient-1',
          created_at: '2026-02-13T10:00:00Z',
          medical_record_number: 'MRN-001',
          name: 'Patient One',
          date_of_birth: '1990-01-01',
          gender: 'male',
          patient_location: 'Clinic A',
          active_clinic_names: ['Clinic A', 'Clinic B', 'Clinic C'],
          registry_status: 'in-progress',
        },
      ]

      if (query) {
        return {
          data: createSearchResponse(4, baseRows),
          isLoading: false,
          refetch: vi.fn(),
        }
      }

      const totals = {
        active: 2,
        discharged: 1,
        deceased: 1,
        all: 4,
      }

      return {
        data: createSearchResponse(totals[scope] ?? 0, baseRows),
        isLoading: false,
        refetch: vi.fn(),
      }
    })
  })

  it('defaults to active scope and sends registry_scope=active', () => {
    renderPage()

    const firstCallParams = mockUsePatientSearch.mock.calls[0][0]
    expect(firstCallParams.registry_scope).toBe('active')
    expect(screen.getByText('Active patients')).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('forces registry_scope=all when search query has at least two characters', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Search by name, MRN, or NHIS ID'), 'jo')

    await waitFor(() => {
      const lastCallParams = mockUsePatientSearch.mock.calls.at(-1)[0]
      expect(lastCallParams.query).toBe('jo')
      expect(lastCallParams.registry_scope).toBe('all')
      expect(screen.getByText('Search results')).toBeInTheDocument()
      expect(screen.getByText('(4)')).toBeInTheDocument()
    })
  })

  it('returns to selected tab scope after clearing search', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Discharged' }))
    await waitFor(() => {
      const afterTabParams = mockUsePatientSearch.mock.calls.at(-1)[0]
      expect(afterTabParams.registry_scope).toBe('discharged')
      expect(screen.getByText('Discharged patients')).toBeInTheDocument()
      expect(screen.getByText('(1)')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText('Search by name, MRN, or NHIS ID'), 'jo')
    await waitFor(() => {
      const duringSearchParams = mockUsePatientSearch.mock.calls.at(-1)[0]
      expect(duringSearchParams.registry_scope).toBe('all')
      expect(screen.getByText('Search results')).toBeInTheDocument()
    })

    await user.click(screen.getByLabelText('Clear search'))

    await waitFor(() => {
      const afterClearParams = mockUsePatientSearch.mock.calls.at(-1)[0]
      expect(afterClearParams.registry_scope).toBe('discharged')
      expect(screen.getByText('Discharged patients')).toBeInTheDocument()
      expect(screen.getByText('(1)')).toBeInTheDocument()
    })
  })

  it('shows Patient Location header and multi-clinic tooltip content', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('button', { name: 'Sort by Patient Location' })).toBeInTheDocument()
    const clinicCellTrigger = screen.getByRole('button', { name: 'Clinic A +2' })
    expect(clinicCellTrigger).toBeInTheDocument()

    await user.hover(clinicCellTrigger)
    expect(await screen.findByRole('tooltip', { name: 'Clinic A, Clinic B, Clinic C' })).toBeInTheDocument()
  })
})

const mockPrefetchPatientChronicleData = vi.mocked(prefetchPatientChronicleData)

describe('PatientChronicleListPage PHI prefetch gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePatientSearch.mockReturnValue({
      data: createSearchResponse(1, [
        {
          id: 'p1',
          created_at: '2026-01-01T00:00:00Z',
          medical_record_number: 'MRN-001',
          name: 'Test Patient',
          date_of_birth: '1990-06-15',
          gender: 'female',
          registry_status: 'active',
        },
      ]),
      isLoading: false,
      refetch: vi.fn(),
    })
  })

  it('does NOT call prefetchPatientChronicleData on mouseenter', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = await screen.findByRole('row', { name: /Test Patient/i })
    await user.hover(row)
    expect(mockPrefetchPatientChronicleData).not.toHaveBeenCalled()
  })

  it('does NOT call prefetchPatientChronicleData on focus', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = await screen.findByRole('row', { name: /Test Patient/i })
    await user.tab()
    row.focus()
    expect(mockPrefetchPatientChronicleData).not.toHaveBeenCalled()
  })

  it('calls prefetchPatientChronicleData with mode navigation on pointerdown', async () => {
    renderPage()
    const row = await screen.findByRole('row', { name: /Test Patient/i })
    fireEvent.pointerDown(row)
    expect(mockPrefetchPatientChronicleData).toHaveBeenCalledWith(
      expect.anything(),
      'p1',
      { mode: 'navigation' }
    )
  })

  it('calls prefetchPatientChronicleData with mode navigation on Enter key', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = await screen.findByRole('row', { name: /Test Patient/i })
    row.focus()
    await user.keyboard('{Enter}')
    expect(mockPrefetchPatientChronicleData).toHaveBeenCalledWith(
      expect.anything(),
      'p1',
      { mode: 'navigation' }
    )
  })

  it('calls prefetchPatientChronicleData with mode navigation on Space key', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = await screen.findByRole('row', { name: /Test Patient/i })
    row.focus()
    await user.keyboard('{ }')
    expect(mockPrefetchPatientChronicleData).toHaveBeenCalledWith(
      expect.anything(),
      'p1',
      { mode: 'navigation' }
    )
  })
})
