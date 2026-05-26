import { useMemo, useState } from 'react'
import format from 'date-fns/format'
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check-big.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader } from '@/shared/components/page/PageHeader'
import { PageShell } from '@/shared/components/page/PageShell'
import { PageState } from '@/shared/components/page/PageState'
import { usePageMeta } from '@/shared/hooks/usePageMeta'
import { useDischargeCase, useDischargeCases, useFinalizeDischargeCase } from '@/features/discharge/hooks/useDischargeCaseQueries'

function getBlockingTasks(item) {
  return (item?.tasks || item?.blockers || []).filter((task) => task.blocking ?? true)
}

function getBillingBlocker(item) {
  return getBlockingTasks(item).find((task) => task.task_type === 'billing_clearance') || null
}

function getNursingBlocker(item) {
  return getBlockingTasks(item).find((task) =>
    task.task_type === 'nursing_release' || task.task_type === 'nursing_finalization'
  ) || null
}

function formatDateTime(value) {
  if (!value) return 'Not set'
  try {
    return format(new Date(value), 'PPP p')
  } catch {
    return value
  }
}

export default function NursingDischargesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCaseId = searchParams.get('case')
  const [acknowledgedTaskIds, setAcknowledgedTaskIds] = useState({})
  const pageMeta = usePageMeta({
    title: 'Nursing Discharges | Hospital Management System',
    breadcrumbs: [
      { label: 'Nursing', path: '/nursing/dashboard' },
      { label: 'Discharges', path: '/nursing/discharges' },
    ],
  })

  const { data, isLoading, isError, refetch } = useDischargeCases()
  const { data: selectedCase } = useDischargeCase(selectedCaseId, { enabled: !!selectedCaseId })
  const finalizeDischarge = useFinalizeDischargeCase()

  const cases = useMemo(() => {
    const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : []
    return results.filter((item) => {
      if (item.status === 'cancelled') {
        return false
      }
      const blocker = getNursingBlocker(item)
      return blocker && blocker.status !== 'completed'
    })
  }, [data])

  const activeCase = selectedCase || cases.find((item) => item.id === selectedCaseId) || null
  const advisoryTasks = (activeCase?.tasks || []).filter((task) => !task.blocking)
  const unresolvedAdvisoryTasks = advisoryTasks.filter((task) => task.status === 'pending')
  const selectedAcknowledgements = acknowledgedTaskIds[activeCase?.id] || []
  const billingCleared = getBillingBlocker(activeCase)?.status === 'completed'

  if (isLoading) {
    return (
      <PageShell>
        {pageMeta}
        <PageState variant="loading" />
      </PageShell>
    )
  }

  if (isError) {
    return (
      <PageShell>
        {pageMeta}
        <PageState
          variant="error"
          title="Unable to load nursing discharge queue"
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Nursing Discharges"
        description="Finalize ward release after billing clearance and acknowledge any remaining advisory follow-up."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
        <section className="space-y-4">
          {cases.length === 0 ? (
            <PageState
              variant="empty"
              title="No pending nursing finalizations"
              description="Cases ready for ward release will appear here."
              fullHeight={false}
            />
          ) : (
            cases.map((item) => (
              <Card key={item.id} className={item.id === selectedCaseId ? 'border-sky-300 shadow-sm' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{item.patient_name}</CardTitle>
                      <CardDescription>
                        {item.ward_name} · MRN {item.medical_record_number}
                      </CardDescription>
                    </div>
                    <Badge variant="outline">{item.status.replace(/_/g, ' ')}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Medical ready</div>
                      <p className="mt-2 text-sm font-medium">{formatDateTime(item.medical_ready_at)}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Billing cutoff</div>
                      <p className="mt-2 text-sm font-medium">{formatDateTime(item.billing_cutoff_at)}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Advisory open</div>
                      <p className="mt-2 text-sm font-medium">{item.advisory_tasks_open ?? 0}</p>
                    </div>
                  </div>

                  <Button variant="outline" size="sm" onClick={() => setSearchParams({ case: item.id })}>
                    Review case
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </section>

        <aside>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Nursing Finalization Review</CardTitle>
              <CardDescription>
                Billing must be cleared. Any remaining advisory items must be acknowledged before finalization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!activeCase ? (
                <p className="text-sm text-muted-foreground">Select a case to review blockers and finalize discharge.</p>
              ) : (
                <>
                  <div>
                    <p className="font-medium">{activeCase.patient_name}</p>
                    <p className="text-sm text-muted-foreground">{activeCase.ward_name}</p>
                  </div>

                  <div className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <ClipboardList className="size-4" />
                      Blocking lanes
                    </div>
                    <div className="space-y-2">
                      {getBlockingTasks(activeCase).map((task) => (
                          <div key={task.id || task.task_type} className="flex items-center justify-between gap-3 text-sm">
                            <div>
                              <span>{task.task_type.replace(/_/g, ' ')}</span>
                              {(task.hold_reason || task.override_reason) && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {task.override_reason || task.hold_reason}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {task.workflow_path && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => navigate(task.workflow_path)}
                                >
                                  Open source
                                </Button>
                              )}
                              <Badge variant="outline">{task.status.replace(/_/g, ' ')}</Badge>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <AlertTriangle className="size-4" />
                      Advisory checklist
                    </div>
                    {advisoryTasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No advisory tasks linked to this case.</p>
                    ) : (
                      <div className="space-y-3">
                        {advisoryTasks.map((task) => {
                          const checked = selectedAcknowledgements.includes(task.id)
                          const needsAcknowledgement = task.status === 'pending'
                          return (
                            <label key={task.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                              <Checkbox
                                checked={needsAcknowledgement ? checked : true}
                                disabled={!needsAcknowledgement}
                                onCheckedChange={(value) => {
                                  setAcknowledgedTaskIds((current) => {
                                    const currentIds = current[activeCase.id] || []
                                    const nextIds = value
                                      ? [...currentIds, task.id]
                                      : currentIds.filter((id) => id !== task.id)
                                    return {
                                      ...current,
                                      [activeCase.id]: nextIds,
                                    }
                                  })
                                }}
                              />
                              <div className="flex-1">
                                <div className="flex items-center justify-between gap-3">
                                  <span>{task.task_type.replace(/_/g, ' ')}</span>
                                  <Badge variant="outline">{task.status.replace(/_/g, ' ')}</Badge>
                                </div>
                                {task.snapshot && Object.keys(task.snapshot).length > 0 && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {JSON.stringify(task.snapshot)}
                                  </p>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <Button
                    className="w-full"
                    disabled={
                      finalizeDischarge.isPending ||
                      !billingCleared ||
                      unresolvedAdvisoryTasks.length !== selectedAcknowledgements.length
                    }
                    onClick={() => finalizeDischarge.mutate({
                      caseId: activeCase.id,
                      data: {
                        acknowledge_task_ids: selectedAcknowledgements,
                      },
                    })}
                  >
                    <CheckCircle2 className="mr-2 size-4" />
                    Finalize Discharge
                  </Button>
                  {!billingCleared && (
                    <p className="text-sm text-muted-foreground">
                      Billing clearance must be completed before nursing can finalize ward release.
                    </p>
                  )}
                  {activeCase.schedule_follow_up_action?.path && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => navigate(activeCase.schedule_follow_up_action.path)}
                    >
                      {activeCase.schedule_follow_up_action.label || 'Schedule follow-up'}
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  )
}
