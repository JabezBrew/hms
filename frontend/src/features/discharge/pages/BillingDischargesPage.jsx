import { useMemo, useState } from 'react'
import format from 'date-fns/format'
import Receipt from 'lucide-react/dist/esm/icons/receipt-text.js'
import Wallet from 'lucide-react/dist/esm/icons/wallet.js'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/shared/components/page/PageHeader'
import { PageShell } from '@/shared/components/page/PageShell'
import { PageState } from '@/shared/components/page/PageState'
import { usePageMeta } from '@/shared/hooks/usePageMeta'
import { useClearBilling, useDischargeCase, useDischargeCases, useUpdateBillingCutoff } from '@/features/discharge/hooks/useDischargeCaseQueries'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'

function getBillingBlocker(item) {
  return (item?.blockers || []).find((task) => task.task_type === 'billing_clearance') || null
}

function toLocalInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function formatDateTime(value) {
  if (!value) return 'Not set'
  try {
    return format(new Date(value), 'PPP p')
  } catch {
    return value
  }
}

export default function BillingDischargesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCaseId = searchParams.get('case')
  const [cutoffDrafts, setCutoffDrafts] = useState({})
  const pageMeta = usePageMeta({
    title: 'Billing Discharges | Hospital Management System',
    breadcrumbs: [
      { label: 'Billing', path: '/billing' },
      { label: 'Discharges', path: '/billing/discharges' },
    ],
  })

  const { data, isLoading, isError, refetch } = useDischargeCases()
  const { data: selectedCase } = useDischargeCase(selectedCaseId, { enabled: !!selectedCaseId })
  const updateBillingCutoff = useUpdateBillingCutoff()
  const clearBilling = useClearBilling()
  const billingClearanceMutationsAvailable = !isRustV2ApiMode()

  const cases = useMemo(() => {
    const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : []
    return results.filter((item) => {
      if (item.status === 'cancelled') {
        return false
      }
      const blocker = getBillingBlocker(item)
      return blocker && blocker.status !== 'completed'
    })
  }, [data])

  const activeCase = selectedCase || cases.find((item) => item.id === selectedCaseId) || null

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
          title="Unable to load discharge worklist"
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </PageShell>
    )
  }

  const activeCaseTasks = activeCase?.tasks || activeCase?.blockers || []
  const activeCaseBlockingTasks = activeCaseTasks.reduce((blockingTasks, task) => {
    if (task.blocking ?? true) {
      blockingTasks.push(task)
    }
    return blockingTasks
  }, [])
  const activeCaseAdvisoryTasks = (activeCase?.tasks || []).reduce((advisoryTasks, task) => {
    if (!task.blocking) {
      advisoryTasks.push(task)
    }
    return advisoryTasks
  }, [])

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Billing Discharges"
        description="Review pending medical discharges, adjust the billing cutoff, and clear patient balances."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className="space-y-4">
          {cases.length === 0 ? (
            <PageState
              variant="empty"
              title="No pending billing clearances"
              description="Submitted medical discharges that still need billing review will appear here."
              fullHeight={false}
            />
          ) : (
            cases.map((item) => {
              const draftValue = cutoffDrafts[item.id] ?? toLocalInputValue(item.billing_cutoff_at)
              const isSelected = item.id === selectedCaseId
              return (
                <Card key={item.id} className={isSelected ? 'border-amber-300 shadow-sm' : ''}>
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
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                          <Clock3 className="size-3.5" />
                          Medical Ready
                        </div>
                        <p className="mt-2 text-sm font-medium">{formatDateTime(item.medical_ready_at)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                          <Receipt className="size-3.5" />
                          Invoices
                        </div>
                        <p className="mt-2 text-sm font-medium">{item.invoice_summary?.invoice_count ?? 0}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                          <Wallet className="size-3.5" />
                          Patient Due
                        </div>
                        <p className="mt-2 text-sm font-medium">{item.invoice_summary?.patient_balance_due ?? '0.00'}</p>
                      </div>
                    </div>

                    {billingClearanceMutationsAvailable ? (
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <Input
                          type="datetime-local"
                          value={draftValue}
                          onChange={(event) => {
                            setCutoffDrafts((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }}
                        />
                        <Button
                          variant="outline"
                          disabled={updateBillingCutoff.isPending || !draftValue}
                          onClick={() => updateBillingCutoff.mutate({
                            caseId: item.id,
                            billingCutoffAt: new Date(draftValue).toISOString(),
                          })}
                        >
                          Save Cutoff
                        </Button>
                        <Button
                          disabled={clearBilling.isPending}
                          onClick={() => clearBilling.mutate({ caseId: item.id })}
                        >
                          Clear Billing
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                        <p className="font-mono text-xs uppercase tracking-wide">
                          Discharge billing review
                        </p>
                        <p className="mt-1">
                          Billing cutoff edits and billing clearance are not available for this deployment yet. Case detail review remains available.
                        </p>
                      </div>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSearchParams({ case: item.id })}
                    >
                      Review details
                    </Button>
                  </CardContent>
                </Card>
              )
            })
          )}
        </section>

        <aside>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Case Detail</CardTitle>
              <CardDescription>
                Billing blocker summary and advisory checklist.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!activeCase ? (
                <p className="text-sm text-muted-foreground">Select a case to review the full checklist.</p>
              ) : (
                <>
                  <div>
                    <p className="font-medium">{activeCase.patient_name}</p>
                    <p className="text-sm text-muted-foreground">{activeCase.ward_name}</p>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Blocking lanes</h3>
                    {activeCaseBlockingTasks.map((task) => (
                      <div key={task.id || task.task_type} className="rounded-lg border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
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
                      </div>
                    ))}
                  </div>

                  {activeCase.tasks && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium">Advisory follow-up</h3>
                      {activeCaseAdvisoryTasks.map((task) => (
                          <div key={task.id} className="rounded-lg border p-3 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span>{task.task_type.replace(/_/g, ' ')}</span>
                              <Badge variant="outline">{task.status.replace(/_/g, ' ')}</Badge>
                            </div>
                          </div>
                      ))}
                    </div>
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
