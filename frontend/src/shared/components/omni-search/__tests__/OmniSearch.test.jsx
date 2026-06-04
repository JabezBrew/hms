import * as React from 'react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'

import { server } from '../../../../../tests/mocks/server'
import { safeStorage } from '@/lib/safe-storage'
import { OmniSearchProvider } from '../OmniSearchProvider'

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '@/lib/auth'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function NavButtons() {
  const navigate = useNavigate()
  return (
    <div>
      <button type="button" onClick={() => navigate('/settings')}>
        Go Settings
      </button>
      <button type="button" onClick={() => navigate('/patients/123')}>
        Go Patient
      </button>
    </div>
  )
}

function renderWithProviders(ui, { route = '/' } = {}) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Omni Search', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/settings/deployment-capabilities/', () =>
        HttpResponse.json({
          deployment_profile: 'hospital',
          facility_code: 'TEST',
          features: { ai_omni_nl: false },
          capabilities: {},
        })
      )
    )
  })

  it('persists an unselected draft query and clears it after opening a result', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST',
    })

    const requests = []
    server.use(
      http.get('/api/search/omni/', ({ request }) => {
        const url = new URL(request.url)
        requests.push(url)
        return HttpResponse.json({
          query: (url.searchParams.get('q') || '').trim(),
          types: [],
          limit: 8,
          groups: {
            recent_patients: [],
            patients: [],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      })
    )

    renderWithProviders(
      <OmniSearchProvider>
        <LocationDisplay />
      </OmniSearchProvider>
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Type a command or search...')
    expect(input).toBeInTheDocument()

    // Opening should fetch recents.
    await waitFor(() => {
      expect(requests.length).toBe(1)
    })

    await user.type(input, 'hello')
    expect(input).toHaveValue('hello')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument()
    })

    // Re-open; the draft query should still be available in this app session.
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input2 = await screen.findByPlaceholderText('Type a command or search...')
    expect(input2).toHaveValue('hello')

    await user.clear(input2)
    await user.type(input2, '> settings')
    await waitFor(() => {
      expect(screen.getByText('/settings')).toBeInTheDocument()
    })
    await user.click(screen.getByText('/settings'))

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/settings')
    })

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input3 = await screen.findByPlaceholderText('Type a command or search...')
    expect(input3).toHaveValue('')
  })

  it('clears the draft query when facility scope changes for the same user', async () => {
    const user = userEvent.setup()
    let authState = {
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST-A',
    }
    useAuth.mockImplementation(() => authState)

    server.use(
      http.get('/api/search/omni/', ({ request }) => {
        const url = new URL(request.url)
        return HttpResponse.json({
          query: (url.searchParams.get('q') || '').trim(),
          types: [],
          limit: 8,
          groups: {
            recent_patients: [],
            patients: [],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      })
    )

    const queryClient = createTestQueryClient()
    const renderTree = (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OmniSearchProvider>
            <div />
          </OmniSearchProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
    const { rerender } = render(renderTree)

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Type a command or search...')
    await user.type(input, 'ama')
    expect(input).toHaveValue('ama')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument()
    })

    authState = {
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST-B',
    }
    rerender(renderTree)

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input2 = await screen.findByPlaceholderText('Type a command or search...')
    expect(input2).toHaveValue('')
  })

  it('does not clear the active query while the dialog remains open past the draft TTL', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST',
    })

    server.use(
      http.get('/api/search/omni/', ({ request }) => {
        const url = new URL(request.url)
        return HttpResponse.json({
          query: (url.searchParams.get('q') || '').trim(),
          types: [],
          limit: 8,
          groups: {
            recent_patients: [],
            patients: [],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      })
    )

    renderWithProviders(
      <OmniSearchProvider>
        <div />
      </OmniSearchProvider>
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Type a command or search...')
    await user.type(input, 'ama')

    vi.useFakeTimers()
    try {
      act(() => {
        vi.advanceTimersByTime(10 * 60 * 1000 + 1)
      })

      expect(input).toHaveValue('ama')
    } finally {
      vi.useRealTimers()
    }
  })

  it('filters pages by role in pages-only mode', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST',
    })

    server.use(
      http.get('/api/search/omni/', () => {
        return HttpResponse.json({
          query: '',
          types: [],
          limit: 8,
          groups: {
            recent_patients: [],
            patients: [],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      })
    )

    renderWithProviders(
      <OmniSearchProvider>
        <div />
      </OmniSearchProvider>
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Type a command or search...')

    await user.type(input, '> settings')
    await waitFor(() => {
      expect(screen.getByText('/settings')).toBeInTheDocument()
    })

    await user.clear(input)
    await user.type(input, '> staff')

    await waitFor(() => {
      expect(screen.queryByText('/staff')).not.toBeInTheDocument()
    })
  })

  it('does not issue a second server request in pages-only mode', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST',
    })

    const urls = []
    server.use(
      http.get('/api/search/omni/', ({ request }) => {
        const url = new URL(request.url)
        urls.push(url)
        return HttpResponse.json({
          query: (url.searchParams.get('q') || '').trim(),
          types: [],
          limit: 8,
          groups: {
            recent_patients: [],
            patients: [],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      })
    )

    renderWithProviders(
      <OmniSearchProvider>
        <div />
      </OmniSearchProvider>
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Type a command or search...')

    await waitFor(() => {
      expect(urls.length).toBe(1)
    })

    await user.type(input, '> settings')
    await waitFor(() => {
      expect(screen.getByText('/settings')).toBeInTheDocument()
    })

    // Allow microtasks to flush; should not trigger another fetch.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 175))
    })
    expect(urls.length).toBe(1)
  })

  it('issues a patients-only request for # prefix and navigates for note prefix', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST',
    })

    const urls = []
    server.use(
      http.get('/api/search/omni/', ({ request }) => {
        const url = new URL(request.url)
        urls.push(url)
        const q = (url.searchParams.get('q') || '').trim()
        const types = (url.searchParams.get('types') || '').trim()

        if (!q) {
          return HttpResponse.json({
            query: q,
            types: [],
            limit: 8,
            groups: {
              recent_patients: [],
              patients: [],
              wards: [],
              encounters: [],
              appointments: [],
              admissions: [],
              staff: [],
            },
          })
        }

        if (types === 'patients') {
          return HttpResponse.json({
            query: q,
            types: ['patients'],
            limit: 8,
            groups: {
              recent_patients: [],
              patients: [
                {
                  id: 'p1',
                  medical_record_number: 'MRN1',
                  name: 'John Doe',
                  date_of_birth: '1990-01-01',
                  gender: 'M',
                  created_at: new Date().toISOString(),
                  current_ward: null,
                  admission_status: null,
                  admission_date: null,
                },
              ],
              wards: [],
              encounters: [],
              appointments: [],
              admissions: [],
              staff: [],
            },
          })
        }

        return HttpResponse.json({
          query: q,
          types: [],
          limit: 8,
          groups: {
            recent_patients: [],
            patients: [],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      })
    )

    renderWithProviders(
      <OmniSearchProvider>
        <LocationDisplay />
      </OmniSearchProvider>
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Type a command or search...')

    await waitFor(() => {
      expect(urls.length).toBe(1)
    })

    const beforeHash = urls.length
    await user.type(input, '# jo')
    await waitFor(() => {
      const match = urls
        .slice(beforeHash)
        .some((u) => u.searchParams.get('q') === 'jo' && u.searchParams.get('types') === 'patients')
      expect(match).toBe(true)
    })

    const beforeNote = urls.length
    await user.clear(input)
    await user.type(input, 'note jo')
    await waitFor(() => {
      const match = urls
        .slice(beforeNote)
        .some((u) => u.searchParams.get('q') === 'jo' && u.searchParams.get('types') === 'patients')
      expect(match).toBe(true)
    })

    const patientItem = await screen.findByText('John Doe')
    await user.click(patientItem)

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/patients/p1?action=add_note')
    })
  })

  it('shows patient identifiers and confirms duplicate-name selections', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST',
    })

    server.use(
      http.get('/api/search/omni/', ({ request }) => {
        const url = new URL(request.url)
        const q = (url.searchParams.get('q') || '').trim()
        if (!q) {
          return HttpResponse.json({
            query: q,
            types: [],
            limit: 8,
            groups: {
              recent_patients: [],
              patients: [],
              wards: [],
              encounters: [],
              appointments: [],
              admissions: [],
              staff: [],
            },
          })
        }

        return HttpResponse.json({
          query: q,
          types: ['patients'],
          limit: 8,
          groups: {
            recent_patients: [],
            patients: [
              {
                id: 'p1',
                medical_record_number: 'A1042',
                name: 'John Mensah',
                date_of_birth: '1984-03-12',
                gender: 'M',
                created_at: new Date().toISOString(),
                current_ward: 'Surgical Ward',
                bed_number: 'B-12',
                patient_location: 'Surgical Ward',
                admission_status: 'admitted',
                admission_date: null,
                match_reason: 'name_token',
              },
              {
                id: 'p2',
                medical_record_number: 'B2042',
                name: 'John Mensah',
                date_of_birth: '1991-08-04',
                gender: 'M',
                created_at: new Date().toISOString(),
                current_ward: null,
                bed_number: null,
                patient_location: null,
                admission_status: null,
                admission_date: null,
                match_reason: 'name_token',
              },
            ],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      })
    )

    renderWithProviders(
      <OmniSearchProvider>
        <LocationDisplay />
      </OmniSearchProvider>
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Type a command or search...')
    await user.type(input, '# john')

    await waitFor(() => {
      expect(screen.getAllByText('John Mensah')).toHaveLength(2)
    })
    expect(screen.getByText('MRN A1042 · DOB 1984-03-12 · Male')).toBeInTheDocument()
    expect(screen.getByText('Surgical Ward · Bed B-12')).toBeInTheDocument()
    expect(screen.getByText('MRN B2042 · DOB 1991-08-04 · Male')).toBeInTheDocument()
    expect(screen.getByText('Not currently admitted')).toBeInTheDocument()
    expect(screen.queryByText('Status unknown')).not.toBeInTheDocument()
    expect(screen.getByText('2 patients named John Mensah')).toBeInTheDocument()
    expect(screen.getByText('Use MRN, DOB, sex, and location to choose the correct record.')).toBeInTheDocument()
    expect(screen.queryByText('2 same-name matches')).not.toBeInTheDocument()

    await user.click(screen.getAllByText('John Mensah')[0])

    expect(await screen.findByText('Confirm Patient Identity')).toBeInTheDocument()
    expect(screen.getByText(/MRN A1042.*DOB 1984-03-12.*Male.*Surgical Ward.*Bed B-12/)).toBeInTheDocument()
    expect(screen.getByText('This name appears on 2 records. Confirm DOB and MRN before continuing.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByText('Confirm Patient Identity')).not.toBeInTheDocument()
    })

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const inputAfterCancel = await screen.findByPlaceholderText('Type a command or search...')
    expect(inputAfterCancel).toHaveValue('# john')
    await waitFor(() => {
      expect(screen.getByText('2 patients named John Mensah')).toBeInTheDocument()
    })

    await user.click(screen.getAllByText('John Mensah')[0])
    expect(await screen.findByText('Confirm Patient Identity')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/patients/p1')
    })
  })

  it('does not treat repeated recent context rows for one patient as a duplicate-name group', async () => {
    useAuth.mockReturnValue({
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST',
    })

    server.use(
      http.get('/api/search/omni/', () => {
        return HttpResponse.json({
          query: '',
          types: [],
          limit: 8,
          groups: {
            recent_patients: [
              {
                id: 'p1',
                medical_record_number: 'A1042',
                name: 'John Mensah',
                date_of_birth: '1984-03-12',
                gender: 'M',
                current_ward: 'Surgical Ward',
                bed_number: 'B-12',
                admission_status: 'admitted',
              },
              {
                id: 'p1',
                medical_record_number: 'A1042',
                name: 'John Mensah',
                date_of_birth: '1984-03-12',
                gender: 'M',
                current_ward: 'Surgical Ward',
                bed_number: 'B-12',
                admission_status: 'admitted',
              },
            ],
            patients: [],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      })
    )

    renderWithProviders(
      <OmniSearchProvider>
        <div />
      </OmniSearchProvider>
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    await screen.findByPlaceholderText('Type a command or search...')

    await waitFor(() => {
      expect(screen.getAllByText('John Mensah')).toHaveLength(1)
    })
    expect(screen.queryByText('2 patients named John Mensah')).not.toBeInTheDocument()
  })

  it('stores only static routes in recent pages', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST',
    })

    server.use(
      http.get('/api/search/omni/', () => {
        return HttpResponse.json({
          query: '',
          types: [],
          limit: 8,
          groups: {
            recent_patients: [],
            patients: [],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      })
    )

    renderWithProviders(
      <OmniSearchProvider>
        <NavButtons />
      </OmniSearchProvider>
    )

    await user.click(screen.getByText('Go Settings'))
    await waitFor(() => {
      const recents = safeStorage.getJSON('omni_recent_pages', [])
      expect(recents.some((p) => p.path === '/settings')).toBe(true)
    })

    await user.click(screen.getByText('Go Patient'))
    await waitFor(() => {
      const recents = safeStorage.getJSON('omni_recent_pages', [])
      expect(recents.some((p) => p.path === '/patients/123')).toBe(false)
    })
  })

  it('does not call AI omni parse when the feature is disabled', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({
      user: { id: 'u1', role: 'doctor' },
      facilityCode: 'TEST',
    })

    const parseRequests = []
    server.use(
      http.get('/api/search/omni/', ({ request }) => {
        const url = new URL(request.url)
        const q = (url.searchParams.get('q') || '').trim()
        return HttpResponse.json({
          query: q,
          types: ['patients'],
          limit: 8,
          groups: {
            recent_patients: [],
            patients: q
              ? [
                  {
                    id: 'p1',
                    medical_record_number: 'MRN1',
                    name: 'John Doe',
                    date_of_birth: '1990-01-01',
                    gender: 'M',
                    created_at: new Date().toISOString(),
                    current_ward: null,
                    admission_status: null,
                    admission_date: null,
                  },
                ]
              : [],
            wards: [],
            encounters: [],
            appointments: [],
            admissions: [],
            staff: [],
          },
        })
      }),
      http.post('/api/ai/omni/parse/', ({ request }) => {
        parseRequests.push(request)
        return HttpResponse.json({ detail: 'Unexpected AI parse call' }, { status: 500 })
      })
    )

    renderWithProviders(
      <OmniSearchProvider>
        <div />
      </OmniSearchProvider>
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Type a command or search...')
    await user.type(input, 'john')

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })
    expect(screen.queryByText('AI Intent Preview')).not.toBeInTheDocument()
    expect(parseRequests).toHaveLength(0)
  })
})
