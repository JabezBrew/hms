import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PatientChroniclePage from '../PatientChroniclePage'
import { SidebarProvider } from '@/components/ui/sidebar'

vi.mock('@/features/patients/hooks/usePatientQueries', () => ({
  usePatient: () => ({
    data: {
      id: 'patient-1',
      name: 'Ama Mensah',
      access: { clinical: true },
      current_admission_id: 'admission-1',
      local_data: {
        id: 'patient-1',
        current_admission_id: 'admission-1',
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
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
  flattenTimelinePages: () => [],
  getTimelineTotalCount: () => 0,
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
  useChronicleContext: () => ({
    data: {
      active_medications: [],
      allergies: [],
      active_encounter: {
        id: 'encounter-1',
        admission_id: 'admission-1',
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
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
  default: ({ onStartWardRound, onStartDischarge }) => (
    <div>
      <span data-testid="ward-round-action">{String(Boolean(onStartWardRound))}</span>
      <span data-testid="discharge-action">{String(Boolean(onStartDischarge))}</span>
    </div>
  ),
}))

vi.mock('@/features/patients/components/ChronicleWorkspaceHost', () => ({
  default: ({ activeWorkspace }) => (
    <div data-testid="active-workspace">{activeWorkspace || 'none'}</div>
  ),
}))

vi.mock('@/components/chronicle/ClinicalSummarySidebar', () => ({
  default: () => <div>Clinical summary</div>,
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
          </Routes>
        </MemoryRouter>
      </SidebarProvider>
    </QueryClientProvider>
  )
}

describe('PatientChroniclePage Rust V2 workflow guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__
  })

  it('does not expose standalone ward-round or discharge workflow actions in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage()

    expect(screen.getByTestId('ward-round-action')).toHaveTextContent('false')
    expect(screen.getByTestId('discharge-action')).toHaveTextContent('false')
  })

  it('does not auto-open the unsupported ward-round workflow from URL actions in Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage('/patients/patient-1?action=ward_round')

    await waitFor(() => {
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('none')
    })
  })

  it('keeps legacy ward-round workflow actions available outside Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }

    renderPage('/patients/patient-1?action=ward_round')

    expect(screen.getByTestId('ward-round-action')).toHaveTextContent('true')
    expect(screen.getByTestId('discharge-action')).toHaveTextContent('true')
    await waitFor(() => {
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('wardRound')
    })
  })
})
