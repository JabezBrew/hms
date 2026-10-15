import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LabResultsPage from '../LabResultsPage'

const resultState = vi.hoisted(() => ({ extra: {}, isError: false, noData: false, refetch: vi.fn(), filters: [] }))

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { role: 'doctor' } }),
}))

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value) => value,
}))

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}))

vi.mock('@/features/laboratory/hooks', () => ({
  usePaginatedLabResults: (filters) => {
    resultState.filters.push(filters)
    return {
    data: resultState.noData ? undefined : {
      count: 1,
      results: [{
        id: 'result-1',
        order_id: 'order-1',
        order_number: 'LAB-001',
        patient_id: 'patient-1',
        patient_name: 'Ama Mensah',
        patient_mrn: 'MRN-001',
        ordering_provider: 'Dr Mensah',
        test_name: 'Full Blood Count',
        panel_name: 'Hematology',
        value: '12.1',
        unit: 'g/dL',
        flag: 'normal',
        is_verified: false,
        is_critical: false,
        entered_at: '2026-05-12T10:00:00Z',
        performed_at: '2026-05-12T10:00:00Z',
        ...resultState.extra,
      }],
    },
    isLoading: false,
    isFetching: false,
    isError: resultState.isError,
    refetch: resultState.refetch,
  }},
  useLabInterpretation: () => ({
    data: null,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLabResult: (id) => ({
    data: id
      ? {
          id,
          order_id: 'order-1',
          order_number: 'LAB-001',
          patient_id: 'patient-1',
          patient_name: 'Ama Mensah',
          patient_mrn: 'MRN-001',
          test_name: 'Full Blood Count',
          value: '12.1',
          unit: 'g/dL',
          flag: 'normal',
          is_verified: false,
          is_critical: false,
          entered_at: '2026-05-12T10:00:00Z',
          ...resultState.extra,
        }
      : null,
    isLoading: false,
  }),
  useVerifyLabResult: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useBulkVerifyLabResults: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/components/ui/VirtualizedTable', () => ({
  default: ({ rows, columns }) => (
    <div>
      {rows.map((row) => (
        <div key={row._key}>
          {columns.map((column) => (
            <div key={column.key}>{column.render ? column.render(row) : row[column.key]}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{JSON.stringify({ search: location.search, state: location.state })}</output>
}

function renderPage(initialEntry = '/laboratory/results') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LabResultsPage />
      <LocationProbe />
    </MemoryRouter>
  )
}

describe('LabResultsPage Rust V2 AI guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resultState.extra = {}
    resultState.isError = false
    resultState.noData = false
    resultState.filters = []
  })

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__
  })

  it('hides AI interpretation buttons in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage()

    expect(screen.queryByRole('button', { name: /^interpret$/i })).not.toBeInTheDocument()
  })

  it('keeps AI interpretation buttons available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }

    renderPage()

    expect(screen.getByRole('button', { name: /^interpret$/i })).toBeInTheDocument()
  })

  it('shows the selected result from a result deep link', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage('/laboratory/results?result=result-1')

    expect(screen.getByText(/selected result/i)).toBeInTheDocument()
    expect(screen.getAllByText('Full Blood Count').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-omni-target="true"]')).toBeInTheDocument()
  })

  it('shows and counts native critical results without inventing a high or low direction', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    resultState.extra = { flag: undefined, is_critical: true }
    renderPage('/laboratory/results?result=result-1')
    expect(screen.getAllByText('Critical', { exact: true }).length).toBeGreaterThan(1)
    expect(within(screen.getByText('Critical Page').closest('article')).getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('Normal', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText(/Critical High|Critical Low/)).not.toBeInTheDocument()
  })

  it('keeps an unclassified native result distinct from a confirmed normal result', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    resultState.extra = { flag: undefined, is_critical: false }
    renderPage('/laboratory/results?result=result-1')
    expect(screen.getAllByText('Not classified', { exact: true }).length).toBeGreaterThan(1)
    expect(screen.queryByText('Normal', { exact: true })).not.toBeInTheDocument()
    expect(within(screen.getByText('Critical Page').closest('article')).getByText('0')).toBeInTheDocument()
  })

  it.each([['normal', 'Normal'], ['high', 'High'], ['critical_low', 'Critical Low']])('preserves the explicit legacy %s flag', (flag, label) => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }
    resultState.extra = { flag }
    renderPage('/laboratory/results?result=result-1')
    expect(screen.getAllByText(label, { exact: true }).length).toBeGreaterThan(0)
  })

  it.each(['pointer', 'keyboard'])('selects the critical tab with %s input, resets pagination and preserves unrelated route and verification state', (input) => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    renderPage({
      pathname: '/laboratory/results',
      search: '?result=result-1&panel=hematology',
      state: {
        retainedContext: 'preserved',
        'laboratory:resultsTable': { searchQuery: 'Synthetic filter', verificationFilter: 'unverified', page: 4 },
      },
    })
    expect(resultState.filters.at(-1)).toMatchObject({ page: 4, search: 'Synthetic filter', is_verified: false })
    const criticalTab = screen.getByRole('tab', { name: /Critical \/ Needs Review/ })
    if (input === 'keyboard') {
      fireEvent.keyDown(criticalTab, { key: 'Enter' })
    } else {
      fireEvent.mouseDown(criticalTab, { button: 0, ctrlKey: false })
      fireEvent.click(criticalTab)
    }
    expect(criticalTab).toHaveAttribute('aria-selected', 'true')
    expect(resultState.filters.at(-1)).toMatchObject({ page: 1, search: 'Synthetic filter', is_verified: false, critical_only: true })
    const selectedLocation = JSON.parse(screen.getByTestId('location').textContent)
    expect(new URLSearchParams(selectedLocation.search).get('tab')).toBe('critical')
    expect(new URLSearchParams(selectedLocation.search).get('result')).toBe('result-1')
    expect(new URLSearchParams(selectedLocation.search).get('panel')).toBe('hematology')
    expect(selectedLocation.state).toEqual({
      retainedContext: 'preserved',
      'laboratory:resultsTable': { searchQuery: 'Synthetic filter', verificationFilter: 'unverified', page: 1 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear', exact: true }))
    expect(screen.getByRole('tab', { name: /All Results/ })).toHaveAttribute('aria-selected', 'true')
    expect(resultState.filters.at(-1)).toEqual({ page: 1, page_size: 100 })
    const clearedLocation = JSON.parse(screen.getByTestId('location').textContent)
    expect(new URLSearchParams(clearedLocation.search).has('tab')).toBe(false)
    expect(new URLSearchParams(clearedLocation.search).get('result')).toBe('result-1')
    expect(new URLSearchParams(clearedLocation.search).get('panel')).toBe('hematology')
    expect(clearedLocation.state).toEqual({
      retainedContext: 'preserved',
      'laboratory:resultsTable': { searchQuery: '', verificationFilter: 'all', page: 1 },
    })
  })

  it.each([false, true])('hides failed-read counts and clinical data, preserves filters and retries only on request (no cached data: %s)', (noData) => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    const path = '/laboratory/results?result=result-1'
    const view = renderPage(path)
    fireEvent.change(screen.getByPlaceholderText(/Search by patient name/), { target: { value: 'Synthetic filter' } })
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Critical \/ Needs Review/ }), { button: 0, ctrlKey: false })
    expect(screen.getByRole('tab', { name: /Critical \/ Needs Review/ })).toHaveAttribute('aria-selected', 'true')
    resultState.isError = true
    resultState.noData = noData
    view.rerender(<MemoryRouter initialEntries={[path]}><LabResultsPage /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Lab results could not be loaded')
    expect(screen.queryByText('Critical Page')).not.toBeInTheDocument()
    expect(screen.queryByText('Total Results')).not.toBeInTheDocument()
    expect(screen.queryByText('Full Blood Count')).not.toBeInTheDocument()
    expect(screen.queryByText(/No results found|0 matching results/)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search by patient name/)).toHaveValue('Synthetic filter')
    expect(screen.getByRole('tab', { name: /Critical \/ Needs Review/ })).toHaveAttribute('aria-selected', 'true')
    expect(resultState.refetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry results' }))
    expect(resultState.refetch).toHaveBeenCalledTimes(1)
    expect(resultState.filters.at(-1)).toMatchObject({ search: 'Synthetic filter', critical_only: true })
    resultState.isError = false
    resultState.noData = false
    view.rerender(<MemoryRouter initialEntries={[path]}><LabResultsPage /></MemoryRouter>)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Critical Page')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search by patient name/)).toHaveValue('Synthetic filter')
  })
})
