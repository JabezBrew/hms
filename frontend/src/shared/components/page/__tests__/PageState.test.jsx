import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { PageLoader, PageState } from '../PageState'

describe('PageState', () => {
  it('renders loading state', () => {
    const { container, getByText, getByRole } = render(<PageState variant="loading" />)
    expect(getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-live', 'polite')
    expect(getByText('Loading')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="loading-spinner"]')).toBeInTheDocument()
  })

  it('renders error state with action', () => {
    const onRetry = vi.fn()
    const { getByText, getByRole } = render(
      <PageState variant="error" title="Error" description="Oops" action={onRetry} />
    )
    expect(getByText('Error')).toBeInTheDocument()
    expect(getByRole('alert', { name: 'Error' })).toBeInTheDocument()
    fireEvent.click(getByText('Retry'))
    expect(onRetry).toHaveBeenCalled()
  })

  it('renders empty state', () => {
    const { getByText } = render(<PageState variant="empty" />)
    expect(getByText('No results')).toBeInTheDocument()
  })

  it('announces custom loading labels and the route loader', () => {
    const { getByRole, unmount } = render(<PageState variant="loading" title="Loading your workspace" />)
    expect(getByRole('status', { name: 'Loading your workspace' })).toBeInTheDocument()
    unmount()
    const loader = render(<PageLoader />)
    expect(loader.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-live', 'polite')
  })
})
