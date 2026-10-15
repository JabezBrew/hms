import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { PageLoader, PageState } from '../PageState'

describe('PageState', () => {
  it('renders loading state', () => {
    const { container, getByRole, getByText } = render(<PageState variant="loading" />)
    expect(getByText('Loading')).toBeInTheDocument()
    expect(getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(container.querySelector('[data-slot="loading-spinner"]')).toBeInTheDocument()
  })

  it('renders error state with action', () => {
    const onRetry = vi.fn()
    const { getByText } = render(
      <PageState variant="error" title="Error" description="Oops" action={onRetry} />
    )
    expect(getByText('Error')).toBeInTheDocument()
    fireEvent.click(getByText('Retry'))
    expect(onRetry).toHaveBeenCalled()
  })

  it('renders empty state', () => {
    const { getByText } = render(<PageState variant="empty" />)
    expect(getByText('No results')).toBeInTheDocument()
  })

  it('keeps loading announcements when a feature supplies custom placeholders', () => {
    const { getByRole, getByText } = render(
      <PageState variant="loading" title="Loading worklist">
        <div>Custom placeholders</div>
      </PageState>,
    )

    expect(getByRole('status')).toHaveTextContent('Loading worklist')
    expect(getByText('Custom placeholders')).toBeInTheDocument()
  })

  it('preserves recovery instructions in an announced error state', () => {
    const { getByRole } = render(
      <PageState variant="error" title="Worklist unavailable">
        <p>Contact the ward coordinator if this continues.</p>
      </PageState>,
    )

    expect(getByRole('alert')).toHaveTextContent('Worklist unavailable')
    expect(getByRole('alert')).toHaveTextContent('Contact the ward coordinator')
  })

  it('announces the shared page loader as a single loading state', () => {
    const { getAllByRole } = render(<PageLoader rows={3} />)
    expect(getAllByRole('status')).toHaveLength(1)
  })
})
