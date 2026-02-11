import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import VirtualizedGrid from '@/components/ui/VirtualizedGrid'

describe('VirtualizedGrid', () => {
  it('renders all items when below threshold', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: i }))

    render(
      <VirtualizedGrid
        items={items}
        threshold={20}
        minItemWidth={200}
        renderItem={(item) => (
          <div data-testid="grid-item">Item {item.id}</div>
        )}
      />
    )

    expect(screen.getAllByTestId('grid-item')).toHaveLength(items.length)
  })

  it('virtualizes items when above threshold', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: i }))

    render(
      <VirtualizedGrid
        items={items}
        threshold={10}
        useWindow={false}
        height={220}
        rowHeight={80}
        minItemWidth={200}
        overscan={1}
        renderItem={(item) => (
          <div data-testid="grid-item">Item {item.id}</div>
        )}
      />
    )

    const rendered = screen.getAllByTestId('grid-item')
    expect(rendered.length).toBeLessThan(items.length)
  })
})
