import { Badge } from '@/components/ui/badge'

const STATUS_STYLES = {
  awaiting_clearance: 'bg-amber-100 text-amber-900',
  ready_for_activation: 'bg-sky-100 text-sky-900',
  intake_in_progress: 'bg-emerald-100 text-emerald-900',
  completed: 'bg-green-100 text-green-900',
  cancelled: 'bg-slate-100 text-slate-700',
}

const STATUS_LABELS = {
  awaiting_clearance: 'Awaiting Clearance',
  ready_for_activation: 'Ready for Activation',
  intake_in_progress: 'Intake In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function AdmissionStatusBadge({ status }) {
  if (!status) {
    return <Badge variant="outline">Unknown</Badge>
  }

  return (
    <Badge className={STATUS_STYLES[status] || 'bg-slate-100 text-slate-700'}>
      {STATUS_LABELS[status] || status}
    </Badge>
  )
}

export function AdmissionTaskStatusBadge({ status, blocking = false }) {
  const styles = {
    pending: blocking ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700',
    completed: 'bg-green-100 text-green-900',
    not_required: 'bg-slate-100 text-slate-700',
    acknowledged_unresolved: 'bg-blue-100 text-blue-900',
    cancelled: 'bg-slate-100 text-slate-700',
  }

  const labels = {
    pending: 'Pending',
    completed: 'Completed',
    not_required: 'Not Required',
    acknowledged_unresolved: 'Acknowledged',
    cancelled: 'Cancelled',
  }

  return (
    <Badge className={styles[status] || 'bg-slate-100 text-slate-700'}>
      {labels[status] || status}
    </Badge>
  )
}
