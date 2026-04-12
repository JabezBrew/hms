import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'
import VirtualizedTable from '@/components/ui/VirtualizedTable'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(),
  useWindowVirtualizer: vi.fn(),
}))

describe('VirtualizedTable', () => {
  beforeEach(() => {
    useVirtualizer.mockReturnValue({
      getVirtualItems: () => [],
      getTotalSize: () => 0,
      measureElement: vi.fn(),
      options: {},
    })

    useWindowVirtualizer.mockReturnValue({
      getVirtualItems: () => [],
      getTotalSize: () => 0,
      measureElement: vi.fn(),
      options: { scrollMargin: 0 },
    })
  })

  it('renders all rows when below threshold', () => {
    const rows = Array.from({ length: 5 }, (_, id) => ({ id, name: `Row ${id}` }))

    render(
      <VirtualizedTable
        rows={rows}
        columns={[{ key: 'name', header: 'Name' }]}
        rowKey={(row) => row.id}
        threshold={10}
      />
    )

    expect(screen.getByText('Row 0')).toBeInTheDocument()
    expect(screen.getByText('Row 4')).toBeInTheDocument()
  })

  it('subtracts window scroll margin from virtual row positioning', () => {
    useWindowVirtualizer.mockReturnValue({
      getVirtualItems: () => [{ index: 0, start: 240 }],
      getTotalSize: () => 320,
      measureElement: vi.fn(),
      options: { scrollMargin: 180 },
    })

    render(
      <VirtualizedTable
        rows={[{ id: 1, name: 'Visible row' }]}
        columns={[{ key: 'name', header: 'Name' }]}
        rowKey={(row) => row.id}
        threshold={1}
      />
    )

    const row = screen.getByText('Visible row').closest('[role="row"]')
    expect(row).toHaveStyle({ transform: 'translateY(60px)' })
  })
})
