import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LabResultsPage from '../LabResultsPage'

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
  usePaginatedLabResults: () => ({
    data: {
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
      }],
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
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

function renderPage(initialEntry = '/laboratory/results') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LabResultsPage />
    </MemoryRouter>
  )
}

describe('LabResultsPage Rust V2 AI guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
