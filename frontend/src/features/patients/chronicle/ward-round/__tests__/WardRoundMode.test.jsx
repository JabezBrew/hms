import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WardRoundMode from '../WardRoundMode'
import { wardRoundApi } from '../api'

vi.mock('../api', () => ({
  wardRoundApi: {
    current: vi.fn(),
    saveDraft: vi.fn(),
    commit: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ facilityCode: 'TEST', user: { id: 'user-1' } }) }))

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
    vi.mocked(wardRoundApi.current).mockResolvedValue(null)
    vi.mocked(wardRoundApi.saveDraft).mockResolvedValue({ data: { id: 'draft-1' } })
    vi.mocked(wardRoundApi.commit).mockResolvedValue({ data: { id: 'round-1' } })
  })

  it('renders an active-admission required empty state', () => {
    renderMode({ admission: null })

    expect(screen.getByText(/active admission required/i)).toBeInTheDocument()
  })

  it('renders the single-page note, review rail, and action blocks without deferred labels', async () => {
    renderMode()

    expect(await screen.findByRole('heading', { name: 'Ward Round' })).toBeInTheDocument()
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

    await user.type(await screen.findByLabelText(/Assessment/i), 'Clinically stable today.')
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
  it('loads the persisted draft before allowing edits and retains original actions and version on save', async () => {
    const draft = {
      id: 'round-1', status: 'draft', version: 7, admission_case_id: 'admission-1',
      note_sections: { interval_history: 'Stable overnight', examination: 'Chest clear', assessment: 'Improving', plan: 'Continue treatment', clinical_readiness_blockers: ['Awaiting review', 'Teaching required'] },
      rendered_note: 'ASSESSMENT\nImproving\n\nPLAN\nContinue treatment\n\nSUMMARY\nSaved summary',
      actions: [
        { id: 'action-1', status: 'draft', action_type: 'prescription', payload: { prescription_id: 'rx-1', medication_name: 'Test medication', dose: '1 g', frequency: 'Daily', status: 'on_hold' } },
        { id: 'action-2', status: 'draft', action_type: 'lab_order', title: 'Test panel', payload: { panel_ids: ['panel-1'], test_ids: [], priority: 'urgent' } },
        { id: 'action-3', status: 'draft', action_type: 'nursing_task', payload: { title: 'Repeat observations', instruction: 'Repeat after review', due_at: '2026-10-14T09:00:00Z', task_type: 'observation', assigned_to_user_id: 'staff-2' } },
      ],
    }
    vi.mocked(wardRoundApi.current).mockResolvedValue(draft)
    vi.mocked(wardRoundApi.saveDraft).mockResolvedValue({ ...draft, version: 8 })
    const user = userEvent.setup()
    renderMode()
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Assessment')).toHaveValue('Improving')
    expect(screen.getByLabelText('Examination')).toHaveValue('Chest clear')
    expect(screen.getByLabelText('Round note summary')).toHaveValue('Saved summary')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(wardRoundApi.saveDraft).toHaveBeenCalledOnce())
    expect(wardRoundApi.saveDraft).toHaveBeenLastCalledWith('patient-1', expect.objectContaining({
      ward_round_id: 'round-1', expected_version: 7,
      note: expect.objectContaining({ examination: 'Chest clear', summary: 'Saved summary' }),
      actions: expect.objectContaining({
        medications: [expect.objectContaining({ prescription_id: 'rx-1', decision: 'hold', status: 'on_hold' })],
        lab_orders: [expect.objectContaining({ catalog_item_id: 'panel-1', catalog_item_type: 'panel', priority: 'urgent' })],
        nursing_tasks: [expect.objectContaining({ due_at: '2026-10-14T09:00:00Z', assigned_to_user_id: 'staff-2' })],
        discharge: expect.objectContaining({ original_blockers: ['Awaiting review', 'Teaching required'] }),
      }),
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(wardRoundApi.saveDraft).toHaveBeenCalledTimes(2))
    expect(wardRoundApi.saveDraft).toHaveBeenLastCalledWith('patient-1', expect.objectContaining({ expected_version: 8 }))
  })

  it('keeps the editor unavailable on draft-load failure and supports retry', async () => {
    vi.mocked(wardRoundApi.current).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(null)
    const user = userEvent.setup()
    renderMode()
    expect(await screen.findByText('Ward round draft could not be loaded')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try Again|Retry/i }))
    expect(await screen.findByLabelText('Assessment')).toHaveValue('')
    expect(wardRoundApi.saveDraft).not.toHaveBeenCalled()
  })

  it('never replays an already committed round as a new draft', async () => {
    vi.mocked(wardRoundApi.current).mockResolvedValue({ id: 'signed-round', status: 'committed', admission_case_id: 'admission-1', note_sections: { assessment: 'Already signed' }, actions: [{ action_type: 'prescription', status: 'committed' }] })
    renderMode()
    expect(await screen.findByLabelText('Assessment')).toHaveValue('')
    expect(screen.queryByDisplayValue('Already signed')).not.toBeInTheDocument()
  })

  it('preserves incomplete medication work when saving a draft while preventing signing', async () => {
    const user = userEvent.setup()
    renderMode()
    await screen.findByLabelText('Assessment')
    await user.click(screen.getByRole('button', { name: 'Add medication action' }))
    await user.type(screen.getByPlaceholderText('Medication name'), 'Test medication')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(wardRoundApi.saveDraft).toHaveBeenCalledOnce())
    expect(wardRoundApi.saveDraft).toHaveBeenCalledWith('patient-1', expect.objectContaining({ actions: expect.objectContaining({ medications: [expect.objectContaining({ medication_name: 'Test medication', dose: '', frequency: '' })] }) }))
    await user.click(screen.getByRole('button', { name: /sign round/i }))
    expect(wardRoundApi.commit).not.toHaveBeenCalled()
  })

  it('uses the last confirmed version when retrying a partially failed draft save', async () => {
    vi.mocked(wardRoundApi.current).mockResolvedValue({ id: 'round-1', version: 7, status: 'draft', admission_case_id: 'admission-1', note_sections: { assessment: 'Improving' }, actions: [] })
    const error = Object.assign(new Error('Action not saved'), { confirmedDraftIdentity: { id: 'round-1', version: 9 } })
    vi.mocked(wardRoundApi.saveDraft).mockRejectedValueOnce(error).mockResolvedValueOnce({ id: 'round-1', version: 10 })
    const user = userEvent.setup()
    renderMode()
    await screen.findByLabelText('Assessment')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled())
    expect(screen.getByLabelText('Assessment')).toHaveValue('Improving')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(wardRoundApi.saveDraft).toHaveBeenCalledTimes(2))
    expect(wardRoundApi.saveDraft).toHaveBeenLastCalledWith('patient-1', expect.objectContaining({ ward_round_id: 'round-1', expected_version: 9 }))
  })

})
