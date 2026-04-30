import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FeatureBasedRoute } from '../FeatureBasedRoute'

vi.mock('@/hooks/useSystemQueries', () => ({
  useSystemCapabilities: vi.fn(),
}))

import { useSystemCapabilities } from '@/hooks/useSystemQueries'

function renderProtectedRoute(ui) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/protected" element={ui} />
        <Route path="/feature-unavailable" element={<div>Feature Unavailable</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('FeatureBasedRoute', () => {
  beforeEach(() => {
    useSystemCapabilities.mockReset()
    useSystemCapabilities.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: false,
    })
  })

  it('renders ungated children without waiting on capabilities', () => {
    renderProtectedRoute(
      <FeatureBasedRoute>
        <div>Open Content</div>
      </FeatureBasedRoute>,
    )

    expect(useSystemCapabilities).toHaveBeenCalledWith({ enabled: false })
    expect(screen.getByText('Open Content')).toBeInTheDocument()
  })

  it('shows a loader instead of gated content while capabilities load', () => {
    useSystemCapabilities.mockReturnValue({
      data: undefined,
      isLoading: true,
      isPending: true,
    })

    renderProtectedRoute(
      <FeatureBasedRoute features={['billing']}>
        <div>Billing Content</div>
      </FeatureBasedRoute>,
    )

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByText('Billing Content')).not.toBeInTheDocument()
  })

  it('renders gated children only when every feature is explicitly enabled', () => {
    useSystemCapabilities.mockReturnValue({
      data: { features: { billing: true, discharge_workflows: true } },
      isLoading: false,
      isPending: false,
    })

    renderProtectedRoute(
      <FeatureBasedRoute features={['billing', 'discharge_workflows']}>
        <div>Billing Content</div>
      </FeatureBasedRoute>,
    )

    expect(screen.getByText('Billing Content')).toBeInTheDocument()
  })

  it('redirects when any required feature is disabled', () => {
    useSystemCapabilities.mockReturnValue({
      data: { features: { billing: true, discharge_workflows: false } },
      isLoading: false,
      isPending: false,
    })

    renderProtectedRoute(
      <FeatureBasedRoute features={['billing', 'discharge_workflows']}>
        <div>Billing Content</div>
      </FeatureBasedRoute>,
    )

    expect(screen.getByText('Feature Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Billing Content')).not.toBeInTheDocument()
  })

  it('fails closed when loaded capabilities omit the feature map', () => {
    useSystemCapabilities.mockReturnValue({
      data: { capabilities: { billing: true } },
      isLoading: false,
      isPending: false,
    })

    renderProtectedRoute(
      <FeatureBasedRoute features={['billing']}>
        <div>Billing Content</div>
      </FeatureBasedRoute>,
    )

    expect(screen.getByText('Feature Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Billing Content')).not.toBeInTheDocument()
  })
})
