import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import PatientChronicleListPage from '../PatientChronicleListPage'
import { usePatientSearch } from '@/features/patients/hooks/usePatientQueries'
import {
  prefetchMyPatientsRoute,
  prefetchPatientChronicleData,
  prefetchPatientDetailRoute,
  prefetchPatientRegistryRoute,
} from '@/features/patients/prefetch'

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

function createRegistryRows(count, startIndex = 1, overrides = {}) {
  return Array.from({ length: count }, (_, index) => {
    const rowNumber = startIndex + index
    return {
      id: `patient-${rowNumber}`,
      created_at: '2026-02-13T10:00:00Z',
      medical_record_number: `MRN-${String(rowNumber).padStart(3, '0')}`,
      name: `Patient ${rowNumber}`,
      date_of_birth: '1990-01-01',
      gender: 'male',
      registry_status: 'active',
      ...overrides,
    }
  })
}

function createCursorSearchResponse({ page, rows, hasNext }) {
  const knownCount = ((page - 1) * 25) + rows.length
  return {
    total: knownCount,
    count: knownCount,
    count_exact: false,
    total_is_lower_bound: hasNext,
    page,
    page_size: 25,
    next: hasNext ? `cursor-${page + 1}` : null,
    previous: page > 1 ? String(page - 1) : null,
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

  it('labels cursor-paginated results as a known range instead of a fake exact total', async () => {
    const user = userEvent.setup()
    mockUsePatientSearch.mockImplementation((params) => {
      const page = params?.page || 1
      return {
        data: createCursorSearchResponse({
          page,
          rows: createRegistryRows(25, ((page - 1) * 25) + 1),
          hasNext: true,
        }),
        isLoading: false,
        refetch: vi.fn(),
      }
    })

    renderPage()

    expect(screen.getByText('(25+)')).toBeInTheDocument()
    expect(screen.getByText((text) => (
      text.includes('Showing 1-25+ results')
      && text.includes('Page 1')
      && text.includes('More available')
    ))).toBeInTheDocument()
    expect(screen.queryByText(/26 results/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1 of 2/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Next/i }))

    await waitFor(() => {
      expect(screen.getByText('(50+)')).toBeInTheDocument()
      expect(screen.getByText((text) => (
        text.includes('Showing 26-50+ results')
        && text.includes('Page 2')
        && text.includes('More available')
      ))).toBeInTheDocument()
    })
    expect(screen.queryByText(/51 results/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 2 of 3/)).not.toBeInTheDocument()
  })

  it('renders active admission ward and bed when the patient list item includes them', () => {
    mockUsePatientSearch.mockReturnValue({
      data: createSearchResponse(1, createRegistryRows(1, 1, {
        active_admission: {
          admission_id: 'admission-1',
          ward_name: 'Medical Ward',
          bed_code: 'A-12',
        },
      })),
      isLoading: false,
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByText('Medical Ward / Bed A-12')).toBeInTheDocument()
  })
})

const mockPrefetchPatientChronicleData = vi.mocked(prefetchPatientChronicleData)
const mockPrefetchPatientDetailRoute = vi.mocked(prefetchPatientDetailRoute)
const mockPrefetchMyPatientsRoute = vi.mocked(prefetchMyPatientsRoute)
const mockPrefetchPatientRegistryRoute = vi.mocked(prefetchPatientRegistryRoute)

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

  it('does not prefetch patient detail route or PHI data on mouseenter', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = await screen.findByRole('row', { name: /Test Patient/i })
    await user.hover(row)
    expect(mockPrefetchPatientDetailRoute).not.toHaveBeenCalled()
    expect(mockPrefetchPatientChronicleData).not.toHaveBeenCalled()
  })

  it('does not automatically prefetch route chunks on mount', () => {
    renderPage()

    expect(mockPrefetchPatientDetailRoute).not.toHaveBeenCalled()
    expect(mockPrefetchMyPatientsRoute).not.toHaveBeenCalled()
    expect(mockPrefetchPatientRegistryRoute).not.toHaveBeenCalled()
  })

  it('does not prefetch patient detail route or PHI data on focus', async () => {
    renderPage()
    const row = await screen.findByRole('row', { name: /Test Patient/i })
    fireEvent.focus(row)
    expect(mockPrefetchPatientDetailRoute).not.toHaveBeenCalled()
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
