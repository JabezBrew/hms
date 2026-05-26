import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js'
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js'
import Pill from 'lucide-react/dist/esm/icons/pill.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLabPanels, useLabTests } from '@/features/laboratory/hooks'
import { useDebounce } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'

function ActionShell({ icon: Icon, title, children }) {
  return (
    <section className="rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </span>
        <h4 className="font-heading text-sm font-semibold text-foreground">{title}</h4>
      </div>
      {children}
    </section>
  )
}

export function MedicationActionBlock({ medications, activeMedications, onChange }) {
  const addMedication = () => {
    onChange([
      ...medications,
      { id: crypto.randomUUID(), medication_name: '', dose: '', frequency: '', decision: 'start' },
    ])
  }
  const addExistingDecision = (prescription) => {
    onChange([
      ...medications,
      {
        id: crypto.randomUUID(),
        prescription_id: prescription.id,
        medication_name: prescription.medication_name || prescription.name,
        dose: prescription.dose || prescription.dosage || '',
        frequency: prescription.frequency || '',
        decision: 'continue',
        status: prescription.status || 'active',
      },
    ])
  }
  const updateMedication = (id, patch) => {
    onChange(medications.map((medication) => (
      medication.id === id ? { ...medication, ...patch } : medication
    )))
  }
  const removeMedication = (id) => {
    onChange(medications.filter((medication) => medication.id !== id))
  }

  return (
    <ActionShell icon={Pill} title="Medication">
      <div className="space-y-3">
        {activeMedications?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeMedications.slice(0, 5).map((medication) => (
              <Button
                key={medication.id || medication.medication_name || medication.name}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 font-mono text-[11px]"
                onClick={() => addExistingDecision(medication)}
              >
                Review {medication.medication_name || medication.name}
              </Button>
            ))}
          </div>
        )}

        {medications.map((medication) => (
          <div key={medication.id} className="grid gap-2 rounded-md border border-border/60 bg-card/50 p-3 md:grid-cols-[1fr_0.75fr_0.75fr_0.7fr_auto]">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Medication</Label>
              <Input
                value={medication.medication_name}
                onChange={(event) => updateMedication(medication.id, { medication_name: event.target.value })}
                placeholder="Medication name"
                className="h-9"
              />
            </div>
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Dose</Label>
              <Input
                value={medication.dose}
                onChange={(event) => updateMedication(medication.id, { dose: event.target.value })}
                placeholder="Dose"
                className="h-9"
              />
            </div>
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Frequency</Label>
              <Input
                value={medication.frequency}
                onChange={(event) => updateMedication(medication.id, { frequency: event.target.value })}
                placeholder="Frequency"
                className="h-9"
              />
            </div>
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Decision</Label>
              <Select
                value={medication.decision || 'start'}
                onValueChange={(value) => updateMedication(medication.id, { decision: value, status: value })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="start">Start</SelectItem>
                  <SelectItem value="continue">Continue</SelectItem>
                  <SelectItem value="hold">Hold</SelectItem>
                  <SelectItem value="stop">Stop</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-5 size-9"
              aria-label="Remove medication action"
              onClick={() => removeMedication(medication.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}

        <Button type="button" variant="outline" size="sm" onClick={addMedication} className="font-mono text-xs">
          Add medication action
        </Button>
      </div>
    </ActionShell>
  )
}

function normalizeCatalogItems(data, kind) {
  const items = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : []
  return items.slice(0, 8).map((item) => ({
    id: item.id,
    name: item.name || item.test_name || item.panel_name || item.code,
    code: item.code || item.test_code || item.panel_code || null,
    kind,
  })).filter((item) => item.id && item.name)
}

export function LabOrderActionBlock({ labOrders, onChange }) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query.trim(), 250)
  const shouldSearch = debouncedQuery.length >= 2
  const testQuery = useLabTests({ search: debouncedQuery, page_size: 8, enabled: shouldSearch })
  const panelQuery = useLabPanels({ search: debouncedQuery, page_size: 8, enabled: shouldSearch })
  const selectedIds = useMemo(() => new Set(labOrders.map((order) => order.id)), [labOrders])
  const catalogItems = useMemo(() => (
    normalizeCatalogItems(testQuery.data, 'test')
      .concat(normalizeCatalogItems(panelQuery.data, 'panel'))
      .filter((item) => !selectedIds.has(item.id))
      .slice(0, 8)
  ), [panelQuery.data, selectedIds, testQuery.data])

  const addOrder = (item) => {
    onChange([...labOrders, item])
    setQuery('')
  }

  return (
    <ActionShell icon={FlaskConical} title="Lab Order">
      <div className="space-y-3">
        <div>
          <Label htmlFor="ward-round-lab-search" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Search catalog
          </Label>
          <Input
            id="ward-round-lab-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type at least 2 characters"
            className="h-9"
          />
        </div>

        {shouldSearch && (
          <div className={cn(
            'rounded-md border border-border/60 bg-card/50 p-2',
            catalogItems.length === 0 && 'text-sm text-muted-foreground',
          )}>
            {testQuery.isFetching || panelQuery.isFetching ? (
              <p className="font-mono text-xs text-muted-foreground">Searching catalog…</p>
            ) : catalogItems.length === 0 ? (
              <p className="font-mono text-xs">No matching tests or panels.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {catalogItems.map((item) => (
                  <Button
                    key={`${item.kind}:${item.id}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 border border-border/50 font-mono text-[11px]"
                    onClick={() => addOrder(item)}
                  >
                    {item.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {labOrders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {labOrders.map((order) => (
              <span key={`${order.kind}:${order.id}`} className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-2 py-1 font-mono text-xs">
                {order.name}
                <button
                  type="button"
                  aria-label={`Remove ${order.name}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onChange(labOrders.filter((item) => item.id !== order.id))}
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </ActionShell>
  )
}

export function NursingTaskActionBlock({ nursingTasks, onChange }) {
  const addTask = () => onChange([...nursingTasks, { id: crypto.randomUUID(), title: '', instruction: '' }])
  const updateTask = (id, patch) => {
    onChange(nursingTasks.map((task) => (task.id === id ? { ...task, ...patch } : task)))
  }

  return (
    <ActionShell icon={ClipboardCheck} title="Nursing Task">
      <div className="space-y-3">
        {nursingTasks.map((task) => (
          <div key={task.id} className="grid gap-2 rounded-md border border-border/60 bg-card/50 p-3 md:grid-cols-[0.8fr_1fr_auto]">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Title</Label>
              <Input
                value={task.title}
                onChange={(event) => updateTask(task.id, { title: event.target.value })}
                placeholder="Task title"
                className="h-9"
              />
            </div>
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Instruction</Label>
              <Input
                value={task.instruction}
                onChange={(event) => updateTask(task.id, { instruction: event.target.value })}
                placeholder="Instruction for ward team"
                className="h-9"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-5 size-9"
              aria-label="Remove nursing task"
              onClick={() => onChange(nursingTasks.filter((item) => item.id !== task.id))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addTask} className="font-mono text-xs">
          Add nursing instruction
        </Button>
      </div>
    </ActionShell>
  )
}

export function DischargeReadinessBlock({ value, onChange }) {
  return (
    <ActionShell icon={ClipboardCheck} title="Discharge Readiness">
      <div className="grid gap-3 md:grid-cols-[0.45fr_1fr]">
        <div>
          <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Readiness</Label>
          <Select
            value={value.status}
            onValueChange={(status) => onChange({ ...value, status, request_discharge: status === 'ready' })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_ready">Not ready</SelectItem>
              <SelectItem value="review_today">Review today</SelectItem>
              <SelectItem value="ready">Request discharge</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Note</Label>
          <Textarea
            value={value.note}
            onChange={(event) => onChange({ ...value, note: event.target.value })}
            placeholder="Discharge blockers or readiness note"
            className="min-h-16"
          />
        </div>
      </div>
    </ActionShell>
  )
}
