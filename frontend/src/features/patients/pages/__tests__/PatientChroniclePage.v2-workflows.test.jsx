import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PatientChroniclePage from '../PatientChroniclePage'
import { SidebarProvider } from '@/components/ui/sidebar'

const patientHookState = vi.hoisted(() => ({
  data: {
    id: 'patient-1',
    name: 'Ama Mensah',
    access: { clinical: true },
    current_admission_id: 'admission-1',
    local_data: {
      id: 'patient-1',
      medical_record_number: 'MRN-001',
      current_admission_id: 'admission-1',
    },
  },
}))

const chronicleHookState = vi.hoisted(() => ({
  calls: [],
  data: {
    active_medications: [],
    allergies: [],
    active_encounter: {
      id: 'encounter-1',
      admission_id: 'admission-1',
    },
  },
}))

const chronicleStartupState = vi.hoisted(() => ({
  calls: [],
  data: {
    patient: {
      id: 'patient-1',
      name: 'Ama Mensah',
      local_data: {
        id: 'patient-1',
        medical_record_number: 'MRN-001',
      },
    },
    active_medications: [],
    allergies: [],
    problems: [],
    lab_results: [],
    active_encounter: {
      id: 'encounter-1',
      admission_id: 'admission-1',
      encounter_type: 'inpatient',
      status: 'in-progress',
    },
    active_admission: {
      admission_id: 'admission-1',
      ward_id: 'ward-1',
      ward_name: 'Ward A',
      bed_code: 'B1',
    },
    timeline: {
      results: [],
      has_next: false,
      next_cursor: null,
      page_size: 20,
      count: 0,
    },
  },
  error: null,
}))

const timelineHookState = vi.hoisted(() => ({
  calls: [],
  entries: [],
  totalCount: 0,
  returnNoDataWhenDisabled: false,
}))

const workspaceHostState = vi.hoisted(() => ({
  lastProps: null,
}))

const summarySidebarState = vi.hoisted(() => ({
  lastProps: null,
}))

vi.mock('@/features/patients/hooks/usePatientQueries', () => ({
  patientKeys: {
    chronicleTimeline: (id, params = {}) => ['patients', 'detail', id, 'chronicle', 'timeline', params],
  },
  usePatient: (_id, _options) => ({
    data: patientHookState.data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePatientChronicleStartup: (patientId, params, options) => {
    chronicleStartupState.calls.push({ patientId, params, options })
    return {
      data: chronicleStartupState.data,
      isLoading: false,
      error: chronicleStartupState.error,
      refetch: vi.fn(),
    }
  },
  usePatientChronicleTimeline: (patientId, params, options) => {
    timelineHookState.calls.push({ patientId, params, options })
    const data = options?.enabled === false && timelineHookState.returnNoDataWhenDisabled
      ? undefined
      : {
          pages: [{
            results: timelineHookState.entries,
            count: timelineHookState.totalCount || timelineHookState.entries.length,
          }],
        }

    return {
      data,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      refetch: vi.fn(),
    }
  },
}))

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { role: 'admin', user_type: 'doctor' },
  }),
}))

vi.mock('@/hooks/useTimelineQueries', () => ({
  usePatientTimeline: () => ({
    data: { pages: [{ results: [] }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
  flattenTimelinePages: (data) => data?.pages?.flatMap((page) => page.results || []) || [],
  getTimelineTotalCount: (data) => data?.pages?.[0]?.count || 0,
  useInvalidateTimeline: () => vi.fn(),
}))

vi.mock('@/features/encounters/hooks/useEncounterQueries', () => ({
  usePatientEncounters: () => ({
    data: [{
      id: 'encounter-1',
      admission_id: 'admission-1',
      encounter_type: 'inpatient',
      status: 'in-progress',
    }],
    isLoading: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/useChronicleContext', () => ({
  useChronicleContext: (patientId, options) => {
    chronicleHookState.calls.push({ patientId, options })
    return {
      data: chronicleHookState.data,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }
  },
}))

vi.mock('@/features/billing/hooks', () => ({
  usePatientInsurance: () => ({ data: { results: [] } }),
}))

vi.mock('@/hooks/useSystemQueries', () => ({
  useSystemCapabilities: () => ({
    data: {
      features: {
        patient_chronicle: true,
        wards: true,
        inpatient_admissions: true,
        nursing_workflows: true,
        ward_task_board: true,
        discharge_workflows: true,
      },
    },
  }),
}))

vi.mock('@/components/chronicle/PatientIdentityHero', () => ({
  default: ({ onAskChronicle, onStartWardRound, onStartDischarge }) => (
    <div>
      <span data-testid="ask-chronicle-action">{String(Boolean(onAskChronicle))}</span>
      <span data-testid="ward-round-action">{String(Boolean(onStartWardRound))}</span>
      <span data-testid="discharge-action">{String(Boolean(onStartDischarge))}</span>
    </div>
  ),
}))

vi.mock('@/features/patients/components/ChronicleWorkspaceHost', () => ({
  default: (props) => {
    workspaceHostState.lastProps = props
    return <div data-testid="active-workspace">{props.activeWorkspace || 'none'}</div>
  },
}))

vi.mock('@/features/patients/chronicle/ward-round/WardRoundMode', () => ({
  default: ({ admission }) => (
    <div data-testid="ward-round-mode">
      Ward Round Mode {admission ? 'with admission' : 'without admission'}
    </div>
  ),
}))

vi.mock('@/components/chronicle/ClinicalSummarySidebar', () => ({
  default: (props) => {
    summarySidebarState.lastProps = props
    return <div>Clinical summary</div>
  },
}))

vi.mock('@/components/chronicle/TimelineEntry', () => ({
  default: () => <div>Timeline entry</div>,
}))

vi.mock('@/components/chronicle/BreakGlassDialog', () => ({
  default: () => null,
}))

vi.mock('@/features/discharge/components/DischargeCasePanel', () => ({
  DischargeCasePanel: () => <div>Discharge case panel</div>,
}))

vi.mock('@/features/problems', () => ({
  ProblemListSidebar: () => <div>Problem list</div>,
}))

vi.mock('@/features/patients/chronicle/workspaceRegistry', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    prefetchChronicleWorkspaceResources: vi.fn(),
  }
})

vi.mock('@/features/onboarding', () => ({
  emitOnboardingEvent: vi.fn(),
}))

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}))

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value) => value,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

function renderPage(initialEntry = '/patients/patient-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/patients/:id" element={<PatientChroniclePage />} />
            <Route path="/patients/:id/ward-round" element={<PatientChroniclePage defaultAction="ward_round" />} />
          </Routes>
        </MemoryRouter>
      </SidebarProvider>
    </QueryClientProvider>
  )
}

describe('PatientChroniclePage Rust V2 workflow guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chronicleHookState.calls = []
    chronicleStartupState.calls = []
    timelineHookState.calls = []
    timelineHookState.entries = []
    timelineHookState.totalCount = 0
    timelineHookState.returnNoDataWhenDisabled = false
    chronicleHookState.data = {
      active_medications: [],
      allergies: [],
      active_encounter: {
        id: 'encounter-1',
        admission_id: 'admission-1',
      },
    }
    chronicleStartupState.data = {
      patient: {
        id: 'patient-1',
        name: 'Ama Mensah',
        local_data: {
          id: 'patient-1',
          medical_record_number: 'MRN-001',
        },
      },
      active_medications: [],
      allergies: [],
      problems: [],
      lab_results: [],
      active_encounter: {
        id: 'encounter-1',
        admission_id: 'admission-1',
        encounter_type: 'inpatient',
        status: 'in-progress',
      },
      active_admission: {
        admission_id: 'admission-1',
        ward_id: 'ward-1',
        ward_name: 'Ward A',
        bed_code: 'B1',
      },
      timeline: {
        results: [],
        has_next: false,
        next_cursor: null,
        page_size: 20,
        count: 0,
      },
    }
    chronicleStartupState.error = null
    workspaceHostState.lastProps = null
    summarySidebarState.lastProps = null
    patientHookState.data = {
      id: 'patient-1',
      name: 'Ama Mensah',
      access: { clinical: true },
      current_admission_id: 'admission-1',
      local_data: {
        id: 'patient-1',
        medical_record_number: 'MRN-001',
        current_admission_id: 'admission-1',
      },
    }
  })

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__
  })

  it('exposes Ward Round mode but not standalone discharge workflow actions in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage()

    expect(screen.getByTestId('ward-round-action')).toHaveTextContent('true')
    expect(screen.getByTestId('discharge-action')).toHaveTextContent('false')
  })

  it('does not expose the intentionally deferred Chronicle copilot action in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage()

    expect(screen.getByTestId('ask-chronicle-action')).toHaveTextContent('false')
  })

  it('allows Rust V2 clinical reads when the legacy access envelope is absent', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    patientHookState.data = {
      id: 'patient-1',
      name: 'Ama Mensah',
      local_data: {
        id: 'patient-1',
        medical_record_number: 'MRN-001',
      },
    }

    renderPage()

    expect(chronicleStartupState.calls.at(-1)).toEqual(
      expect.objectContaining({
        patientId: 'patient-1',
        options: expect.objectContaining({ enabled: true }),
      }),
    )
    expect(chronicleHookState.calls.at(-1)).toEqual(
      expect.objectContaining({
        patientId: 'patient-1',
        options: expect.objectContaining({ enabled: false }),
      }),
    )
  })

  it('threads the Rust V2 active admission into Chronicle workspace patient context', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    patientHookState.data = {
      id: 'patient-1',
      name: 'Ama Mensah',
      local_data: {
        id: 'patient-1',
        medical_record_number: 'MRN-001',
      },
    }
    chronicleStartupState.data = {
      ...chronicleStartupState.data,
      active_admission: {
        admission_id: 'admission-v2',
        ward_id: 'ward-v2',
        ward_name: 'V2 Ward',
        bed_code: 'B12',
      },
      active_context: {
        admission: {
          admission_id: 'admission-v2',
          ward_id: 'ward-v2',
          ward_name: 'V2 Ward',
          bed_code: 'B12',
        },
      },
      patient: {
        id: 'patient-1',
        name: 'Ama Mensah',
        local_data: {
          id: 'patient-1',
          medical_record_number: 'MRN-001',
        },
      },
    }

    renderPage('/patients/patient-1?action=add_prescription')

    await waitFor(() => {
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('prescription')
    })
    expect(workspaceHostState.lastProps.workspaceContext.patient.local_data).toEqual(
      expect.objectContaining({
        current_admission_id: 'admission-v2',
        current_ward_id: 'ward-v2',
        current_ward: 'V2 Ward',
        current_bed: 'B12',
      }),
    )
  })

  it('renders Ward Round as Chronicle mode from URL actions without opening the legacy slide-over', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage('/patients/patient-1?action=ward_round')

    await waitFor(() => {
      expect(screen.getByTestId('ward-round-mode')).toHaveTextContent('Ward Round Mode')
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('none')
    })
  })

  it('renders canonical Ward Round mode inside the Chronicle frame without the timeline', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage('/patients/patient-1?mode=ward-round')

    expect(screen.getByText('Clinical summary')).toBeInTheDocument()
    expect(await screen.findByTestId('ward-round-mode')).toBeInTheDocument()
    expect(screen.queryByText('Clinical Chronicle')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-workspace')).toHaveTextContent('none')
  })

  it('renders the legacy alias as the same Ward Round Chronicle mode in Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage('/patients/patient-1/ward-round')

    expect(await screen.findByTestId('ward-round-mode')).toHaveTextContent('with admission')
    expect(screen.getByTestId('active-workspace')).toHaveTextContent('none')
  })

  it('passes recent vitals and lab results as separate sidebar sections', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    chronicleStartupState.data = {
      ...chronicleStartupState.data,
      latest_vitals: {
        id: 'vitals-1',
        recorded_at: '2026-05-12T08:40:00Z',
        temperature: '37.2',
        heart_rate: '88',
      },
      lab_results: [{
        id: 'lab-1',
        test_name: 'WBC',
        value: '6.1',
        unit: '10^9/L',
        entered_at: '2026-05-12T09:10:00Z',
      }],
    }

    renderPage()

    await waitFor(() => {
      expect(summarySidebarState.lastProps?.vitals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Temp', value: '37.2' }),
          expect.objectContaining({ name: 'HR', value: '88' }),
        ]),
      )
    })
    expect(summarySidebarState.lastProps.labResults).toEqual([
      expect.objectContaining({ name: 'WBC', value: '6.1' }),
    ])
    expect(summarySidebarState.lastProps.vitals).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'WBC' })]),
    )
  })

  it('fetches the authoritative Rust timeline when the startup all-history seed is empty', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    chronicleStartupState.data = {
      ...chronicleStartupState.data,
      timeline: {
        results: [],
        has_next: false,
        next_cursor: null,
        page_size: 20,
        count: 0,
      },
    }

    renderPage()

    expect(timelineHookState.calls.at(-1)).toEqual(
      expect.objectContaining({
        patientId: 'patient-1',
        params: expect.objectContaining({
          type: 'all',
          limit: 20,
          encounterId: undefined,
        }),
        options: expect.objectContaining({
          enabled: true,
          initialPage: undefined,
        }),
      }),
    )
  })

  it('renders the Rust startup timeline when the disabled infinite query has no materialized pages', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    timelineHookState.returnNoDataWhenDisabled = true
    chronicleStartupState.data = {
      ...chronicleStartupState.data,
      timeline: {
        results: [{
          id: 'problem-1',
          type: 'problem',
          entry_type: 'problem',
          title: 'Hypertension',
          content: 'Hypertension',
          timestamp: '2026-05-12T09:00:00Z',
          data: { name: 'Hypertension' },
        }],
        has_next: true,
        next_cursor: 'cursor-2',
        page_size: 20,
        count: 20,
      },
    }

    renderPage()

    expect(timelineHookState.calls.at(-1)).toEqual(
      expect.objectContaining({
        patientId: 'patient-1',
        options: expect.objectContaining({
          enabled: false,
          initialPage: expect.objectContaining({
            results: expect.arrayContaining([
              expect.objectContaining({ id: 'problem-1' }),
            ]),
          }),
        }),
      }),
    )
    expect(screen.getByText('Timeline entry')).toBeInTheDocument()
    expect(screen.getByText('20 entries')).toBeInTheDocument()
  })

  it('uses entry timestamps for visit group dates when encounter metadata has no start time', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    timelineHookState.entries = [{
      id: 'note-1',
      type: 'progress_note',
      entry_type: 'note',
      encounter_id: 'encounter-1',
      title: 'Morning review',
      timestamp: '2026-05-12T09:00:00Z',
      data: { assessment: 'Stable overnight' },
    }]
    timelineHookState.totalCount = 1

    renderPage()

    expect(screen.getByText('May 12, 2026')).toBeInTheDocument()
    expect(screen.queryByText('Unknown date')).not.toBeInTheDocument()
  })

  it('does not expose unsupported break-glass access in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    chronicleStartupState.data = null
    chronicleStartupState.error = { status: 403, message: 'Forbidden' }

    renderPage()

    expect(screen.queryByRole('button', { name: /request break-glass access/i })).not.toBeInTheDocument()
    expect(screen.getByText(/break-glass access is not available in rust v2/i)).toBeInTheDocument()
  })

  it('uses Ward Round Chronicle mode outside Rust V2 mode instead of the legacy workflow slide-over', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }

    renderPage('/patients/patient-1?action=ward_round')

    expect(screen.getByTestId('ask-chronicle-action')).toHaveTextContent('true')
    expect(screen.getByTestId('ward-round-action')).toHaveTextContent('true')
    expect(screen.getByTestId('discharge-action')).toHaveTextContent('true')
    await waitFor(() => {
      expect(screen.getByTestId('ward-round-mode')).toBeInTheDocument()
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('none')
    })
  })
})
