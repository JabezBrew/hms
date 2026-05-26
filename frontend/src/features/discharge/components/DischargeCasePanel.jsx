import { useMemo } from 'react'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import Receipt from 'lucide-react/dist/esm/icons/receipt-text.js'
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js'
import format from 'date-fns/format'
import { useNavigate } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useDischargeCases } from '@/features/discharge/hooks/useDischargeCaseQueries'
import { useAuth } from '@/lib/auth'

const BILLING_QUEUE_ROLES = new Set(['admin', 'billing'])
const NURSING_QUEUE_ROLES = new Set(['admin', 'nurse', 'head_nurse', 'nurse_practitioner'])

function formatDateTime(value) {
  if (!value) return 'Not set'
  try {
    return format(new Date(value), 'PPP p')
  } catch {
    return value
  }
}

function getStatusTone(status) {
  switch (status) {
    case 'awaiting_clearance':
      return 'bg-amber-100 text-amber-800'
    case 'ready_for_finalization':
      return 'bg-sky-100 text-sky-800'
    case 'finalized':
      return 'bg-emerald-100 text-emerald-800'
    case 'cancelled':
      return 'bg-rose-100 text-rose-800'
    case 'reopened':
      return 'bg-zinc-200 text-zinc-900'
    default:
      return 'bg-muted text-foreground'
  }
}

export function DischargeCasePanel({ admissionId, title = 'Discharge Status', className = '', enabled = true }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data, isLoading } = useDischargeCases(
    { admission: admissionId },
    { enabled: enabled && !!admissionId }
  )

  const caseItem = useMemo(() => {
    const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : []
    return results[0] || null
  }, [data])
  const openBlockers = useMemo(
    () => (caseItem?.blockers || []).filter((item) => item.status !== 'completed'),
    [caseItem]
  )
  const userType = user?.user_type

  if (!enabled || !admissionId || (!isLoading && !caseItem)) {
    return null
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>
              Operational clearance after medical discharge submission.
            </CardDescription>
          </div>
          {caseItem && (
            <Badge className={getStatusTone(caseItem.status)}>
              {caseItem.status.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !caseItem ? (
          <p className="text-sm text-muted-foreground">Loading discharge status…</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  Medical Ready
                </div>
                <p className="mt-2 text-sm font-medium">{formatDateTime(caseItem.medical_ready_at)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <Receipt className="size-3.5" />
                  Billing Cutoff
                </div>
                <p className="mt-2 text-sm font-medium">{formatDateTime(caseItem.billing_cutoff_at)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <ClipboardCheck className="size-3.5" />
                  Finalized
                </div>
                <p className="mt-2 text-sm font-medium">{formatDateTime(caseItem.finalized_at)}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 text-sm">
              <div className="rounded-full border px-3 py-1">
                Blocking tasks open: {openBlockers.length}
              </div>
              <div className="rounded-full border px-3 py-1">
                Advisory tasks open: {caseItem.advisory_tasks_open ?? 0}
              </div>
              <div className="rounded-full border px-3 py-1">
                Patient balance due: {caseItem.invoice_summary?.patient_balance_due ?? '0.00'}
              </div>
            </div>

            {openBlockers.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-amber-900">
                  <AlertTriangle className="size-4" />
                  Current blockers
                </div>
                <div className="flex flex-wrap gap-2">
                  {openBlockers.map((blocker) => (
                    <Button
                      key={`${blocker.task_type}-${blocker.status}`}
                      variant="outline"
                      size="sm"
                      className="h-auto justify-start whitespace-normal"
                      onClick={() => blocker.workflow_path && navigate(blocker.workflow_path)}
                    >
                      {blocker.task_type.replace(/_/g, ' ')}: {blocker.status.replace(/_/g, ' ')}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {(BILLING_QUEUE_ROLES.has(userType) || NURSING_QUEUE_ROLES.has(userType)) && (
              <div className="flex flex-wrap gap-2">
                {BILLING_QUEUE_ROLES.has(userType) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/billing/discharges?case=${caseItem.id}`)}
                  >
                    Open Billing Queue
                  </Button>
                )}
                {NURSING_QUEUE_ROLES.has(userType) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/nursing/discharges?case=${caseItem.id}`)}
                  >
                    Open Nursing Queue
                  </Button>
                )}
                {caseItem.schedule_follow_up_action?.path && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(caseItem.schedule_follow_up_action.path)}
                  >
                    {caseItem.schedule_follow_up_action.label || 'Schedule follow-up'}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default DischargeCasePanel
