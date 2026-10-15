import { useRef, useState } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { getAuthQueryScope } from '@/shared/lib/queryKeys'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import ChronicleNoteBody from '@/components/chronicle/ChronicleNoteBody'
import { dischargeApi } from '@/features/discharge/api'
import { dischargeKeys, refreshDischargeWorkflow } from '@/features/discharge/hooks/useDischargeCaseQueries'

function ReviewedNote({ note, patientId, encounterId, disabled }) {
  const queryClient = useQueryClient()
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const mutation = useMutation({
    mutationKey: [...dischargeKeys.all, 'review-summary', patientId, encounterId],
    mutationFn: () => dischargeApi.saveReviewedSummary({ note, patientId, encounterId }),
    retry: false,
    onSettled: () => refreshDischargeWorkflow(queryClient, patientId),
  })
  const matches = note.patient_id === patientId && note.encounter_id === encounterId
    && note.note_type === 'doctor_note' && note.title?.trim().toLowerCase() === 'discharge summary'
    && typeof note.body === 'string' && Boolean(note.body.trim())
  if (!matches) return <p role="alert" className="text-sm text-destructive">This note does not match the discharge summary for this care encounter.</p>

  async function saveReview() {
    if (inFlight.current || disabled || !acknowledged || note.status !== 'draft') return
    inFlight.current = true
    setError('')
    try {
      await mutation.mutateAsync()
    } catch (mutationError) {
      setError(mutationError?.message || 'The review outcome could not be confirmed. Refresh and review the current version before retrying.')
      setAcknowledged(false)
    } finally {
      inFlight.current = false
    }
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{note.title} · Version {note.version}</span>
      <span className="capitalize">{note.status}</span>
    </div>
    <div aria-label="Discharge summary content" className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-4">
      <ChronicleNoteBody data={note.data} />
    </div>
    {note.status === 'draft' ? <>
      <div className="flex items-start gap-2.5">
        <Checkbox id={`review-summary-${note.id}`} checked={acknowledged} onCheckedChange={(value) => setAcknowledged(value === true)} disabled={disabled || mutation.isPending} className="mt-0.5" />
        <Label htmlFor={`review-summary-${note.id}`} className="text-sm leading-relaxed">I have reviewed this summary for this inpatient stay.</Label>
      </div>
      <p className="text-xs text-muted-foreground">Saving records a reviewed version in the note history. If corrections are needed, prepare a corrected discharge summary before proceeding.</p>
      <Button type="button" variant="outline" disabled={disabled || mutation.isPending || !acknowledged} onClick={saveReview}>{mutation.isPending ? 'Saving review…' : 'Save reviewed version'}</Button>
    </> : <p role="status" className="text-sm font-medium">This summary already has a recorded version beyond its draft.</p>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>
}

function SummaryNoteDetail({ noteId, patientId, encounterId, disabled, scope }) {
  const detail = useQuery({
    queryKey: [...dischargeKeys.all, 'summary-note', noteId, scope],
    queryFn: ({ signal }) => dischargeApi.getSummaryNote(noteId, { signal }),
    retry: false,
    staleTime: 0,
  })
  return <div className="mt-3 space-y-3 border-t border-border pt-3">
    {detail.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading the full discharge summary…</p> : null}
    {detail.isError ? <p role="alert" className="text-sm text-destructive">The current summary could not be loaded. Review is unavailable until it is refreshed.</p> : null}
    {detail.data ? <ReviewedNote key={`${detail.data.id}:${detail.data.version}`} note={detail.data} patientId={patientId} encounterId={encounterId} disabled={disabled || detail.isFetching || detail.isError} /> : null}
    <Button type="button" variant="ghost" size="sm" disabled={disabled || detail.isFetching} onClick={() => detail.refetch()}>Reload summary</Button>
  </div>
}

export function DischargeSummaryReview({ patientId, encounterId, disabled = false }) {
  const auth = useAuth()
  const scope = getAuthQueryScope(auth)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(null)
  const [noteId, setNoteId] = useState(null)
  const pendingReviews = useIsMutating({ mutationKey: [...dischargeKeys.all, 'review-summary', patientId, encounterId] })
  const isDisabled = disabled || pendingReviews > 0
  const notes = useQuery({
    queryKey: [...dischargeKeys.all, 'summary-notes', patientId, encounterId, cursor, scope],
    queryFn: ({ signal }) => dischargeApi.getSummaryNotes({ patientId, encounterId, cursor }, { signal }),
    enabled: open && Boolean(patientId && encounterId),
    retry: false,
    staleTime: 0,
  })

  return <div className="space-y-3">
    <Button type="button" variant="outline" size="sm" disabled={isDisabled} onClick={() => setOpen((value) => !value)} aria-expanded={open}>Review discharge summary</Button>
    {open ? <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Select the summary to read its full content and record your review.</p>
      {notes.isLoading ? <p role="status" className="text-sm">Loading summaries…</p> : null}
      {notes.isError ? <p role="alert" className="text-sm text-destructive">Summaries could not be loaded. Refresh to try again.</p> : null}
      {notes.data?.results.length === 0 ? <p className="text-sm text-muted-foreground">No discharge summary found in these notes for this care encounter. Prepare one in Patient Chronicle, then refresh.</p> : null}
      <div className="flex flex-wrap gap-2">
        {(notes.data?.results || []).map((note) => <Button key={note.id} type="button" variant={noteId === note.id ? 'secondary' : 'outline'} size="sm" aria-pressed={noteId === note.id} onClick={() => setNoteId(note.id)} disabled={disabled}>
          Review summary version {note.version} ({note.status})
        </Button>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={notes.isFetching || isDisabled} onClick={() => notes.refetch()}>Refresh summaries</Button>
        {notes.data?.nextCursor ? <Button type="button" variant="ghost" size="sm" disabled={isDisabled} onClick={() => { setNoteId(null); setCursor(notes.data.nextCursor) }}>Older notes</Button> : null}
        {cursor ? <Button type="button" variant="ghost" size="sm" disabled={isDisabled} onClick={() => { setNoteId(null); setCursor(null) }}>Latest notes</Button> : null}
      </div>
      {noteId ? <SummaryNoteDetail key={`${scope}:${patientId}:${encounterId}:${noteId}`} noteId={noteId} patientId={patientId} encounterId={encounterId} disabled={isDisabled || notes.isFetching || notes.isError} scope={scope} /> : null}
    </div> : null}
  </div>
}
