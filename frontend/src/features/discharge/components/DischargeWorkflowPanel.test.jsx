import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dischargeApi } from '@/features/discharge/api'
import { DischargeWorkflowPanel } from './DischargeWorkflowPanel'

const auth = vi.hoisted(() => ({
  user: { id: 'user-1', accessContext: { permissions: ['admission.manage', 'nursing.task.manage', 'clinical_documentation.manage'] } },
  facilityCode: 'SYNTHETIC',
}))
vi.mock('@/lib/auth', () => ({ useAuth: () => auth }))
vi.mock('@/features/discharge/api', () => ({ dischargeApi: {
  getCase: vi.fn(), recordNursingRelease: vi.fn(), finalizeCase: vi.fn(),
} }))

function caseItem(overrides = {}) {
  return {
    id: 'case-1', patient: 'patient-1', admission: 'admission-1', encounter_id: 'encounter-1',
    status: 'ready_for_finalization', v2_status: 'requested', blockers_available: true,
    blockers: [
      { id: 'summary', task_type: 'discharge_summary', workflow_label: 'Discharge summary', blocking: true, status: 'completed' },
      { id: 'release', task_type: 'nursing_release', workflow_label: 'Nursing release', blocking: true, status: 'completed' },
      { id: 'billing', task_type: 'billing_clearance', workflow_label: 'Billing clearance', blocking: true, status: 'completed' },
    ],
    invoice_summary: null,
    ...overrides,
  }
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = render(<QueryClientProvider client={client}><MemoryRouter>
    <DischargeWorkflowPanel caseId="case-1" patientId="patient-1" admissionId="admission-1" />
  </MemoryRouter></QueryClientProvider>)
  return { ...result, client }
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user.accessContext.permissions = ['admission.manage', 'nursing.task.manage', 'clinical_documentation.manage']
  dischargeApi.getCase.mockResolvedValue(caseItem())
})

describe('patient-scoped discharge workflow', () => {
  it.each(['pending', 'held'])('keeps completion unavailable while a server clearance is %s', async (status) => {
    dischargeApi.getCase.mockResolvedValue(caseItem({ blockers: [
      { id: 'billing', task_type: 'billing_clearance', blocking: true, status },
    ] }))
    renderPanel()
    expect(await screen.findByRole('button', { name: 'Finalize discharge' })).toBeDisabled()
    expect(screen.getByText('Patient balance due: Unavailable')).toBeInTheDocument()
    expect(dischargeApi.finalizeCase).not.toHaveBeenCalled()
  })

  it('fails closed when server clearance information is missing', async () => {
    dischargeApi.getCase.mockResolvedValue(caseItem({ blockers_available: false, blockers: [] }))
    renderPanel()
    expect(await screen.findByRole('button', { name: 'Finalize discharge' })).toBeDisabled()
    expect(screen.getByText(/Clearance status is unavailable/)).toBeInTheDocument()
  })

  it('never exposes or acts on detail for a different patient or admission', async () => {
    dischargeApi.getCase.mockResolvedValue(caseItem({ patient: 'other-patient' }))
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not match/)
    expect(screen.queryByRole('button', { name: 'Finalize discharge' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Patient balance due/)).not.toBeInTheDocument()
  })

  it('uses actual permissions rather than a role label for write controls', async () => {
    auth.user.accessContext.permissions = []
    dischargeApi.getCase.mockResolvedValue(caseItem({ blockers: [
      { id: 'release', task_type: 'nursing_release', blocking: true, status: 'pending' },
    ] }))
    renderPanel()
    expect(await screen.findByText(/nursing task access must record/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record nursing release' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finalize discharge' })).not.toBeInTheDocument()
  })

  it('requires an explicit confirmation and prevents duplicate finalization while pending', async () => {
    let finish
    dischargeApi.finalizeCase.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    renderPanel()
    const finalize = await screen.findByRole('button', { name: 'Finalize discharge' })
    await waitFor(() => expect(finalize).toBeEnabled())
    fireEvent.click(finalize)
    fireEvent.click(screen.getByRole('button', { name: 'Keep stay open' }))
    expect(dischargeApi.finalizeCase).not.toHaveBeenCalled()
    fireEvent.click(finalize)
    const confirm = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm discharge' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(dischargeApi.finalizeCase).toHaveBeenCalledTimes(1))
    dischargeApi.getCase.mockResolvedValue(caseItem({ status: 'finalized', v2_status: 'completed' }))
    finish(caseItem({ status: 'finalized', v2_status: 'completed' }))
    expect(await screen.findByText(/Discharge finalized. The inpatient stay is closed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finalize discharge' })).not.toBeInTheDocument()
  })

  it('preserves nursing entries on failure and re-reads the authoritative case before retry', async () => {
    const pending = caseItem({ blockers: [{ id: 'release', task_type: 'nursing_release', blocking: true, status: 'pending' }] })
    dischargeApi.getCase.mockResolvedValue(pending)
    dischargeApi.recordNursingRelease.mockRejectedValue(new Error('Release was not confirmed'))
    renderPanel()
    const education = await screen.findByLabelText('Patient education')
    const instructions = screen.getByLabelText('Discharge instructions')
    expect(screen.getByRole('button', { name: 'Record nursing release' })).toBeDisabled()
    fireEvent.change(education, { target: { value: '  Teach-back completed  ' } })
    fireEvent.change(instructions, { target: { value: '  Written instructions provided  ' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record nursing release' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Record nursing release' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Release was not confirmed')
    expect(education).toHaveValue('  Teach-back completed  ')
    expect(instructions).toHaveValue('  Written instructions provided  ')
    expect(dischargeApi.recordNursingRelease).toHaveBeenCalledWith('case-1', {
      education: 'Teach-back completed', instructions: 'Written instructions provided',
    })
    expect(dischargeApi.getCase.mock.calls.length).toBeGreaterThan(1)
  })

  it('refreshes an unknown final outcome and does not resend a completed discharge', async () => {
    dischargeApi.finalizeCase.mockImplementation(async () => {
      dischargeApi.getCase.mockResolvedValue(caseItem({ status: 'finalized', v2_status: 'completed' }))
      throw new Error('Connection interrupted')
    })
    renderPanel()
    const finalize = await screen.findByRole('button', { name: 'Finalize discharge' })
    await waitFor(() => expect(finalize).toBeEnabled())
    fireEvent.click(finalize)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discharge' }))
    expect(await screen.findByText(/The inpatient stay is closed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finalize discharge' })).not.toBeInTheDocument()
    expect(dischargeApi.finalizeCase).toHaveBeenCalledTimes(1)
  })

  it('keeps cached readiness disabled if the read after an unknown write fails', async () => {
    dischargeApi.finalizeCase.mockImplementation(async () => {
      dischargeApi.getCase.mockRejectedValue(new Error('Read unavailable'))
      throw new Error('Connection interrupted')
    })
    renderPanel()
    const finalize = await screen.findByRole('button', { name: 'Finalize discharge' })
    await waitFor(() => expect(finalize).toBeEnabled())
    fireEvent.click(finalize)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discharge' }))
    expect(await screen.findByText(/readiness could not be verified/)).toBeInTheDocument()
    expect(finalize).toBeDisabled()
    expect(dischargeApi.finalizeCase).toHaveBeenCalledTimes(1)
  })
})
