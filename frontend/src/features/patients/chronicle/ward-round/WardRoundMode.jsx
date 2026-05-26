import FileCheck2 from 'lucide-react/dist/esm/icons/file-check-2.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js'
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  DischargeReadinessBlock,
  LabOrderActionBlock,
  MedicationActionBlock,
  NursingTaskActionBlock,
} from './WardRoundActions'
import WardRoundReviewRail from './WardRoundReviewRail'
import { useWardRoundMode } from './useWardRoundMode'

function getAdmissionId(admission) {
  return admission?.admission_id || admission?.id || admission?.admission_case_id || null
}

function latestNoteFromTimeline(timeline) {
  const entries = Array.isArray(timeline?.results)
    ? timeline.results
    : Array.isArray(timeline?.data)
      ? timeline.data
      : []
  return entries.find((entry) => {
    const type = entry.entry_type || entry.type || ''
    return String(type).includes('note')
  }) || entries[0] || null
}

function FieldBlock({ label, value, onChange, placeholder, rows = 3 }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="min-h-24 resize-y bg-background/80 text-sm leading-relaxed"
      />
    </div>
  )
}

export default function WardRoundMode({
  patientId,
  patient,
  admission,
  encounter,
  chronicleContext,
  latestVitals,
  labResults,
  medications,
  onCommitted,
}) {
  const activeAdmissionId = getAdmissionId(admission)
  const mode = useWardRoundMode({
    patientId,
    admission,
    encounter,
    onCommitted,
  })

  if (!activeAdmissionId) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-dashed border-border bg-card/70 p-8 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-md bg-muted">
          <Stethoscope className="size-5 text-muted-foreground" />
        </div>
        <h2 className="font-display text-2xl text-foreground">Active admission required</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Ward Round mode is available only for admitted patients. The Chronicle remains available for review.
        </p>
      </div>
    )
  }

  const lastNote = latestNoteFromTimeline(chronicleContext?.timeline)
  const unresolvedTasks = chronicleContext?.nursing_tasks || chronicleContext?.tasks || []
  const patientLabel = patient?.name || patient?.display_name || patient?.local_data?.name || 'Patient'

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Patient Chronicle
          </p>
          <h2 className="mt-1 font-display text-3xl text-foreground">Ward Round</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Today&apos;s round note for {patientLabel}. Actions are signed together with the note.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="font-mono text-xs"
            disabled={mode.isSavingDraft || mode.isSigning}
            onClick={() => mode.saveDraft()}
          >
            {mode.isSavingDraft && <Loader2 className="mr-2 size-3.5 animate-spin" />}
            Save draft
          </Button>
          <Button
            type="button"
            className="bg-[oklch(0.28_0.04_75)] font-mono text-xs text-white hover:bg-[oklch(0.24_0.04_75)]"
            disabled={mode.isSigning}
            onClick={() => mode.signRound()}
          >
            {mode.isSigning ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <FileCheck2 className="mr-2 size-3.5" />
            )}
            Sign round
          </Button>
        </div>
      </div>

      {mode.validation && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 font-mono text-xs text-amber-700 dark:text-amber-300">
          {mode.validation}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <section className="rounded-lg border border-border/70 bg-card/80 p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Today&apos;s Round
                </p>
                <h3 className="font-heading text-lg font-semibold text-foreground">Round note</h3>
              </div>
              <span className="rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Admission {String(activeAdmissionId).slice(0, 8)}
              </span>
            </div>

            <div className="grid gap-4">
              <FieldBlock
                label="Overnight events"
                value={mode.note.overnight_events}
                onChange={(value) => mode.setNote((current) => ({ ...current, overnight_events: value }))}
                placeholder="Events since last review"
              />
              <FieldBlock
                label="Assessment"
                value={mode.note.assessment}
                onChange={(value) => mode.setNote((current) => ({ ...current, assessment: value }))}
                placeholder="Clinical assessment for today"
              />
              <FieldBlock
                label="Plan & Actions"
                value={mode.note.plan}
                onChange={(value) => mode.setNote((current) => ({ ...current, plan: value }))}
                placeholder="Treatment plan and actionable decisions"
                rows={4}
              />
              <FieldBlock
                label="Round note summary"
                value={mode.note.summary}
                onChange={(value) => mode.setNote((current) => ({ ...current, summary: value }))}
                placeholder="Concise summary for the signed Chronicle note"
              />
            </div>
          </section>

          <section className="rounded-lg border border-border/70 bg-card/80 p-5 shadow-sm">
            <div className="mb-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Plan & Actions
              </p>
              <h3 className="font-heading text-lg font-semibold text-foreground">Embedded actions</h3>
            </div>
            <div className={cn('grid gap-4')}>
              <MedicationActionBlock
                medications={mode.medications}
                activeMedications={medications}
                onChange={mode.setMedications}
              />
              <LabOrderActionBlock
                labOrders={mode.labOrders}
                onChange={mode.setLabOrders}
              />
              <NursingTaskActionBlock
                nursingTasks={mode.nursingTasks}
                onChange={mode.setNursingTasks}
              />
              <DischargeReadinessBlock
                value={mode.dischargeRequest}
                onChange={mode.setDischargeRequest}
              />
            </div>
          </section>
        </div>

        <WardRoundReviewRail
          latestVitals={latestVitals}
          labResults={labResults}
          medications={medications}
          tasks={unresolvedTasks}
          lastNote={lastNote}
          admission={admission}
        />
      </div>
    </div>
  )
}
