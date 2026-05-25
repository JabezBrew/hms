import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WardRoundMode from '../WardRoundMode'
import { wardRoundApi } from '../api'

vi.mock('../api', () => ({
  wardRoundApi: {
    saveDraft: vi.fn(),
    commit: vi.fn(),
  },
}))

vi.mock('@/features/laboratory/hooks', () => ({
  labKeys: {
    orders: () => ['laboratory', 'orders'],
    results: () => ['laboratory', 'results'],
  },
  useLabTests: () => ({ data: { results: [] }, isFetching: false }),
  useLabPanels: () => ({ data: { results: [] }, isFetching: false }),
}))

vi.mock('@/hooks/useNursingQueries', () => ({
  nursingKeys: {
    nursingTasksAll: () => ['nursing-tasks'],
    nursingTasksToday: () => ['nursing-tasks-today'],
  },
}))

vi.mock('@/hooks/usePrescriptionMutations', () => ({
  prescriptionKeys: {
    active: (patientId) => ['prescriptions', 'active', patientId],
    list: (patientId) => ['prescriptions', 'list', patientId],
  },
}))

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value) => value,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function renderMode(props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <WardRoundMode
        patientId="patient-1"
        patient={{ id: 'patient-1', name: 'Ama Mensah' }}
        admission={{
          admission_id: 'admission-1',
          ward_name: 'Ward A',
          bed_code: 'B1',
        }}
        encounter={{ id: 'encounter-1' }}
        chronicleContext={{
          timeline: {
            results: [{
              id: 'note-1',
              type: 'progress_note',
              title: 'Previous progress note',
              timestamp: '2026-05-24T10:00:00Z',
            }],
          },
          nursing_tasks: [{ id: 'task-1', title: 'Repeat observations', status: 'open' }],
        }}
        latestVitals={{
          blood_pressure: '148/94',
          heart_rate: 104,
          oxygen_saturation: 96,
          temperature: 37.8,
          recorded_at: '2026-05-25T06:30:00Z',
        }}
        labResults={[{
          id: 'lab-1',
          name: 'Creatinine',
          value: '180',
          unit: 'umol/L',
          is_abnormal: true,
        }]}
        medications={[{
          id: 'rx-1',
          medication_name: 'Ceftriaxone',
          dose: '1 g',
          frequency: 'Daily',
          status: 'active',
        }]}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('WardRoundMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(wardRoundApi.saveDraft).mockResolvedValue({ data: { id: 'draft-1' } })
    vi.mocked(wardRoundApi.commit).mockResolvedValue({ data: { id: 'round-1' } })
  })

  it('renders an active-admission required empty state', () => {
    renderMode({ admission: null })

    expect(screen.getByText(/active admission required/i)).toBeInTheDocument()
  })

  it('renders the single-page note, review rail, and action blocks without deferred labels', () => {
    renderMode()

    expect(screen.getByRole('heading', { name: 'Ward Round' })).toBeInTheDocument()
    expect(screen.getAllByText(/Today's Round/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Review Before Signing/i)).toBeInTheDocument()
    expect(screen.getByText('Medication')).toBeInTheDocument()
    expect(screen.getByText('Lab Order')).toBeInTheDocument()
    expect(screen.getByText('Nursing Task')).toBeInTheDocument()
    expect(screen.getByText('Discharge Readiness')).toBeInTheDocument()

    expect(screen.queryByText(/AI assistant/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/copilot/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/shift handoff/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/inventory/i)).not.toBeInTheDocument()
  })

  it('signs through the ward-round commit endpoint instead of separate browser actions', async () => {
    const user = userEvent.setup()
    renderMode()

    await user.type(screen.getByLabelText(/Assessment/i), 'Clinically stable today.')
    await user.click(screen.getByRole('button', { name: /sign round/i }))

    await waitFor(() => {
      expect(wardRoundApi.commit).toHaveBeenCalledWith(
        'patient-1',
        expect.objectContaining({
          admission_case_id: 'admission-1',
          note: expect.objectContaining({
            assessment: 'Clinically stable today.',
          }),
        }),
      )
    })
    expect(wardRoundApi.saveDraft).not.toHaveBeenCalled()
  })
})
