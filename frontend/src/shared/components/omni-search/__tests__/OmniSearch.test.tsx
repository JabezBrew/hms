import * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
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
  it('toggles open with Ctrl+K and closes with Esc (clears query)', async () => {
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

    // Re-open; query should be cleared.
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input2 = await screen.findByPlaceholderText('Type a command or search...')
    expect(input2).toHaveValue('')
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
})
