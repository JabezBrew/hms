import { render, screen } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb'
import OpsDashboardPage from '../OpsDashboardPage'
import { useOpsDashboard } from '@/features/ops/hooks'

vi.mock('@/features/ops/hooks', () => ({
  useOpsDashboard: vi.fn(),
}))

const mockUseOpsDashboard = vi.mocked(useOpsDashboard)

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

const dashboardFixture = {
  generated_at: '2026-05-23T10:25:00Z',
  budgets: [
    { key: 'api-p99', label: 'API p99', value: '188 ms', target: '<= 200 ms', status: 'pass' },
    { key: 'db-pool', label: 'DB pool pressure', value: '76%', target: '< 70%', status: 'warn' },
    { key: 'payload', label: 'Payload p99', value: '260 KB', target: '< 128 KB', status: 'fail' },
  ],
  performance: {
    routes: [
      {
        route: 'GET /api/v2/patients/John-Doe/chronicle?debug=true',
        p95_ms: 118,
        p99_ms: 188,
        requests: 1240,
        error_rate: 0.004,
        payload_p95_kb: 64,
        payload_p99_kb: 128,
        raw_sql: 'SELECT * FROM patient_records WHERE mrn = "MRN-12345"',
        request_body: { patient_name: 'Ama Mensah', clinical_text: 'chest pain' },
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
    },
  },
  database: {
    pool: {
      used: 14,
      max: 20,
      pressure_percent: 70,
      wait_p95_ms: 18,
      waiters: 0,
      status: 'warn',
    },
  },
  frontend: {
    rum: {
      app_shell_p95_ms: 820,
      browser_api_p95_ms: 210,
      browser_api_p99_ms: 420,
      sample_count: 540,
      status: 'pass',
      raw_log_search: 'MRN-12345 SELECT patient_name',
    },
  },
  deploys: {
    environment: 'staging',
    version: '1.8.2',
    commit: 'a1b2c3d4e5f67890',
    deployed_at: '2026-05-23T09:50:00Z',
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

describe('OpsDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a loading state', () => {
    mockUseOpsDashboard.mockReturnValue(queryState({ isLoading: true }))

    renderOpsDashboard()

    expect(screen.getByRole('heading', { name: 'Ops Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('renders an error state with retry action', () => {
    mockUseOpsDashboard.mockReturnValue(queryState({
      isError: true,
      error: new Error('ops endpoint unavailable'),
    }))

    renderOpsDashboard()

    expect(screen.getByText('Unable to load ops dashboard')).toBeInTheDocument()
    expect(screen.getByText('The Rust V2 ops endpoint did not return a dashboard snapshot.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('renders success data without exposing raw PHI, SQL, logs, request bodies, or PromQL', () => {
    mockUseOpsDashboard.mockReturnValue(queryState({ data: dashboardFixture }))

    const { container } = renderOpsDashboard()

    expect(screen.getByText('API p99')).toBeInTheDocument()
    expect(screen.getByText('DB pool pressure')).toBeInTheDocument()
    expect(screen.getAllByText('Payload p99').length).toBeGreaterThan(0)
    expect(screen.getByText('GET /api/v2/patients/:redacted/chronicle')).toBeInTheDocument()
    expect(screen.getAllByText('92.5%').length).toBeGreaterThan(0)
    expect(screen.getByText('App shell p95')).toBeInTheDocument()
    expect(screen.getByText('hms-api')).toBeInTheDocument()
    expect(screen.getAllByText('1.8.2')).toHaveLength(2)
    expect(screen.getAllByText('a1b2c3d4e5f6')).toHaveLength(2)

    expect(screen.getAllByText('PASS').length).toBeGreaterThan(0)
    expect(screen.getAllByText('WARN').length).toBeGreaterThan(0)
    expect(screen.getAllByText('FAIL').length).toBeGreaterThan(0)

    const renderedText = container.textContent
    expect(renderedText).not.toContain('John-Doe')
    expect(renderedText).not.toContain('Ama Mensah')
    expect(renderedText).not.toContain('MRN-12345')
    expect(renderedText).not.toContain('chest pain')
    expect(renderedText).not.toContain('SELECT')
    expect(renderedText).not.toContain('patient_records')
    expect(renderedText).not.toContain('request_body')
    expect(renderedText).not.toContain('raw_log_search')
    expect(renderedText).not.toContain('PromQL')
    expect(renderedText).not.toContain('rate(http_request_duration_seconds_bucket')
  })
})
