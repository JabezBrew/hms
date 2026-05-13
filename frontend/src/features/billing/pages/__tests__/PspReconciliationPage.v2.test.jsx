import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PspReconciliationPage from '../PspReconciliationPage'

vi.mock('@/features/billing/hooks', () => ({
  usePaymentIntents: () => ({
    data: { count: 0, results: [], next: null },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSettlementBatches: () => ({
    data: { count: 0, results: [], next: null },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useImportSettlement: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useSettlementLines: () => ({
    data: { count: 0, results: [], next: null },
    isLoading: false,
  }),
}))

vi.mock('@/components/ui/VirtualizedTable', () => ({
  VirtualizedTable: () => <div data-testid="virtualized-table" />,
}))

function renderPage() {
  return render(<PspReconciliationPage />)
}

async function openSettlementsTab() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: /settlements/i }))
}

describe('PspReconciliationPage Rust V2 settlement guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__
  })

  it('hides settlement import controls in Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderPage()
    await openSettlementsTab()

    expect(screen.queryByText('Import Settlement Statement')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument()
    expect(screen.getByText(/settlement imports are not available in rust v2/i)).toBeInTheDocument()
  })

  it('keeps settlement import controls available outside Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }

    renderPage()
    await openSettlementsTab()

    expect(screen.getByText('Import Settlement Statement')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument()
  })
})
