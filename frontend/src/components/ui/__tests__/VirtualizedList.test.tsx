import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import VirtualizedList from '@/components/ui/VirtualizedList'

describe('VirtualizedList', () => {
  it('renders all items when below threshold', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: i }))

    render(
      <VirtualizedList
        items={items}
        threshold={10}
        renderItem={(item) => (
          <div data-testid="list-item">Item {item.id}</div>
        )}
      />
    )

    expect(screen.getAllByTestId('list-item')).toHaveLength(items.length)
  })

  it('virtualizes items when above threshold', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: i }))

    render(
      <VirtualizedList
        items={items}
        threshold={10}
        useWindow={false}
        height={160}
        estimateSize={32}
        overscan={1}
        renderItem={(item) => (
          <div data-testid="list-item">Item {item.id}</div>
        )}
      />
    )

    const rendered = screen.getAllByTestId('list-item')
    expect(rendered.length).toBeLessThan(items.length)
  })
})
