import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb'
import OpsDashboardPage from '../OpsDashboardPage'
import {
  useOpsDatabase,
  useOpsFrontend,
  useOpsOverview,
  useOpsPerformance,
} from '@/features/ops/hooks'

const opsHostMock = vi.hoisted(() => ({ allowed: true }))

vi.mock('@/features/ops/hooks', () => ({
  useOpsOverview: vi.fn(),
  useOpsPerformance: vi.fn(),
  useOpsDatabase: vi.fn(),
  useOpsFrontend: vi.fn(),
}))

vi.mock('@/features/ops/host', () => ({
  isOpsDashboardHost: vi.fn(() => opsHostMock.allowed),
}))

const mockUseOpsOverview = vi.mocked(useOpsOverview)
const mockUseOpsPerformance = vi.mocked(useOpsPerformance)
const mockUseOpsDatabase = vi.mocked(useOpsDatabase)
const mockUseOpsFrontend = vi.mocked(useOpsFrontend)

function renderOpsDashboard() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/system/ops']}>
        <BreadcrumbProvider>
          <OpsDashboardPage />
        </BreadcrumbProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

function queryState(overrides) {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }
}

const performanceFixture = {
  routes: [
    {
      route: 'GET /api/v2/patients/John-Doe/chronicle?debug=true',
      status_bucket: '5xx',
      p50_ms: 60,
      p95_ms: 118,
      p99_ms: 388,
      requests: 1240,
      error_rate: 0.004,
      payload_p95_kb: 64,
      payload_p99_kb: 128,
      raw_sql: 'SELECT * FROM patient_records WHERE mrn = "MRN-12345"',
      request_body: { patient_name: 'Ama Mensah', clinical_text: 'chest pain' },
    },
    {
      route: 'GET /api/v2/ops/overview',
      status_bucket: '2xx',
      p50_ms: 20,
      p95_ms: 44,
      p99_ms: 52,
      requests: 80,
    },
  ],
  request_context_cache: {
    hit_ratio: 0.925,
    hits: 9250,
    misses: 750,
  },
  payloads: {
    p95_kb: 64,
    p99_kb: 128,
    status: 'pass',
  },
}

const databaseFixture = {
  pool: {
    used: 14,
    max: 20,
    pressure: 0.7,
    wait_p95_ms: 18,
    waiters: 0,
    status: 'warn',
  },
  slow_query_fingerprints: [
    {
      fingerprint: 'SELECT * FROM patients WHERE email = "ama@example.com"',
      count: 3,
      avg_ms: 290,
      p95_ms: 420,
      p99_ms: 510,
      status: 'fail',
    },
  ],
}

const frontendFixture = {
  rum_enabled: true,
  rum: {
    app_shell_p95_ms: 820,
    browser_api_p95_ms: 210,
    browser_api_p99_ms: 920,
    sample_count: 540,
    status: 'pass',
    raw_log_search: 'MRN-12345 SELECT patient_name',
  },
  routes: [
    {
      route: '/patients/Ama-Mensah/chronicle?body=free-text',
      status_bucket: '2xx',
      p50_ms: 40,
      p95_ms: 120,
      p99_ms: 180,
      requests: 20,
    },
  ],
}

const dashboardFixture = {
  generated_at: '2026-05-23T10:25:00Z',
  source: {
    notes: [
      {
        key: 'historical_windows',
        status: 'warn',
        note: 'SELECT MRN-12345 FROM raw logs',
      },
    ],
  },
  budgets: [
    { key: 'api-p99', label: 'API p99', value: '188 ms', target: '<= 200 ms', status: 'pass' },
    { key: 'db-pool', label: 'DB pool pressure', value: '76%', target: '< 70%', status: 'warn' },
    { key: 'payload', label: 'Payload p99', value: '260 KB', target: '< 128 KB', status: 'fail' },
  ],
  performance: performanceFixture,
  database: databaseFixture,
  frontend: frontendFixture,
  deploys: {
    environment: 'staging',
    version: '1.8.2',
    commit: 'a1b2c3d4e5f67890',
    deployed_at: '2026-05-23T09:50:00Z',
    status: 'pass',
    services: [
      {
        name: 'hms-api',
        status: 'healthy',
        latency_ms: 19,
        version: '1.8.2',
        commit: 'a1b2c3d4e5f67890',
        promql: 'sum(rate(http_request_duration_seconds_bucket{patient="Ama"}[5m]))',
      },
    ],
  },
}

function assertNoUnsafeText(container) {
  const renderedText = container.textContent
  expect(renderedText).not.toContain('John-Doe')
  expect(renderedText).not.toContain('Ama Mensah')
  expect(renderedText).not.toContain('Ama-Mensah')
  expect(renderedText).not.toContain('ama@example.com')
  expect(renderedText).not.toContain('MRN-12345')
  expect(renderedText).not.toContain('chest pain')
  expect(renderedText).not.toContain('SELECT')
  expect(renderedText).not.toContain('patient_records')
  expect(renderedText).not.toContain('request_body')
  expect(renderedText).not.toContain('raw_log_search')
  expect(renderedText).not.toContain('PromQL')
  expect(renderedText).not.toContain('rate(http_request_duration_seconds_bucket')
  expect(renderedText).not.toContain('free-text')
}

describe('OpsDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    opsHostMock.allowed = true
    mockUseOpsOverview.mockReturnValue(queryState({ data: dashboardFixture }))
    mockUseOpsPerformance.mockReturnValue(queryState({ data: performanceFixture }))
    mockUseOpsDatabase.mockReturnValue(queryState({ data: databaseFixture }))
    mockUseOpsFrontend.mockReturnValue(queryState({ data: frontendFixture }))
  })

  it('does not load dashboard data on non-ops hosts', () => {
    opsHostMock.allowed = false

    renderOpsDashboard()

    expect(mockUseOpsOverview).toHaveBeenCalledWith({ window: '15m' }, { enabled: false })
    expect(mockUseOpsPerformance).toHaveBeenCalledWith({ window: '15m' }, { enabled: false })
    expect(mockUseOpsDatabase).toHaveBeenCalledWith({ window: '15m' }, { enabled: false })
    expect(mockUseOpsFrontend).toHaveBeenCalledWith({ window: '15m' }, { enabled: false })
    expect(screen.getByText('Not found')).toBeInTheDocument()
    expect(screen.getByText('This page is not available on this host.')).toBeInTheDocument()
  })

  it('renders a loading state', () => {
    mockUseOpsOverview.mockReturnValue(queryState({ isLoading: true }))

    renderOpsDashboard()

    expect(screen.getByRole('heading', { name: 'Ops Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('renders an error state with retry action', () => {
    mockUseOpsOverview.mockReturnValue(queryState({
      isError: true,
      error: new Error('ops endpoint unavailable'),
    }))

    renderOpsDashboard()

    expect(screen.getByText('Unable to load ops dashboard')).toBeInTheDocument()
    expect(screen.getByText('The Rust V2 ops endpoint did not return a dashboard snapshot.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('renders tabs and time-window controls without exposing raw telemetry or PHI', async () => {
    const user = userEvent.setup()
    const { container } = renderOpsDashboard()

    expect(screen.getByRole('heading', { name: 'Ops Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /overview/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '5m' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '6h' })).toBeInTheDocument()
    expect(screen.getByText('historical_windows')).toBeInTheDocument()
    expect(screen.getByText(/Fixed windows are selected in the UI/)).toBeInTheDocument()
    assertNoUnsafeText(container)

    await user.click(screen.getByRole('tab', { name: /routes/i }))
    expect(screen.getByRole('tab', { name: /routes/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('GET /api/v2/patients/:id/chronicle')).toBeInTheDocument()
    assertNoUnsafeText(container)

    await user.click(screen.getByRole('tab', { name: /database/i }))
    expect(screen.getByText('Pool Pressure')).toBeInTheDocument()
    expect(screen.getByText('_redacted_query_fingerprint_1')).toBeInTheDocument()
    assertNoUnsafeText(container)

    await user.click(screen.getByRole('tab', { name: /frontend/i }))
    expect(screen.getByText('Browser API p99')).toBeInTheDocument()
    expect(screen.getByText('/patients/:id/chronicle')).toBeInTheDocument()
    assertNoUnsafeText(container)

    await user.click(screen.getByRole('tab', { name: /deploys/i }))
    expect(screen.getByText('hms-api')).toBeInTheDocument()
    expect(screen.getAllByText('1.8.2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('a1b2c3d4e5f6').length).toBeGreaterThan(0)
    assertNoUnsafeText(container)

    await user.click(screen.getByRole('tab', { name: /incidents/i }))
    expect(screen.getByText('Service Errors / Incidents')).toBeInTheDocument()
    expect(screen.getByText('Failed signals')).toBeInTheDocument()
    assertNoUnsafeText(container)
  })

  it('threads active tab and selected window into ops queries', async () => {
    const user = userEvent.setup()
    renderOpsDashboard()

    await user.click(screen.getByRole('button', { name: '6h' }))

    expect(mockUseOpsOverview).toHaveBeenLastCalledWith({ window: '6h' }, { enabled: true })
    expect(mockUseOpsPerformance).toHaveBeenLastCalledWith({ window: '6h' }, { enabled: false })

    await user.click(screen.getByRole('tab', { name: /routes/i }))
    expect(mockUseOpsPerformance).toHaveBeenLastCalledWith({ window: '6h' }, { enabled: true })

    await user.click(screen.getByRole('tab', { name: /database/i }))
    expect(mockUseOpsDatabase).toHaveBeenLastCalledWith({ window: '6h' }, { enabled: true })

    await user.click(screen.getByRole('tab', { name: /frontend/i }))
    expect(mockUseOpsFrontend).toHaveBeenLastCalledWith({ window: '6h' }, { enabled: true })
  })
})
