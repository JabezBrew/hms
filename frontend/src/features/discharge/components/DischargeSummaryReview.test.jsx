import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dischargeApi } from '@/features/discharge/api'
import { DischargeSummaryReview } from './DischargeSummaryReview'

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, facilityCode: 'SYNTHETIC' }) }))
vi.mock('@/features/discharge/api', () => ({ dischargeApi: {
  getSummaryNotes: vi.fn(), getSummaryNote: vi.fn(), saveReviewedSummary: vi.fn(),
} }))

function note(overrides = {}) {
  return {
    id: 'note-1', patient_id: 'patient-1', encounter_id: 'encounter-1', note_type: 'doctor_note',
    title: 'Discharge Summary', body: '{"plan":"Synthetic discharge plan"}', data: { plan: 'Synthetic discharge plan' },
    version: 1, status: 'draft', ...overrides,
  }
}

function renderReview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>
    <DischargeSummaryReview patientId="patient-1" encounterId="encounter-1" />
  </QueryClientProvider>)
}

async function openNote() {
  fireEvent.click(screen.getByRole('button', { name: 'Review discharge summary' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Review summary version 1 (draft)' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  dischargeApi.getSummaryNotes.mockResolvedValue({ results: [note()], nextCursor: null })
  dischargeApi.getSummaryNote.mockResolvedValue(note())
})

describe('native discharge summary review', () => {
  it('loads the full scoped note on demand and requires human review before writing', async () => {
    renderReview()
    expect(dischargeApi.getSummaryNotes).not.toHaveBeenCalled()
    await openNote()
    expect(await screen.findByText('Synthetic discharge plan')).toBeInTheDocument()
    expect(dischargeApi.getSummaryNotes).toHaveBeenCalledWith({ patientId: 'patient-1', encounterId: 'encounter-1', cursor: null }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(dischargeApi.getSummaryNote).toHaveBeenCalledWith('note-1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(screen.getByRole('button', { name: 'Save reviewed version' })).toBeDisabled()
    expect(dischargeApi.saveReviewedSummary).not.toHaveBeenCalled()
  })

  it('does not display or review a full note from a different encounter', async () => {
    dischargeApi.getSummaryNote.mockResolvedValue(note({ encounter_id: 'other-encounter' }))
    renderReview()
    await openNote()
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not match/)
    expect(screen.queryByText('Synthetic discharge plan')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save reviewed version' })).not.toBeInTheDocument()
  })

  it('does not permit reviewing a summary whose full detail cannot be loaded', async () => {
    dischargeApi.getSummaryNote.mockRejectedValue(new Error('Unavailable'))
    renderReview()
    await openNote()
    expect(await screen.findByRole('alert')).toHaveTextContent(/current summary could not be loaded/)
    expect(screen.queryByRole('button', { name: 'Save reviewed version' })).not.toBeInTheDocument()
  })

  it('records one explicit reviewed version and refreshes the resulting note status', async () => {
    let finish
    dischargeApi.saveReviewedSummary.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    renderReview()
    await openNote()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'I have reviewed this summary for this inpatient stay.' }))
    const save = screen.getByRole('button', { name: 'Save reviewed version' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    fireEvent.click(save)
    await waitFor(() => expect(dischargeApi.saveReviewedSummary).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Review discharge summary' })).toBeDisabled()
    dischargeApi.getSummaryNote.mockResolvedValue(note({ status: 'amended', version: 2 }))
    finish({ note_id: 'note-1', version: 2 })
    expect(await screen.findByText(/already has a recorded version beyond its draft/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save reviewed version' })).not.toBeInTheDocument()
  })

  it('rechecks an unknown outcome and keeps cached content read-only if refresh fails', async () => {
    dischargeApi.saveReviewedSummary.mockImplementation(async () => {
      dischargeApi.getSummaryNote.mockRejectedValue(new Error('Unavailable'))
      throw new Error('Review outcome not confirmed')
    })
    renderReview()
    await openNote()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'I have reviewed this summary for this inpatient stay.' }))
    const save = screen.getByRole('button', { name: 'Save reviewed version' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    expect(await screen.findByText(/current summary could not be loaded/)).toBeInTheDocument()
    expect(screen.getByText('Synthetic discharge plan')).toBeInTheDocument()
    expect(save).toBeDisabled()
    expect(dischargeApi.saveReviewedSummary).toHaveBeenCalledTimes(1)
  })
})
