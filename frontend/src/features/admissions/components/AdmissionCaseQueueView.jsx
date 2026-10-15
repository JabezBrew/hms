import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import FileStack from 'lucide-react/dist/esm/icons/files.js'
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js'
import ReceiptText from 'lucide-react/dist/esm/icons/receipt-text.js'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import format from 'date-fns/format'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageShell } from '@/shared/components/page/PageShell'
import { PageHeader } from '@/shared/components/page/PageHeader'
import { PageState } from '@/shared/components/page/PageState'
import { usePageMeta } from '@/shared/hooks/usePageMeta'
import { useAdmissionCasesPage } from '@/features/admissions/hooks/useAdmissionCaseQueries'
import { useAuth } from '@/lib/auth'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import { getAuthQueryScope } from '@/shared/lib/queryKeys'
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
  const auth = useAuth()
  return <AdmissionCaseQueueContent key={`${scope}:${getAuthQueryScope(auth)}`} scope={scope} />
}

function AdmissionCaseQueueContent({ scope }) {
  const navigate = useNavigate()
  const rustV2Mode = isRustV2ApiMode()
  const config = scopeConfig(scope)
  const title = rustV2Mode && scope !== 'general'
    ? scope === 'billing' ? 'Billing Admissions' : 'Nursing Admissions'
    : config.title
  const description = rustV2Mode
    ? 'Browse admission requests and their current status, oldest first.'
    : config.description
  const Icon = config.icon
  const [cursors, setCursors] = useState([null])
  const cursor = cursors[cursors.length - 1]
  const { data, isLoading, isFetching, error, refetch } = useAdmissionCasesPage({ limit: 25, cursor })
  const cases = useMemo(() => data?.results || [], [data])
  const hasPrevious = cursors.length > 1
  const nextCursor = data?.page?.has_next ? data.page.next_cursor : null
  const previousPage = () => setCursors((previous) => previous.slice(0, -1))

  const visibleCases = useMemo(
    () => rustV2Mode ? cases : cases.filter((admissionCase) => caseMatchesScope(scope, admissionCase)),
    [cases, scope, rustV2Mode]
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
          action={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => refetch()}>Retry</Button>
              {hasPrevious && <Button variant="outline" onClick={previousPage}>Previous page</Button>}
            </div>
          )}
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
          <Icon className="size-4" />
          <span className="font-mono text-xs">{visibleCases.length} {visibleCases.length === 1 ? 'case' : 'cases'} on this page</span>
        </div>
      </PageHeader>

      <section className="p-6">
        {visibleCases.length === 0 ? (
          <PageState
            variant="empty"
            title="No admission cases"
            description={data?.page?.has_next ? 'No matching cases are shown on this page. Continue to the next page.' : 'No admission cases are shown on this page.'}
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
                          {admissionCase.active_reservation && (!rustV2Mode || admissionCase.status === 'ready_for_activation') && (
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
                          <ChevronRight className="ml-2 size-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Requested</p>
                      <p className="mt-1 text-sm">{formatDateTime(admissionCase.requested_at)}</p>
                    </div>
                    {rustV2Mode ? <>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Admitted</p>
                        <p className="mt-1 text-sm">{formatDateTime(admissionCase.admitted_at)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Discharged</p>
                        <p className="mt-1 text-sm">{formatDateTime(admissionCase.discharged_at)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Ward</p>
                        <p className="mt-1 text-sm">{admissionCase.requested_ward_name || 'Not recorded'}</p>
                      </div>
                    </> : <>
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
                    </>}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
        {data?.page && <nav aria-label="Admission cases pagination" className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Page {cursors.length} · Oldest requests first</p>
            {data.page.has_next && <p className="text-sm text-muted-foreground">More cases available</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!hasPrevious || isFetching} onClick={() => setCursors([null])}>First page</Button>
            <Button variant="outline" size="sm" disabled={!hasPrevious || isFetching} onClick={previousPage}>Previous page</Button>
            <Button variant="outline" size="sm" disabled={!nextCursor || isFetching} onClick={() => setCursors((previous) => [...previous, nextCursor])}>Next page</Button>
          </div>
        </nav>}
      </section>
    </PageShell>
  )
}
