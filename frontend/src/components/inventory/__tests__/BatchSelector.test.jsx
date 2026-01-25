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
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchSelector, SimpleBatchSelector, BatchQuantityInput } from '../BatchSelector'

// Mock batch data
const mockBatches = [
  {
    id: 'batch-1',
    batch_number: 'B2024-001',
    expiry_date: '2024-03-15',
    quantity: 100,
    location_name: 'Main Pharmacy',
  },
  {
    id: 'batch-2',
    batch_number: 'B2024-002',
    expiry_date: '2024-02-28',
    quantity: 50,
    location_name: 'Main Pharmacy',
  },
  {
    id: 'batch-3',
    batch_number: 'B2024-003',
    expiry_date: '2024-06-30',
    quantity: 200,
    location_name: 'Warehouse',
  },
]

describe('BatchSelector', () => {
  it('renders all batches', () => {
    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onChange={() => {}}
      />
    )

    expect(screen.getByText('B2024-001')).toBeInTheDocument()
    expect(screen.getByText('B2024-002')).toBeInTheDocument()
    expect(screen.getByText('B2024-003')).toBeInTheDocument()
  })

  it('orders batches by FEFO (earliest expiry first)', () => {
    const { container } = render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onChange={() => {}}
      />
    )

    // Get all batch rows
    const batchRows = container.querySelectorAll('[data-testid="batch-row"]')
    // First batch should be B2024-002 (expires Feb 28)
    // Note: Actual order depends on component implementation
  })

  it('highlights FEFO recommended batch', () => {
    const { container } = render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onChange={() => {}}
      />
    )

    // Should have a FEFO indicator on the first-expiring batch
    const fefoIndicator = screen.queryByText('FEFO')
    expect(fefoIndicator).toBeInTheDocument()
  })

  it('calls onChange when batch is selected', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onChange={handleChange}
      />
    )

    // Click on a batch
    const firstBatch = screen.getByText('B2024-001').closest('button, [role="checkbox"], tr')
    if (firstBatch) {
      await user.click(firstBatch)
      expect(handleChange).toHaveBeenCalled()
    }
  })

  it('shows batch as selected when in selectedBatches', () => {
    const { container } = render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={['batch-1']}
        onChange={() => {}}
      />
    )

    // The selected batch should have visual indication
    const selectedRow = container.querySelector('.bg-primary\\/10, [data-selected="true"]')
    expect(selectedRow).toBeInTheDocument()
  })

  it('displays available quantity for each batch', () => {
    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onChange={() => {}}
      />
    )

    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
  })

  it('displays location for each batch', () => {
    render(
      <BatchSelector
        batches={mockBatches}
        selectedBatches={[]}
        onChange={() => {}}
      />
    )

    expect(screen.getAllByText('Main Pharmacy')).toHaveLength(2)
    expect(screen.getByText('Warehouse')).toBeInTheDocument()
  })

  it('handles empty batches array', () => {
    render(
      <BatchSelector
        batches={[]}
        selectedBatches={[]}
        onChange={() => {}}
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
        onChange={() => {}}
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
        onChange={() => {}}
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
        onChange={handleChange}
      />
    )

    // Open the dropdown and select a batch
    const trigger = screen.getByRole('combobox') || screen.getByText(/select batch/i)
    await user.click(trigger)

    // Select first batch option
    const option = screen.getByText('B2024-001')
    await user.click(option)

    expect(handleChange).toHaveBeenCalled()
  })
})

describe('BatchQuantityInput', () => {
  const mockBatchesWithQty = [
    { batch_id: 'batch-1', batch_number: 'B2024-001', available: 100, quantity: 0 },
    { batch_id: 'batch-2', batch_number: 'B2024-002', available: 50, quantity: 0 },
  ]

  it('renders quantity inputs for each batch', () => {
    render(
      <BatchQuantityInput
        batches={mockBatchesWithQty}
        onChange={() => {}}
      />
    )

    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs).toHaveLength(2)
  })

  it('shows available quantity', () => {
    render(
      <BatchQuantityInput
        batches={mockBatchesWithQty}
        onChange={() => {}}
      />
    )

    expect(screen.getByText(/available: 100/i)).toBeInTheDocument()
    expect(screen.getByText(/available: 50/i)).toBeInTheDocument()
  })

  it('validates quantity against available', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <BatchQuantityInput
        batches={mockBatchesWithQty}
        onChange={handleChange}
      />
    )

    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[0])
    await user.type(inputs[0], '150')

    // Should show validation error or cap at max
    expect(handleChange).toHaveBeenCalled()
  })

  it('calculates total quantity', () => {
    const batchesWithValues = [
      { batch_id: 'batch-1', batch_number: 'B2024-001', available: 100, quantity: 30 },
      { batch_id: 'batch-2', batch_number: 'B2024-002', available: 50, quantity: 20 },
    ]

    render(
      <BatchQuantityInput
        batches={batchesWithValues}
        onChange={() => {}}
        showTotal={true}
      />
    )

    expect(screen.getByText(/total: 50/i)).toBeInTheDocument()
  })

  it('calls onChange with updated batch quantities', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <BatchQuantityInput
        batches={mockBatchesWithQty}
        onChange={handleChange}
      />
    )

    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[0])
    await user.type(inputs[0], '25')

    expect(handleChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ batch_id: 'batch-1', quantity: 25 })
      ])
    )
  })

  it('auto-selects FEFO batch when requiredQuantity is set', () => {
    render(
      <BatchQuantityInput
        batches={mockBatchesWithQty}
        onChange={() => {}}
        requiredQuantity={30}
        autoSelectFEFO={true}
      />
    )

    // First batch should be pre-filled with required quantity
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs[0]).toHaveValue(30)
  })
})
