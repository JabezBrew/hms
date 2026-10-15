import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client'
import { admissionsApi } from '@/features/admissions/api'
import { AdmissionCaseQueueView } from '../AdmissionCaseQueueView'

const { auth } = vi.hoisted(() => ({ auth: { facilityCode: 'TEST', user: { id: 'staff-1', role: 'doctor' } } }))
vi.mock('@/lib/auth', () => ({ useAuth: () => auth }))
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }))

const originalFetch = globalThis.fetch
const nextCursor = 'opaque:after?25/'
const olderCases = Array.from({ length: 25 }, (_, index) => ({
  id: `case-${index + 1}`, patient_id: `patient-${index + 1}`, patient_code: `TEST-${index + 1}`,
  patient_display_name: `Older request ${index + 1}`, ward_id: 'ward-1', ward_name: 'Fixture ward',
  bed_id: `bed-${index + 1}`, bed_code: String(index + 1),
  status: index === 0 ? 'discharged' : index === 1 ? 'cancelled' : index === 2 ? 'admitted' : 'ready_for_activation',
  created_at: '2026-10-01T09:00:00Z', admitted_at: index === 0 || index === 2 ? '2026-10-01T10:00:00Z' : null,
  discharged_at: index === 0 ? '2026-10-02T12:00:00Z' : null,
}))
const latestCase = { ...olderCases[24], id: 'latest-case', patient_id: 'latest-patient', patient_display_name: 'Current request fixture', created_at: '2026-10-15T09:00:00Z' }

function pageResponse(data, cursor = null) {
  return new Response(JSON.stringify({ data, page: { limit: 25, has_next: Boolean(cursor), next_cursor: cursor }, meta: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function Location() {
  const location = useLocation()
  return <output aria-label="Current route">{location.pathname}</output>
}

function renderQueue(scope = 'general') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const content = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/admissions/requests']}><AdmissionCaseQueueView scope={scope} /><Location /></MemoryRouter></QueryClientProvider>
  const view = render(content())
  return { ...view, client, updateAuth: () => view.rerender(content()) }
}

describe('Admission case cursor queue', () => {
  beforeEach(() => {
    auth.facilityCode = 'TEST'
    auth.user = { id: 'staff-1', role: 'doctor' }
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }
    __resetV2ApiClientForTests()
    configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => auth.facilityCode })
    globalThis.fetch = vi.fn().mockImplementation(async (url) => (
      new URL(url).searchParams.get('cursor') ? pageResponse([latestCase]) : pageResponse(olderCases, nextCursor)
    ))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete window.__HMS_RUNTIME_CONFIG__
    __resetV2ApiClientForTests()
    globalThis.fetch = originalFetch
  })

  it('browses real older and newer pages, preserves terminal status, and opens the actual case', async () => {
    const user = userEvent.setup()
    renderQueue()
    expect(await screen.findByText('25 cases on this page', {}, { timeout: 5000 })).toBeInTheDocument()
    const dischargedCard = within(screen.getByText('Older request 1', { exact: true }).closest('[data-slot="card"]'))
    expect(dischargedCard.getByText('discharged', { exact: true })).toBeInTheDocument()
    expect(dischargedCard.queryByText('Bed Reserved')).not.toBeInTheDocument()
    expect(screen.queryByText(/open cases/)).not.toBeInTheDocument()
    expect(screen.queryByText('Pending Blockers')).not.toBeInTheDocument()
    expect(screen.queryByText('Activation Ready')).not.toBeInTheDocument()
    expect(screen.queryByText('Source')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByText('More cases available')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Current request fixture')).toBeInTheDocument()
    expect(screen.getByText('1 case on this page')).toBeInTheDocument()
    expect(screen.getByText('Page 2 · Oldest requests first')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    const [url, request] = globalThis.fetch.mock.calls[1]
    expect(new URL(url).pathname).toBe('/api/v2/admissions/cases')
    expect(new URL(url).searchParams.get('cursor')).toBe(nextCursor)
    expect(new URL(url).searchParams.get('limit')).toBe('25')
    expect(request.signal).toBeInstanceOf(AbortSignal)
    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText('25 cases on this page')).toBeInTheDocument()
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3))
    expect(new URL(globalThis.fetch.mock.calls[2][0]).searchParams.has('cursor')).toBe(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.click(await screen.findByRole('button', { name: 'Open Case' }))
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/admissions/cases/latest-case')
  })

  it('resets cursor history and cached records when the authorization facility changes', async () => {
    const user = userEvent.setup()
    const view = renderQueue()
    await user.click(await screen.findByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Current request fixture')).toBeInTheDocument()
    globalThis.fetch.mockImplementation(async (_url, options) => {
      expect(new Headers(options.headers).get('X-Facility-Code')).toBe('OTHER')
      return pageResponse([{ ...latestCase, patient_display_name: 'Other facility request' }])
    })
    auth.facilityCode = 'OTHER'
    view.updateAuth()
    expect(await screen.findByText('Other facility request')).toBeInTheDocument()
    expect(screen.queryByText('Current request fixture')).not.toBeInTheDocument()
    expect(screen.getByText('Page 1 · Oldest requests first')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(new URL(globalThis.fetch.mock.calls.at(-1)[0]).searchParams.has('cursor')).toBe(false)
    expect(JSON.stringify(view.client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain(nextCursor)
  })

  it.each([['billing', 'Billing Admissions'], ['nursing', 'Nursing Admissions']])('shows native records without inventing a legacy clearance filter for %s', async (scope, heading) => {
    renderQueue(scope)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByText('Older request 1', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('25 cases on this page')).toBeInTheDocument()
    expect(screen.queryByText('No admission cases')).not.toBeInTheDocument()
  })

  it('keeps previous-page recovery available when loading the next page fails', async () => {
    globalThis.fetch.mockImplementation(async (url) => new URL(url).searchParams.has('cursor')
      ? new Response(JSON.stringify({ error: { code: 'unavailable', message: 'Queue unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } })
      : pageResponse(olderCases, nextCursor))
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('heading', { name: 'Unable to load admission cases' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText('25 cases on this page')).toBeInTheDocument()
  })

  it('preserves legacy clearance filtering and array response compatibility', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }
    vi.spyOn(admissionsApi, 'getCases').mockResolvedValue([
      { id: 'legacy-case', patient_name: 'Legacy clearance fixture', status: 'awaiting_clearance', blockers: [{ task_type: 'financial_clearance', status: 'pending' }] },
      { id: 'legacy-completed', patient_name: 'Legacy completed fixture', status: 'completed', blockers: [] },
    ])
    renderQueue('billing')
    expect(await screen.findByText('Legacy clearance fixture')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Billing Admission Queue' })).toBeInTheDocument()
    expect(screen.queryByText('Legacy completed fixture')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Admission cases pagination' })).not.toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
