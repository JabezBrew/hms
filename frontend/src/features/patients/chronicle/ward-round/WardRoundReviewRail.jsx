import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import FileText from 'lucide-react/dist/esm/icons/file-text.js'
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js'
import Pill from 'lucide-react/dist/esm/icons/pill.js'
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js'
import { cn } from '@/lib/utils'

function formatTimestamp(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function RailSection({ icon: Icon, title, children }) {
  return (
    <section className="rounded-lg border border-border/70 bg-card/70 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <h4 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{title}</h4>
      </div>
      {children}
    </section>
  )
}

function EmptyLine({ children = 'None in current context.' }) {
  return <p className="font-mono text-xs text-muted-foreground">{children}</p>
}

export default function WardRoundReviewRail({
  latestVitals,
  labResults,
  medications,
  tasks,
  lastNote,
  admission,
}) {
  const vitals = latestVitals
  const abnormalLabs = (labResults || []).filter((result) => result.is_abnormal).slice(0, 4)
  const compactMeds = (medications || []).slice(0, 5)
  const unresolvedTasks = (tasks || []).filter((task) => task.status !== 'completed').slice(0, 4)

  return (
    <aside className="space-y-3 lg:sticky lg:top-4" aria-label="Review Before Signing">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Review Before Signing
        </p>
        <h3 className="mt-1 font-display text-xl text-foreground">Safety check</h3>
      </div>

      <RailSection icon={AlertTriangle} title="Vitals">
        {vitals ? (
          <dl className="grid grid-cols-2 gap-2 font-mono text-xs">
            {[
              ['BP', vitals.blood_pressure],
              ['HR', vitals.heart_rate],
              ['SpO2', vitals.oxygen_saturation || vitals.spo2],
              ['Temp', vitals.temperature],
            ].map(([label, value]) => value ? (
              <div key={label} className="rounded-md bg-muted/40 p-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ) : null)}
            <div className="col-span-2 text-muted-foreground">
              {formatTimestamp(vitals.recorded_at || vitals.timestamp)}
            </div>
          </dl>
        ) : (
          <EmptyLine>No latest vitals found.</EmptyLine>
        )}
      </RailSection>

      <RailSection icon={FlaskConical} title="New Labs">
        {abnormalLabs.length > 0 ? (
          <ul className="space-y-2">
            {abnormalLabs.map((lab) => (
              <li key={lab.id || lab.name} className="flex items-center justify-between gap-2 font-mono text-xs">
                <span className="truncate text-foreground">{lab.name}</span>
                <span className="shrink-0 text-rose-600">{lab.value}{lab.unit ? ` ${lab.unit}` : ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine>No abnormal labs in the startup read.</EmptyLine>
        )}
      </RailSection>

      <RailSection icon={Pill} title="Current Meds">
        {compactMeds.length > 0 ? (
          <ul className="space-y-2">
            {compactMeds.map((medication) => (
              <li key={medication.id || medication.medication_name || medication.name} className="font-mono text-xs">
                <span className="block truncate text-foreground">{medication.medication_name || medication.name}</span>
                <span className="text-muted-foreground">{medication.dose || medication.dosage || ''} {medication.frequency || ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine>No current medications listed.</EmptyLine>
        )}
      </RailSection>

      <RailSection icon={ClipboardList} title="Unresolved Tasks">
        {unresolvedTasks.length > 0 ? (
          <ul className="space-y-2">
            {unresolvedTasks.map((task) => (
              <li key={task.id || task.title} className="font-mono text-xs text-foreground">
                {task.title || task.task_type}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine>No unresolved tasks returned.</EmptyLine>
        )}
      </RailSection>

      <RailSection icon={FileText} title="Last Note">
        {lastNote ? (
          <div className="space-y-1">
            <p className="line-clamp-3 text-xs leading-relaxed text-foreground">
              {lastNote.title || lastNote.summary || lastNote.content}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {formatTimestamp(lastNote.timestamp || lastNote.occurred_at)}
            </p>
          </div>
        ) : (
          <EmptyLine>No recent note in the startup read.</EmptyLine>
        )}
      </RailSection>

      <RailSection icon={Stethoscope} title="Admission">
        <div className={cn('space-y-1 font-mono text-xs', !admission && 'text-muted-foreground')}>
          {admission ? (
            <>
              <p className="text-foreground">{admission.ward_name || admission.ward || 'Active admission'}</p>
              <p className="text-muted-foreground">
                Bed {admission.bed_code || admission.bed_number || 'not assigned'}
              </p>
            </>
          ) : (
            <EmptyLine>No active admission.</EmptyLine>
          )}
        </div>
      </RailSection>
    </aside>
  )
}
