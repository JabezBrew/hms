import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderRoutes } from './renderRoutes'
import { ROUTE_LAYOUTS } from './routeTypes'

vi.mock('@/components/auth/FeatureBasedRoute', () => ({
  FeatureBasedRoute: ({ children }) => children,
}))

vi.mock('@/components/auth/RoleBasedRoute', () => ({
  RoleBasedRoute: ({ children }) => children,
}))

function renderRoute(route, initialEntry = route.path) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        {renderRoutes([route])}
        <Route path="/feature-unavailable" element={<div>Feature unavailable target</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('renderRoutes Rust V2 support metadata', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__
  })

  it('redirects Rust V2 users away from routes without a generated V2 contract', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderRoute({
      path: '/workflows/ward-round',
      component: () => <div>Ward round workflow</div>,
      roles: null,
      layout: ROUTE_LAYOUTS.BARE,
      rustV2Supported: false,
    })

    expect(screen.getByText('Feature unavailable target')).toBeInTheDocument()
    expect(screen.queryByText('Ward round workflow')).not.toBeInTheDocument()
  })

  it('keeps unsupported-in-Rust routes available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }

    renderRoute({
      path: '/workflows/ward-round',
      component: () => <div>Ward round workflow</div>,
      roles: null,
      layout: ROUTE_LAYOUTS.BARE,
      rustV2Supported: false,
    })

    expect(screen.getByText('Ward round workflow')).toBeInTheDocument()
  })
})
