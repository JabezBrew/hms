import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import RuntimeErrorGuard from '../RuntimeErrorGuard'

describe('RuntimeErrorGuard', () => {
  const originalDiagnostics = globalThis.window.__HMS_RUNTIME_DIAGNOSTICS__

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_DIAGNOSTICS__ = undefined
  })

  afterEach(() => {
    globalThis.window.__HMS_RUNTIME_DIAGNOSTICS__ = originalDiagnostics
  })

  it('publishes sanitized diagnostics for the current route', async () => {
    render(
      <MemoryRouter initialEntries={['/patients/123e4567-e89b-12d3-a456-426614174000/chronicle?action=note']}>
        <RuntimeErrorGuard appState="authenticated">
          <div>Healthy UI</div>
        </RuntimeErrorGuard>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(globalThis.window.__HMS_RUNTIME_DIAGNOSTICS__.location.pathname).toBe(
        '/patients/:id/chronicle',
      )
    })
  })

  it('shows a recovery screen when a chunk load rejection occurs', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <MemoryRouter initialEntries={['/patients/123e4567-e89b-12d3-a456-426614174000/chronicle']}>
        <RuntimeErrorGuard appState="authenticated">
          <div>Healthy UI</div>
        </RuntimeErrorGuard>
      </MemoryRouter>,
    )

    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', {
      configurable: true,
      value: new Error('Failed to fetch dynamically imported module'),
    })

    globalThis.window.dispatchEvent(event)

    expect(await screen.findByText('Frontend update required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload HMS' })).toBeInTheDocument()

    consoleErrorSpy.mockRestore()
  })
})
