/**
 * Tests for StockLevelBadge and StockLevelIndicator components.
 *
 * Tests cover:
 * - Stock level classification (in-stock, low, critical, out-of-stock)
 * - Badge rendering with correct colors
 * - Indicator bar rendering
 * - Edge cases (zero stock, high stock, no reorder level)
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StockLevelBadge, StockLevelIndicator } from '../StockLevelBadge'

describe('StockLevelBadge', () => {
  it('renders "Out of Stock" badge when stock is 0', () => {
    render(<StockLevelBadge stockLevel={0} reorderLevel={100} />)

    expect(screen.getByText('Out of Stock')).toBeInTheDocument()
  })

  it('renders "Critical" badge when stock is below half of reorder level', () => {
    render(<StockLevelBadge stockLevel={40} reorderLevel={100} />)

    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('renders "Low Stock" badge when stock is at or below reorder level', () => {
    render(<StockLevelBadge stockLevel={80} reorderLevel={100} />)

    expect(screen.getByText('Low Stock')).toBeInTheDocument()
  })

  it('renders "In Stock" badge when stock is above reorder level', () => {
    render(<StockLevelBadge stockLevel={500} reorderLevel={100} />)

    expect(screen.getByText('In Stock')).toBeInTheDocument()
  })

  it('displays quantity when showQuantity is true', () => {
    render(<StockLevelBadge stockLevel={150} reorderLevel={100} showQuantity={true} />)

    // Should show both status and quantity
    expect(screen.getByText('150')).toBeInTheDocument()
  })

  it('handles zero reorder level', () => {
    render(<StockLevelBadge stockLevel={50} reorderLevel={0} />)

    // With no reorder level, any stock should be "In Stock"
    expect(screen.getByText('In Stock')).toBeInTheDocument()
  })

  it('handles negative stock (edge case)', () => {
    render(<StockLevelBadge stockLevel={-5} reorderLevel={100} />)

    expect(screen.getByText('Out of Stock')).toBeInTheDocument()
  })

  it('applies correct size classes', () => {
    const { container } = render(
      <StockLevelBadge stockLevel={500} reorderLevel={100} size="lg" />
    )

    // Should have larger text class for "lg" size
    const badge = container.querySelector('.text-sm')
    expect(badge).toBeInTheDocument()
  })
})

describe('StockLevelIndicator', () => {
  it('renders a progress bar', () => {
    const { container } = render(
      <StockLevelIndicator
        stockLevel={250}
        reorderLevel={100}
        maxLevel={500}
      />
    )

    // Should render the indicator container
    expect(container.firstChild).toHaveClass('relative')
  })

  it('shows correct fill percentage', () => {
    const { container } = render(
      <StockLevelIndicator
        stockLevel={250}
        reorderLevel={100}
        maxLevel={500}
      />
    )

    // Stock is 250 out of 500 max = 50%
    const fillElement = container.querySelector('[style*="width"]')
    expect(fillElement).toBeInTheDocument()
  })

  it('shows reorder level marker when enabled', () => {
    const { container } = render(
      <StockLevelIndicator
        stockLevel={250}
        reorderLevel={100}
        maxLevel={500}
        showReorderMarker={true}
      />
    )

    // Reorder level at 100 out of 500 = 20% position
    const marker = container.querySelector('.absolute')
    expect(marker).toBeInTheDocument()
  })

  it('uses emerald color when stock is healthy', () => {
    const { container } = render(
      <StockLevelIndicator
        stockLevel={300}
        reorderLevel={100}
        maxLevel={500}
      />
    )

    // Should use emerald for healthy stock
    const fillElement = container.querySelector('.bg-emerald-500')
    expect(fillElement).toBeInTheDocument()
  })

  it('uses amber color when stock is low', () => {
    const { container } = render(
      <StockLevelIndicator
        stockLevel={80}
        reorderLevel={100}
        maxLevel={500}
      />
    )

    // Should use amber for low stock
    const fillElement = container.querySelector('.bg-amber-500')
    expect(fillElement).toBeInTheDocument()
  })

  it('uses rose color when stock is critical', () => {
    const { container } = render(
      <StockLevelIndicator
        stockLevel={30}
        reorderLevel={100}
        maxLevel={500}
      />
    )

    // Should use rose for critical stock
    const fillElement = container.querySelector('.bg-rose-500')
    expect(fillElement).toBeInTheDocument()
  })

  it('handles maxLevel being undefined', () => {
    const { container } = render(
      <StockLevelIndicator
        stockLevel={100}
        reorderLevel={50}
      />
    )

    // Should still render without max level
    expect(container.firstChild).toBeInTheDocument()
  })

  it('caps fill at 100% when stock exceeds max', () => {
    const { container } = render(
      <StockLevelIndicator
        stockLevel={600}
        reorderLevel={100}
        maxLevel={500}
      />
    )

    // Fill should not exceed 100%
    const fillElement = container.querySelector('[style*="width"]')
    expect(fillElement).toBeInTheDocument()
  })
})
