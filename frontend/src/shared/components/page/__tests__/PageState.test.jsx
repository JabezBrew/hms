import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { PageState } from '../PageState'

describe('PageState', () => {
  it('renders loading state', () => {
    const { container, getByText } = render(<PageState variant="loading" />)
    expect(getByText('Loading')).toBeInTheDocument()
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
})
