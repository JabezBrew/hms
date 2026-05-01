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

  it('uses proportional grid tracks while preserving a minimum width from pixel columns', () => {
    const rows = [{ id: 1, name: 'Visible row', status: 'Active' }]

    const { container } = render(
      <VirtualizedTable
        rows={rows}
        columns={[
          { key: 'name', header: 'Name', width: '240px' },
          { key: 'status', header: 'Status', width: '120px' },
        ]}
        rowKey={(row) => row.id}
        threshold={10}
      />
    )

    const table = container.querySelector('[role="table"]')
    const headerRow = container.querySelector('[role="columnheader"]')?.parentElement

    expect(table).toHaveStyle({ minWidth: '360px' })
    expect(headerRow).toHaveStyle({ gridTemplateColumns: 'minmax(0, 240fr) minmax(0, 120fr)' })
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

    const measuredRow = screen.getByText('Visible row').closest('[data-index="0"]')
    expect(measuredRow).toHaveStyle({ transform: 'translateY(60px)' })
  })

  it('keeps row styling classes off the measured positioning wrapper', () => {
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
        rowClassName="animate-chronicle-enter hover:bg-muted/20"
        threshold={1}
      />
    )

    const measuredRow = screen.getByText('Visible row').closest('[data-index="0"]')
    const styledRow = screen.getByText('Visible row').closest('[role="row"]')

    expect(measuredRow).toHaveAttribute('role', 'presentation')
    expect(measuredRow).not.toHaveClass('animate-chronicle-enter')
    expect(styledRow).toHaveClass('animate-chronicle-enter')
  })
})
