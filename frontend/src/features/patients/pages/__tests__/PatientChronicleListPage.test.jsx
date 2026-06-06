import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import PatientChronicleListPage from '../PatientChronicleListPage'
import { usePatientSearch } from '@/features/patients/hooks/usePatientQueries'
import { useWards } from '@/features/wards/hooks/useWardQueries'
import {
  prefetchPatientChronicleData,
  prefetchPatientDetailRoute,
} from '@/features/patients/prefetch'

vi.mock('@/features/patients/hooks/usePatientQueries', () => ({
  usePatientSearch: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}))

vi.mock('@/features/wards/hooks/useWardQueries', () => ({
  useWards: vi.fn(() => ({ data: { results: [] }, isLoading: false })),
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
  prefetchPatientChronicleData: vi.fn(),
  prefetchPatientDetailRoute: vi.fn(),
}))

const mockUsePatientSearch = vi.mocked(usePatientSearch)
const mockUseWards = vi.mocked(useWards)

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

function createCursorSearchResponse({ page, rows, hasNext, total = ((page - 1) * 25) + rows.length }) {
  return {
    total,
    count: total,
    count_exact: true,
    total_is_lower_bound: false,
    page,
    page_size: 25,
    next: hasNext ? `cursor-${page + 1}` : null,
    previous: page > 1 ? String(page - 1) : null,
    results: rows,
  }
}

function renderPage(initialEntry = '/patients') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <PatientChronicleListPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('PatientChronicleListPage directory behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePatientSearch.mockImplementation((params) => {
      const recordStatus = params?.record_status || 'all'
      const vitalStatus = params?.vital_status || 'all'
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
        registered: 2,
        restricted: 1,
        entered_in_error: 1,
        superseded: 1,
        deceased: 1,
        all: 4,
      }
      const total = vitalStatus === 'deceased' ? totals.deceased : (totals[recordStatus] ?? 0)

      return {
        data: createSearchResponse(total, baseRows),
        isLoading: false,
        refetch: vi.fn(),
      }
    })
  })

  it('defaults to recent registered records without requesting exact totals', () => {
    renderPage()

    const firstCallParams = mockUsePatientSearch.mock.calls[0][0]
    expect(firstCallParams.record_status).toBe('registered')
    expect(firstCallParams.status).toBeUndefined()
    expect(firstCallParams.ordering).toBe('-created_at')
    expect(firstCallParams.registry_scope).toBeUndefined()
    expect(firstCallParams.include_total).toBeUndefined()
    expect(screen.getByText('Recent registrations')).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('defers ward filter metadata until filters are opened', () => {
    renderPage()

    expect(mockUseWards).not.toHaveBeenCalled()
  })

  it('loads ward filter metadata when filters are opened', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /Filters/i }))

    await waitFor(() => {
      expect(mockUseWards).toHaveBeenCalledWith(
        { is_active: true },
        { staleTime: 5 * 60 * 1000 }
      )
    })
    expect(await screen.findByText('Admission Date')).toBeInTheDocument()
  })

  it('sends server-side ordering when sortable table headers are clicked', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Sort by Name ascending' }))
    await waitFor(() => {
      expect(mockUsePatientSearch.mock.calls.at(-1)[0].ordering).toBe('name')
      expect(screen.getByRole('columnheader', { name: /Name/i })).toHaveAttribute('aria-sort', 'ascending')
    })

    await user.click(screen.getByRole('button', { name: 'Sort by Name descending' }))
    await waitFor(() => {
      expect(mockUsePatientSearch.mock.calls.at(-1)[0].ordering).toBe('-name')
      expect(screen.getByRole('columnheader', { name: /Name/i })).toHaveAttribute('aria-sort', 'descending')
    })
  })

  it('searches across patient records without a default record-status constraint', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Search by name, MRN, or NHIS ID'), 'jo')

    await waitFor(() => {
      const lastCallParams = mockUsePatientSearch.mock.calls.at(-1)[0]
      expect(lastCallParams.query).toBe('jo')
      expect(lastCallParams.status).toBeUndefined()
      expect(lastCallParams.registry_scope).toBeUndefined()
      expect(lastCallParams.include_total).toBeUndefined()
      expect(screen.getByText('Search results')).toBeInTheDocument()
      expect(screen.getByText('(4)')).toBeInTheDocument()
    })
  })

  it('applies record status only as an explicit filter', () => {
    renderPage({
      pathname: '/patients',
      state: {
        patientRegistryState: {
          appliedFilters: {
            recordStatus: 'restricted',
          },
          draftFilters: {
            recordStatus: 'restricted',
          },
        },
      },
    })

    const firstCallParams = mockUsePatientSearch.mock.calls[0][0]
    expect(firstCallParams.record_status).toBe('restricted')
    expect(firstCallParams.status).toBeUndefined()
    expect(firstCallParams.registry_scope).toBeUndefined()
    expect(screen.getByText('Filtered patient records')).toBeInTheDocument()
    expect(screen.getByText('Record: Restricted')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
  })

  it('applies vital status separately from record status', () => {
    renderPage({
      pathname: '/patients',
      state: {
        patientRegistryState: {
          appliedFilters: {
            recordStatus: 'registered',
            vitalStatus: 'deceased',
          },
          draftFilters: {
            recordStatus: 'registered',
            vitalStatus: 'deceased',
          },
        },
      },
    })

    const firstCallParams = mockUsePatientSearch.mock.calls[0][0]
    expect(firstCallParams.record_status).toBe('registered')
    expect(firstCallParams.vital_status).toBe('deceased')
    expect(firstCallParams.status).toBeUndefined()
    expect(screen.getByText('Record: Registered record')).toBeInTheDocument()
    expect(screen.getByText('Vital: Deceased')).toBeInTheDocument()
  })

  it('shows current care location header and multi-clinic tooltip content', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Current Care Location')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sort by Current Care Location' })).not.toBeInTheDocument()
    const clinicCellTrigger = screen.getByRole('button', { name: 'Clinic A +2' })
    expect(clinicCellTrigger).toBeInTheDocument()

    await user.hover(clinicCellTrigger)
    expect(await screen.findByRole('tooltip', { name: 'Clinic A, Clinic B, Clinic C' })).toBeInTheDocument()
  })

  it('labels patients without a current admission location as not admitted', () => {
    mockUsePatientSearch.mockImplementation(() => ({
      data: createSearchResponse(1, [
        {
          id: 'patient-without-location',
          created_at: '2026-02-13T10:00:00Z',
          medical_record_number: 'MRN-404',
          name: 'Patient Without Location',
          date_of_birth: '1990-01-01',
          gender: 'female',
          registry_status: 'active',
          patient_location: null,
          active_clinic_names: [],
        },
      ]),
      isLoading: false,
      refetch: vi.fn(),
    }))

    renderPage()

    expect(screen.getByText('Not admitted')).toBeInTheDocument()
  })

  it('shows exact totals for cursor-paginated results without fake page numbering', async () => {
    const user = userEvent.setup()
    mockUsePatientSearch.mockImplementation((params) => {
      const page = params?.page || 1
      return {
        data: createCursorSearchResponse({
          page,
          rows: createRegistryRows(25, ((page - 1) * 25) + 1),
          hasNext: true,
          total: 2700,
        }),
        isLoading: false,
        refetch: vi.fn(),
      }
    })

    renderPage()

    expect(screen.getByText('(2700)')).toBeInTheDocument()
    expect(screen.getByText((_, element) => (
      element?.tagName === 'P'
      && element.textContent?.includes('Showing 1 to 25 of 2700 patients')
    ))).toBeInTheDocument()
    expect(screen.queryByText(/More results available/)).not.toBeInTheDocument()
    expect(screen.queryByText(/25\+/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1 of 2/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Next/i }))

    await waitFor(() => {
      expect(screen.getByText('(2700)')).toBeInTheDocument()
      expect(screen.getByText((_, element) => (
        element?.tagName === 'P'
        && element.textContent?.includes('Showing 26 to 50 of 2700 patients')
      ))).toBeInTheDocument()
    })
    expect(screen.queryByText(/50\+/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 2/)).not.toBeInTheDocument()
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

  it('restores patient search and clinical filters from history state without using URL query text', () => {
    renderPage({
      pathname: '/patients',
      search: '?q=ignored&scope=deceased',
      state: {
        patientRegistryState: {
          searchQuery: 'akua',
          searchOrdering: 'name',
          searchPage: 2,
          draftFilters: {
            recordStatus: 'registered',
            vitalStatus: 'deceased',
            admissionStart: '2026-06-01',
            admissionEnd: '2026-06-03',
            wardId: 'ward-1',
            admissionStatus: 'admitted',
            attending: { id: 'staff-1', name: 'Dr Attending' },
            ageMin: '10',
            ageMax: '50',
          },
          appliedFilters: {
            recordStatus: 'registered',
            vitalStatus: 'deceased',
            admissionStart: '2026-06-01',
            admissionEnd: '2026-06-03',
            wardId: 'ward-1',
            admissionStatus: 'admitted',
            attending: { id: 'staff-1', name: 'Dr Attending' },
            ageMin: '10',
            ageMax: '50',
          },
        },
      },
    })

    const firstCallParams = mockUsePatientSearch.mock.calls[0][0]
    expect(firstCallParams.record_status).toBe('registered')
    expect(firstCallParams.vital_status).toBe('deceased')
    expect(firstCallParams.status).toBeUndefined()
    expect(firstCallParams.registry_scope).toBeUndefined()
    expect(firstCallParams.query).toBe('akua')
    expect(firstCallParams.ordering).toBe('name')
    expect(firstCallParams.page).toBe(2)
    expect(firstCallParams.admission_start).toBe('2026-06-01')
    expect(firstCallParams.admission_end).toBe('2026-06-03')
    expect(firstCallParams.ward).toBe('ward-1')
    expect(firstCallParams.admission_status).toBe('admitted')
    expect(firstCallParams.attending_id).toBe('staff-1')
    expect(firstCallParams.age_min).toBe('10')
    expect(firstCallParams.age_max).toBe('50')
    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})

const mockPrefetchPatientChronicleData = vi.mocked(prefetchPatientChronicleData)
const mockPrefetchPatientDetailRoute = vi.mocked(prefetchPatientDetailRoute)

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

  it('does not automatically prefetch patient detail route chunks on mount', () => {
    renderPage()

    expect(mockPrefetchPatientDetailRoute).not.toHaveBeenCalled()
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
