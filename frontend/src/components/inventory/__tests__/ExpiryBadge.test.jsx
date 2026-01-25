/**
 * Tests for ExpiryBadge and ExpiryDateDisplay components.
 *
 * Tests cover:
 * - Expiry status classification (expired, expiring soon, safe)
 * - Badge color rendering
 * - Date formatting
 * - Days until expiry calculation
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExpiryBadge, ExpiryDateDisplay } from '../ExpiryBadge'
import { addDays, subDays, format } from 'date-fns'

describe('ExpiryBadge', () => {
  const today = new Date('2024-02-01')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(today)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders "Expired" badge when date is in the past', () => {
    const expiredDate = subDays(today, 5)
    render(<ExpiryBadge expiryDate={format(expiredDate, 'yyyy-MM-dd')} />)

    expect(screen.getByText('Expired')).toBeInTheDocument()
  })

  it('renders "Expires Today" badge when date is today', () => {
    render(<ExpiryBadge expiryDate={format(today, 'yyyy-MM-dd')} />)

    expect(screen.getByText('Expires Today')).toBeInTheDocument()
  })

  it('renders days remaining when expiring within threshold', () => {
    const expiryDate = addDays(today, 15)
    render(<ExpiryBadge expiryDate={format(expiryDate, 'yyyy-MM-dd')} warningDays={30} />)

    expect(screen.getByText('15 days')).toBeInTheDocument()
  })

  it('renders "Safe" when date is beyond warning threshold', () => {
    const safeDate = addDays(today, 90)
    render(<ExpiryBadge expiryDate={format(safeDate, 'yyyy-MM-dd')} warningDays={30} />)

    // Should show safe status or the date
    const badge = screen.queryByText('Expired') || screen.queryByText(/days/)
    expect(badge).not.toBeInTheDocument()
  })

  it('uses rose color for expired items', () => {
    const expiredDate = subDays(today, 5)
    const { container } = render(<ExpiryBadge expiryDate={format(expiredDate, 'yyyy-MM-dd')} />)

    const badge = container.querySelector('.text-rose-500, .bg-rose-500\\/10')
    expect(badge).toBeInTheDocument()
  })

  it('uses amber color for items expiring soon', () => {
    const expiryDate = addDays(today, 10)
    const { container } = render(
      <ExpiryBadge expiryDate={format(expiryDate, 'yyyy-MM-dd')} warningDays={30} />
    )

    const badge = container.querySelector('.text-amber-500, .bg-amber-500\\/10')
    expect(badge).toBeInTheDocument()
  })

  it('handles ISO date strings', () => {
    const isoDate = addDays(today, 7).toISOString()
    render(<ExpiryBadge expiryDate={isoDate} warningDays={30} />)

    expect(screen.getByText('7 days')).toBeInTheDocument()
  })

  it('handles null/undefined expiry date', () => {
    const { container } = render(<ExpiryBadge expiryDate={null} />)

    // Should render nothing or a placeholder
    expect(container.firstChild).toBeFalsy()
  })
})

describe('ExpiryDateDisplay', () => {
  const today = new Date('2024-02-01')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(today)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders formatted date', () => {
    render(<ExpiryDateDisplay expiryDate="2024-03-15" />)

    expect(screen.getByText('Mar 15, 2024')).toBeInTheDocument()
  })

  it('shows days remaining when showDays is true', () => {
    const expiryDate = addDays(today, 14)
    render(<ExpiryDateDisplay expiryDate={format(expiryDate, 'yyyy-MM-dd')} showDays={true} />)

    expect(screen.getByText(/14 days/)).toBeInTheDocument()
  })

  it('applies warning styles when expiring soon', () => {
    const expiryDate = addDays(today, 7)
    const { container } = render(
      <ExpiryDateDisplay expiryDate={format(expiryDate, 'yyyy-MM-dd')} warningDays={30} />
    )

    // Should have warning color
    const element = container.querySelector('.text-amber-500, .text-rose-500')
    expect(element).toBeInTheDocument()
  })

  it('handles various date formats', () => {
    // YYYY-MM-DD format
    render(<ExpiryDateDisplay expiryDate="2024-06-20" />)
    expect(screen.getByText('Jun 20, 2024')).toBeInTheDocument()
  })
})
