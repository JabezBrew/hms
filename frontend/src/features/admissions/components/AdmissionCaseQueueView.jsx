import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import FileStack from 'lucide-react/dist/esm/icons/files.js'
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js'
import ReceiptText from 'lucide-react/dist/esm/icons/receipt-text.js'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import format from 'date-fns/format'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageShell } from '@/shared/components/page/PageShell'
import { PageHeader } from '@/shared/components/page/PageHeader'
import { PageState } from '@/shared/components/page/PageState'
import { usePageMeta } from '@/shared/hooks/usePageMeta'
import { useAdmissionCases } from '@/features/admissions/hooks/useAdmissionCaseQueries'
import { AdmissionStatusBadge } from '@/features/admissions/components/AdmissionStatusBadge'

function formatDateTime(value) {
  if (!value) {
    return 'Not set'
  }
  try {
    return format(new Date(value), 'PPP p')
  } catch {
    return 'Not set'
  }
}

function scopeConfig(scope) {
  switch (scope) {
    case 'billing':
      return {
        title: 'Billing Admission Queue',
        description: 'Admissions that still need financial clearance before ward activation.',
        icon: ReceiptText,
      }
    case 'nursing':
      return {
        title: 'Nursing Admission Queue',
        description: 'Admissions ready for activation or waiting for intake completion.',
        icon: Stethoscope,
      }
    default:
      return {
        title: 'Admission Requests',
        description: 'Open admission cases across clearance, placement, activation, and intake.',
        icon: FileStack,
      }
  }
}

function caseMatchesScope(scope, admissionCase) {
  const blockers = admissionCase.blockers || []
  if (scope === 'billing') {
    return blockers.some((task) => task.task_type === 'financial_clearance' && task.status === 'pending')
  }
  if (scope === 'nursing') {
    return admissionCase.status === 'ready_for_activation' || admissionCase.status === 'intake_in_progress'
  }
  return true
}

export function AdmissionCaseQueueView({ scope = 'general' }) {
  const navigate = useNavigate()
  const { title, description, icon: Icon } = scopeConfig(scope)
  const { data: cases = [], isLoading, error, refetch } = useAdmissionCases()

  const visibleCases = useMemo(
    () => cases.filter((admissionCase) => caseMatchesScope(scope, admissionCase)),
    [cases, scope]
  )

  const pageMeta = usePageMeta({
    title: `${title} | Hospital Management System`,
    breadcrumbs: [
      { label: 'Admissions', path: '/admissions/requests' },
      { label: title },
    ],
  })

  if (isLoading) {
    return (
      <PageState variant="loading">
        {pageMeta}
      </PageState>
    )
  }

  if (error) {
    return (
      <>
        {pageMeta}
        <PageState
          variant="error"
          title="Unable to load admission cases"
          description={error.message || 'Please try again.'}
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      </>
    )
  }

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title={title}
        description={description}
        actions={(
          <Button onClick={() => navigate('/admissions/new')}>
            Start Admission
          </Button>
        )}
      >
        <div className="mt-3 flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span className="font-mono text-xs">{visibleCases.length} open cases</span>
        </div>
      </PageHeader>

      <main className="p-6">
        {visibleCases.length === 0 ? (
          <PageState
            variant="empty"
            title="No admission cases"
            description="There are no open admission cases in this queue."
            action={<Button onClick={() => navigate('/admissions/new')}>Start Admission</Button>}
            fullHeight={false}
          />
        ) : (
          <div className="grid gap-4">
            {visibleCases.map((admissionCase) => {
              const pendingBlockers = (admissionCase.blockers || []).filter((task) => task.status === 'pending')
              return (
                <Card key={admissionCase.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-xl">{admissionCase.patient_name}</CardTitle>
                          <AdmissionStatusBadge status={admissionCase.status} />
                          {admissionCase.active_reservation && (
                            <Badge variant="outline">Bed Reserved</Badge>
                          )}
                        </div>
                        <CardDescription className="font-mono text-xs">
                          MRN {admissionCase.medical_record_number || 'Unknown'} · {admissionCase.requested_bed_label || 'Placement pending'}
                        </CardDescription>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {admissionCase.admission_id && (
                          <Button variant="outline" size="sm" onClick={() => navigate(`/admissions/${admissionCase.admission_id}`)}>
                            Active Stay
                          </Button>
                        )}
                        <Button size="sm" onClick={() => navigate(`/admissions/cases/${admissionCase.id}`)}>
                          Open Case
                          <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Requested</p>
                      <p className="mt-1 text-sm">{formatDateTime(admissionCase.requested_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Activation Ready</p>
                      <p className="mt-1 text-sm">{formatDateTime(admissionCase.ready_for_activation_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Source</p>
                      <p className="mt-1 text-sm capitalize">{(admissionCase.admission_source || 'direct').replaceAll('_', ' ')}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending Blockers</p>
                      <p className="mt-1 text-sm">{pendingBlockers.length}</p>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </PageShell>
  )
}
