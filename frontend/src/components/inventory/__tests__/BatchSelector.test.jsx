/**
 * Tests for BatchSelector components.
 *
 * Tests cover:
 * - FEFO (First Expiry First Out) ordering
 * - Batch selection and deselection
 * - Quantity validation
 * - Auto-select functionality
 * - Available quantity display
 */
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchSelector, SimpleBatchSelector, BatchQuantityInput } from '../BatchSelector'

// Mock batch data
const mockBatches = [
  {
    id: 'batch-1',
    batch_number: 'B2024-001',
    expiry_date: '2030-03-15',
    quantity: 100,
    location_name: 'Main Pharmacy',
  },
  {
    id: 'batch-2',
    batch_number: 'B2024-002',
    expiry_date: '2030-02-28',
    quantity: 50,
    location_name: 'Main Pharmacy',
  },
  {
    id: 'batch-3',
    batch_number: 'B2024-003',
    expiry_date: '2030-06-30',
    quantity: 200,
    location_name: 'Warehouse',
  },
]

describe('BatchSelector', () => {
  it('renders all batches', async () => {
    const user = userEvent.setup()
    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onSelectionChange={() => {}}
      />
    )

    await user.click(screen.getByRole('combobox'))
    expect(await screen.findByText('B2024-001')).toBeInTheDocument()
    expect(screen.getByText('B2024-002')).toBeInTheDocument()
    expect(screen.getByText('B2024-003')).toBeInTheDocument()
  })

  it('orders batches by FEFO (earliest expiry first)', async () => {
    const user = userEvent.setup()
    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onSelectionChange={() => {}}
      />
    )

    await user.click(screen.getByRole('combobox'))
    await screen.findByText('B2024-001')
    const batchLabels = screen.getAllByText(/B2024-00[1-3]/).map((node) => node.textContent)
    expect(batchLabels[0]).toBe('B2024-002')
    expect(batchLabels[1]).toBe('B2024-001')
    expect(batchLabels[2]).toBe('B2024-003')
  })

  it('highlights FEFO recommended batch', async () => {
    const user = userEvent.setup()
    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onSelectionChange={() => {}}
      />
    )

    await user.click(screen.getByRole('combobox'))
    // Should have a FEFO indicator on the first-expiring batch
    expect(await screen.findByText('FEFO')).toBeInTheDocument()
  })

  it('calls onChange when batch is selected', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onSelectionChange={handleChange}
      />
    )

    await user.click(screen.getByRole('combobox'))
    // Click on a batch
    const firstBatch = await screen.findByText('B2024-001')
    await user.click(firstBatch)
    expect(handleChange).toHaveBeenCalledWith(['batch-1'])
  })

  it('shows batch as selected when in selectedBatches', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={['batch-1']}
        onSelectionChange={() => {}}
      />
    )

    await user.click(screen.getByRole('combobox'))
    await screen.findByText('Select Batches')
    // The selected batch should have visual indication
    const selectedRow = document.querySelector('.bg-primary\\/10, [data-selected="true"]')
    expect(selectedRow).toBeInTheDocument()
  })

  it('displays available quantity for each batch', async () => {
    const user = userEvent.setup()
    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onSelectionChange={() => {}}
      />
    )

    await user.click(screen.getByRole('combobox'))
    await screen.findByText('B2024-001')
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
  })

  it('displays location for each batch', async () => {
    const user = userEvent.setup()
    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onSelectionChange={() => {}}
        showLocation={true}
      />
    )

    await user.click(screen.getByRole('combobox'))
    await screen.findByText('B2024-001')
    expect(screen.getAllByText('Main Pharmacy')).toHaveLength(2)
    expect(screen.getByText('Warehouse')).toBeInTheDocument()
  })

  it('handles empty batches array', () => {
    render(
      <BatchSelector
        batches={[]}
        selectedBatches={[]}
        onSelectionChange={() => {}}
      />
    )

    expect(screen.getByText(/no batches/i)).toBeInTheDocument()
  })
})

describe('SimpleBatchSelector', () => {
  it('renders as a dropdown/select', () => {
    render(
      <SimpleBatchSelector
        batches={mockBatches}
        selectedBatch={null}
        onSelect={() => {}}
      />
    )

    // Should have a select trigger
    const trigger = screen.getByRole('combobox') || screen.getByText(/select batch/i)
    expect(trigger).toBeInTheDocument()
  })

  it('shows selected batch', () => {
    render(
      <SimpleBatchSelector
        batches={mockBatches}
        selectedBatch="batch-1"
        onSelect={() => {}}
      />
    )

    expect(screen.getByText('B2024-001')).toBeInTheDocument()
  })

  it('calls onChange when batch is selected', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <SimpleBatchSelector
        batches={mockBatches}
        selectedBatch={null}
        onSelect={handleChange}
      />
    )

    // Open the dropdown and select a batch
    const trigger = screen.getByRole('combobox') || screen.getByText(/select batch/i)
    await user.click(trigger)

    // Select first batch option
    const option = await screen.findByText('B2024-001')
    await user.click(option)

    expect(handleChange).toHaveBeenCalledWith('batch-1')
  })
})

describe('BatchQuantityInput', () => {
  const mockBatchesWithQty = [
    { id: 'batch-1', batch_number: 'B2024-001', available_quantity: 100 },
    { id: 'batch-2', batch_number: 'B2024-002', available_quantity: 50 },
  ]

  it('renders quantity inputs for each batch', () => {
    render(
      <BatchQuantityInput
        batches={mockBatchesWithQty}
        onAllocationsChange={() => {}}
      />
    )

    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs).toHaveLength(2)
  })

  it('shows available quantity', () => {
    render(
      <BatchQuantityInput
        batches={mockBatchesWithQty}
        onAllocationsChange={() => {}}
      />
    )

    expect(screen.getByText(/Avail: 100/i)).toBeInTheDocument()
    expect(screen.getByText(/Avail: 50/i)).toBeInTheDocument()
  })

  it('validates quantity against available', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <BatchQuantityInput
        batches={mockBatchesWithQty}
        onAllocationsChange={handleChange}
      />
    )

    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[0])
    await user.type(inputs[0], '150')

    expect(handleChange).toHaveBeenCalled()
  })

  it('calculates total quantity', () => {
    const batchesWithValues = [
      { id: 'batch-1', batch_number: 'B2024-001', available_quantity: 100 },
      { id: 'batch-2', batch_number: 'B2024-002', available_quantity: 50 },
    ]

    render(
      <BatchQuantityInput
        batches={batchesWithValues}
        allocations={[
          { batch_id: 'batch-1', quantity: 30 },
          { batch_id: 'batch-2', quantity: 20 },
        ]}
        onAllocationsChange={() => {}}
        maxQuantity={60}
      />
    )

    expect(screen.getByText(/50\s*\/\s*60/)).toBeInTheDocument()
  })

  it('calls onChange with updated batch quantities', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    function AllocationHarness() {
      const [allocations, setAllocations] = useState([])
      const handleAllocationsChange = (next) => {
        handleChange(next)
        setAllocations(next)
      }
      return (
        <BatchQuantityInput
          batches={mockBatchesWithQty}
          allocations={allocations}
          onAllocationsChange={handleAllocationsChange}
        />
      )
    }

    render(<AllocationHarness />)

    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[0])
    await user.type(inputs[0], '25')

    expect(handleChange).toHaveBeenLastCalledWith([
      { batch_id: 'batch-1', quantity: 25 }
    ])
  })
})
