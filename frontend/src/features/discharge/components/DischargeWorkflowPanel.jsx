import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { getAuthQueryScope } from '@/shared/lib/queryKeys'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  useDischargeCase, useFinalizeDischargeCase, useRecordNursingRelease,
} from '@/features/discharge/hooks/useDischargeCaseQueries'
import { DischargeSummaryReview } from './DischargeSummaryReview'

const CLEARED = new Set(['completed', 'overridden'])

function permissionsFor(user) {
  return new Set([
    ...(user?.permissions || []),
    ...(user?.accessContext?.permissions || user?.access_context?.permissions || []),
    ...(user?.adminAccess?.capabilities || user?.admin_access?.capabilities || []),
  ])
}

export function DischargeWorkflowPanel({ caseId, patientId, admissionId }) {
  const auth = useAuth()
  const permissions = permissionsFor(auth.user)
  const detail = useDischargeCase(caseId, { scope: getAuthQueryScope(auth) })
  const nursing = useRecordNursingRelease()
  const finalize = useFinalizeDischargeCase()
  const [education, setEducation] = useState('')
  const [instructions, setInstructions] = useState('')
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const inFlight = useRef(false)
  const item = detail.data
  const matchesPatient = item?.id === caseId && item?.patient === patientId
    && (!admissionId || item?.admission === admissionId)
  const valid = Boolean(item && matchesPatient)
  const active = valid && item.v2_status === 'requested'
  const blockers = valid && Array.isArray(item.blockers) ? item.blockers : []
  const hasReadiness = valid && item.blockers_available === true
  const ready = hasReadiness && blockers.every((blocker) => !blocker.blocking || CLEARED.has(blocker.status))
  const busy = nursing.isPending || finalize.isPending
  const canWrite = active && !busy && !detail.isFetching && !detail.isError && hasReadiness
  const nursingBlocker = blockers.find((blocker) => blocker.task_type === 'nursing_release')
  const summaryBlocker = blockers.find((blocker) => blocker.task_type === 'discharge_summary')
  const nursingNeeded = Boolean(nursingBlocker && !CLEARED.has(nursingBlocker.status))
  const canNurse = permissions.has('nursing.task.manage')
  const canFinalize = permissions.has('admission.manage')

  async function submitNursing(event) {
    event.preventDefault()
    if (inFlight.current || !canWrite || !canNurse || !nursingNeeded) return
    if (!education.trim() || !instructions.trim() || education.length > 2000 || instructions.length > 2000) return
    inFlight.current = true
    setError('')
    try {
      await nursing.mutateAsync({
        caseId, patientId,
        data: { education: education.trim(), instructions: instructions.trim() },
      })
    } catch (mutationError) {
      setError(mutationError?.message || 'Nursing release could not be confirmed. Your entries are preserved. Review the refreshed status before retrying.')
    } finally {
      inFlight.current = false
    }
  }

  async function confirmDischarge() {
    if (inFlight.current || !canWrite || !canFinalize || !ready) return
    inFlight.current = true
    setError('')
    try {
      await finalize.mutateAsync({ caseId, patientId })
      setConfirmOpen(false)
    } catch (mutationError) {
      setConfirmOpen(false)
      setError(mutationError?.message || 'The discharge outcome could not be confirmed. Review the refreshed status before retrying.')
    } finally {
      inFlight.current = false
    }
  }

  return (
    <section aria-label="Discharge workflow" className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Discharge workflow</h3>
          <p className="mt-1 text-sm text-muted-foreground">Review clearances before closing this inpatient stay.</p>
        </div>
        {valid && <Badge variant="outline" className="capitalize">{item.status.replaceAll('_', ' ')}</Badge>}
      </div>

      {detail.isLoading ? <p role="status" className="mt-4 text-sm text-muted-foreground">Loading discharge readiness…</p> : null}
      {detail.isError || (item && !matchesPatient) ? (
        <div role="alert" className="mt-4 space-y-2 text-sm text-destructive">
          <p>{item && !matchesPatient ? 'This discharge does not match the selected patient and admission.' : 'Discharge readiness could not be verified. Actions are unavailable until it can be refreshed.'}</p>
          <Button type="button" variant="outline" disabled={busy || detail.isFetching} onClick={() => detail.refetch()}>Refresh discharge status</Button>
        </div>
      ) : null}

      {valid ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">Patient balance due: {item.invoice_summary?.patient_balance_due != null
            ? `${item.invoice_summary.currency || ''} ${item.invoice_summary.patient_balance_due}`.trim()
            : 'Unavailable'}</p>
          {hasReadiness ? (
            <ul aria-label="Discharge clearances" className="divide-y divide-border rounded-lg border border-border">
              {blockers.map((blocker) => (
                <li key={blocker.id || blocker.task_type} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium">{blocker.workflow_label || blocker.task_type.replaceAll('_', ' ')}</p>
                    {blocker.hold_reason ? <p className="mt-1 text-xs text-muted-foreground">{blocker.hold_reason}</p> : null}
                    {blocker.status === 'overridden' && blocker.override_reason ? <p className="mt-1 text-xs text-muted-foreground">Override: {blocker.override_reason}</p> : null}
                  </div>
                  <Badge variant="outline" className="capitalize">{blocker.status}</Badge>
                </li>
              ))}
            </ul>
          ) : <p role="alert" className="text-sm text-destructive">Clearance status is unavailable. Refresh before proceeding.</p>}

          {active && summaryBlocker && !CLEARED.has(summaryBlocker.status) ? (
            <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
              <p>Review and save changes to the discharge summary in Patient Chronicle. Draft notes do not clear this requirement.</p>
              {item.encounter_id && summaryBlocker.workflow_path && permissions.has('clinical_documentation.manage') ? (
                <div className="space-y-3">
                  <Button asChild type="button" variant="outline" size="sm"><Link to={summaryBlocker.workflow_path}>Prepare discharge summary</Link></Button>
                  <DischargeSummaryReview key={`${patientId}:${caseId}:${item.encounter_id}`} patientId={patientId} encounterId={item.encounter_id} disabled={!canWrite} />
                </div>
              ) : <p className="text-muted-foreground">{!item.encounter_id ? 'A linked care encounter is required for the discharge summary. Ask the admission team to review the care context.' : 'A clinician with documentation access must complete the summary.'}</p>}
            </div>
          ) : null}

          {active && nursingNeeded && canNurse ? (
            <form onSubmit={submitNursing} className="space-y-3 border-t border-border pt-4">
              <h4 className="text-sm font-semibold">Nursing release</h4>
              <div className="space-y-1.5">
                <Label htmlFor={`discharge-education-${caseId}`}>Patient education</Label>
                <Textarea id={`discharge-education-${caseId}`} value={education} onChange={(event) => setEducation(event.target.value)} maxLength={2000} required disabled={busy} rows={3} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`discharge-instructions-${caseId}`}>Discharge instructions</Label>
                <Textarea id={`discharge-instructions-${caseId}`} value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={2000} required disabled={busy} rows={3} />
              </div>
              <p className="text-xs text-muted-foreground">Document the education provided and instructions handed over to the patient or carer. Each field allows up to 2,000 characters.</p>
              <Button type="submit" disabled={!canWrite || !education.trim() || !instructions.trim()}>{nursing.isPending ? 'Recording release…' : 'Record nursing release'}</Button>
            </form>
          ) : active && nursingNeeded ? <p className="text-sm text-muted-foreground">A clinician with nursing task access must record the nursing release.</p> : null}

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {active ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="max-w-sm text-sm text-muted-foreground">{!canFinalize ? 'Admission management access is required to finalize this discharge.' : ready ? 'All required clearances are recorded. Confirm the patient is ready to leave.' : 'Complete every required clearance before finalizing.'}</p>
              {canFinalize ? <Button type="button" disabled={!canWrite || !ready} onClick={() => setConfirmOpen(true)}>Finalize discharge</Button> : null}
            </div>
          ) : null}
          {item.v2_status === 'completed' ? <p role="status" className="text-sm font-medium">Discharge finalized. The inpatient stay is closed.</p> : null}
          <Button type="button" variant="ghost" size="sm" disabled={busy || detail.isFetching} onClick={() => detail.refetch()}>{detail.isFetching ? 'Refreshing status…' : 'Refresh discharge status'}</Button>
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize this discharge?</AlertDialogTitle>
            <AlertDialogDescription>This closes the inpatient stay and releases the occupied bed for cleaning. Confirm that the patient is ready to leave and the recorded clearances are correct.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep stay open</AlertDialogCancel>
            <Button type="button" disabled={!canWrite || !ready || !canFinalize} onClick={confirmDischarge}>{finalize.isPending ? 'Finalizing…' : 'Confirm discharge'}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
