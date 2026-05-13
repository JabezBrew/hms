import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import WorkflowLauncher from '../WorkflowLauncher'

vi.mock('@/features/workflows/hooks', () => ({
  useWardRoundWorkflow: () => ({
    startWardRound: { isPending: false, mutateAsync: vi.fn() },
  }),
  useDischargeWorkflow: () => ({
    startDischarge: { isPending: false, mutateAsync: vi.fn() },
  }),
}))

describe('WorkflowLauncher Rust V2 guard', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__
  })

  it('does not expose the standalone workflow launcher in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    const { container } = render(<WorkflowLauncher workflowType="ward-round" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the standalone workflow launcher available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }

    render(<WorkflowLauncher workflowType="ward-round" />)

    expect(screen.getByRole('button', { name: 'Start Ward Round' })).toBeInTheDocument()
  })
})
