import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import SystemJobsPage from '../SystemJobsPage'
import { useSystemJobs } from '@/features/admin/hooks'

vi.mock('@/features/admin/hooks', async () => {
  const actual = await vi.importActual('@/features/admin/hooks')
  return {
    ...actual,
    useSystemJobs: vi.fn(),
  }
})

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}))

const mockUseSystemJobs = vi.mocked(useSystemJobs)

function renderPage() {
  return render(
    <MemoryRouter>
      <SystemJobsPage />
    </MemoryRouter>
  )
}

describe('SystemJobsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders worker and queue aggregates from the operability snapshot', () => {
    mockUseSystemJobs.mockReturnValue({
      data: {
        facility_scope: 'HQ',
        health: {
          database: { status: 'connected', latency_seconds: 0.012 },
          cache: { status: 'connected', latency_seconds: 0.004 },
        },
        celery: {
          worker_count: 2,
          workers: {
            'worker@api-1': {
              active_count: 1,
              scheduled_count: 2,
              reserved_count: 0,
              pool_max_concurrency: 4,
              uptime_seconds: 7200,
              processed_total: 42,
            },
            'worker@api-2': {
              active_count: 0,
              scheduled_count: 0,
              reserved_count: 1,
              pool_max_concurrency: 4,
              uptime_seconds: 3600,
              processed_total: 21,
            },
          },
          queue_depths: {
            default: 3,
            exports: 0,
          },
          aggregates: {
            active_tasks: 1,
            scheduled_tasks: 2,
            reserved_tasks: 1,
            queue_depth_total: 3,
          },
        },
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
      dataUpdatedAt: Date.UTC(2026, 2, 29, 10, 30, 0),
    })

    renderPage()

    expect(screen.getByText('Background Jobs')).toBeInTheDocument()
    expect(screen.getByText('Visible workers')).toBeInTheDocument()
    expect(screen.getByText('Queued tasks')).toBeInTheDocument()
    expect(screen.getByText('worker@api-1')).toBeInTheDocument()
    expect(screen.getByText('default')).toBeInTheDocument()
    expect(screen.getAllByText('Inspect responsive')).toHaveLength(2)
  })

  it('raises a stalled-work alert when queues back up without workers', () => {
    mockUseSystemJobs.mockReturnValue({
      data: {
        facility_scope: 'HQ',
        health: {
          database: { status: 'connected', latency_seconds: 0.02 },
          cache: { status: 'connected', latency_seconds: 0.01 },
        },
        celery: {
          worker_count: 0,
          workers: {},
          queue_depths: {
            default: 7,
          },
          aggregates: {
            active_tasks: 0,
            scheduled_tasks: 0,
            reserved_tasks: 0,
            queue_depth_total: 7,
          },
        },
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
      dataUpdatedAt: Date.UTC(2026, 2, 29, 10, 30, 0),
    })

    renderPage()

    expect(screen.getByText('No Celery workers visible')).toBeInTheDocument()
    expect(screen.getByText('Queued work is stalled')).toBeInTheDocument()
    expect(screen.getByText('Stalled')).toBeInTheDocument()
  })
})
