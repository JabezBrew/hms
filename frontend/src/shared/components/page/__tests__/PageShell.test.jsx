import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PageShell } from '../PageShell'

describe('PageShell', () => {
  it('renders children', () => {
    const { getByText } = render(
      <PageShell>
        <div>Content</div>
      </PageShell>
    )
    expect(getByText('Content')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<PageShell className="custom-class" />)
    const shell = container.querySelector('[data-page-shell]')
    expect(shell).toHaveClass('custom-class')
  })
})
