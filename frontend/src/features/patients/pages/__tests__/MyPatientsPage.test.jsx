import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import MyPatientsPage from '../MyPatientsPage'
import { prefetchPatientChronicleData } from '@/features/patients/prefetch'

vi.mock('@/features/patients/hooks/useMyPatientsQueries', () => ({
  useMyPatients: () => ({
    data: {
      results: [
        {
          id: 'entry-1',
          is_pinned: false,
          notes: '',
          added_at: '2026-01-01T00:00:00Z',
          patient_details: { id: 'patient-42', name: 'Alice Smith', medical_record_number: 'MRN-042' },
        },
      ],
    },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useRemoveFromMyPatients: () => ({ mutate: vi.fn() }),
  useToggleMyPatientPin: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}))

vi.mock('@/features/patients/prefetch', () => ({
  prefetchMyPatientsRoute: vi.fn(),
  prefetchPatientRegistryRoute: vi.fn(),
  prefetchPatientChronicleData: vi.fn(),
}))

vi.mock('@/components/ui/VirtualizedTable', () => ({
  default: ({ rows, columns }) => (
    <div>{(rows || []).map((_, i) => <div key={i} />)}</div>
  ),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MyPatientsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MyPatientsPage PHI prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT prefetch patient chart data on mount even when patients are present', () => {
    renderPage()
    expect(vi.mocked(prefetchPatientChronicleData)).not.toHaveBeenCalled()
  })
})
