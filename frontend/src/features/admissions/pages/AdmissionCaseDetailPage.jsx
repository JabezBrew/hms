import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check-big.js'
import BedDouble from 'lucide-react/dist/esm/icons/bed-double.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import format from 'date-fns/format'

import { BedAssignment } from '@/features/wards/components/BedAssignment'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageShell } from '@/shared/components/page/PageShell'
import { PageHeader } from '@/shared/components/page/PageHeader'
import { PageState } from '@/shared/components/page/PageState'
import { usePageMeta } from '@/shared/hooks/usePageMeta'
import { useAuth } from '@/lib/auth'
import { usePatient } from '@/features/patients/hooks/usePatientQueries'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import {
  useAdmissionCase,
  useActivateAdmissionCase,
  useAcknowledgeAdmissionTask,
  useCancelAdmissionCase,
  useClearFinancial,
  useClearRegistration,
  useCompleteAdmissionIntake,
  useCompleteAdmissionTask,
  useReserveAdmissionBed,
} from '@/features/admissions/hooks/useAdmissionCaseQueries'
import { AdmissionStatusBadge, AdmissionTaskStatusBadge } from '@/features/admissions/components/AdmissionStatusBadge'

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

function titleizeTask(taskType) {
  return taskType.replaceAll('_', ' ')
}

function getUserCapabilities(user) {
  const directPermissions = Array.isArray(user?.permissions) ? user.permissions : []
  const adminCapabilities = Array.isArray(user?.adminAccess?.capabilities) ? user.adminAccess.capabilities : []
  const snakeAdminCapabilities = Array.isArray(user?.admin_access?.capabilities) ? user.admin_access.capabilities : []
  const accessContextPermissions = Array.isArray(user?.accessContext?.permissions) ? user.accessContext.permissions : []
  const snakeAccessContextPermissions = Array.isArray(user?.access_context?.permissions) ? user.access_context.permissions : []

  return new Set([
    ...directPermissions,
    ...adminCapabilities,
    ...snakeAdminCapabilities,
    ...accessContextPermissions,
    ...snakeAccessContextPermissions,
  ])
}

function AdmissionCaseHeaderActions({ admissionCase, cancelCase, onNavigate }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => onNavigate('/admissions/requests')}>
        <ChevronLeft className="mr-2 size-4" />
        Admissions
      </Button>
      {admissionCase.admission_id && (
        <Button variant="outline" size="sm" onClick={() => onNavigate(`/admissions/${admissionCase.admission_id}`)}>
          Active Stay
        </Button>
      )}
      {!admissionCase.admission_id && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => cancelCase.mutateAsync({ caseId: admissionCase.id, notes: '' })}
          disabled={cancelCase.isPending}
        >
          Cancel Case
        </Button>
      )}
    </div>
  )
}

function AdmissionCaseHeaderBadges({ admissionCase }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <AdmissionStatusBadge status={admissionCase.status} />
      {admissionCase.active_reservation && <Badge variant="outline">Bed Reserved</Badge>}
      {admissionCase.admission_id && <Badge variant="outline">Activated</Badge>}
    </div>
  )
}

function SummaryField({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  )
}

function AdmissionCaseSummaryCard({ admissionCase }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Admission Summary</CardTitle>
        <CardDescription>Request timing, placement state, and activation status.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-4">
        <SummaryField label="Requested" value={formatDateTime(admissionCase.requested_at)} />
        <SummaryField
          label="Requested Placement"
          value={admissionCase.requested_bed_label || admissionCase.requested_ward_name || 'Not assigned'}
        />
        <SummaryField label="Ready for Activation" value={formatDateTime(admissionCase.ready_for_activation_at)} />
        <SummaryField label="Activated" value={formatDateTime(admissionCase.activated_at)} />
      </CardContent>
    </Card>
  )
}

function ReservedBedPanel({ reservation }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <p className="font-medium">{reservation.ward_name} · Bed {reservation.bed_number}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Reserved at {formatDateTime(reservation.reserved_at)}
      </p>
    </div>
  )
}

function AdmissionPlacementCard({
  admissionCase,
  canReserveBed,
  onReserveBed,
  onSelectedBedChange,
  patientGender,
  reserveBed,
  selectedBed,
}) {
  if (admissionCase.admission_id) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BedDouble className="size-5" />
          Placement
        </CardTitle>
        <CardDescription>Reserve a bed before activating the ward admission.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {admissionCase.active_reservation ? (
          <ReservedBedPanel reservation={admissionCase.active_reservation} />
        ) : (
          <>
            <BedAssignment
              onBedSelect={onSelectedBedChange}
              selectedBedId={selectedBed?.id}
              wardId={admissionCase.requested_ward || undefined}
              patientGender={patientGender}
              showAdvancedFilters
            />
            {canReserveBed && (
              <Button onClick={onReserveBed} disabled={!selectedBed?.id || reserveBed.isPending}>
                Reserve Selected Bed
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function AdmissionActivationCard({ admissionCase, activateCase, canActivateAdmission }) {
  if (!admissionCase.can_activate || !canActivateAdmission) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ward Activation</CardTitle>
        <CardDescription>All activation blockers are clear. You can now create the live inpatient stay.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => activateCase.mutateAsync({ caseId: admissionCase.id, data: {} })} disabled={activateCase.isPending}>
          Activate Admission
        </Button>
      </CardContent>
    </Card>
  )
}

function AdmissionIntakeCard({
  admissionCase,
  admissionTaskMutationsAvailable,
  completeIntake,
  isNursingRole,
  pendingBlockers,
}) {
  if (admissionCase.status !== 'intake_in_progress' || !isNursingRole || !admissionTaskMutationsAvailable) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finish Admission Intake</CardTitle>
        <CardDescription>Close the admission case after the required intake tasks are complete.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Pending blockers: {pendingBlockers.length}
        </p>
        <Button onClick={() => completeIntake.mutateAsync({ caseId: admissionCase.id })} disabled={completeIntake.isPending}>
          Complete Intake
        </Button>
      </CardContent>
    </Card>
  )
}

function AdmissionTaskReviewNotice() {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
      <p className="font-mono text-xs uppercase tracking-wide">
        Admission task review
      </p>
      <p className="mt-1">
        Admission task clearance and intake completion are not available for this deployment yet. Bed reservation, activation, and case cancellation remain available.
      </p>
    </div>
  )
}

function getTaskActionState({ admissionTaskMutationsAvailable, task, userType }) {
  const isAssignedUser = task.assigned_role === userType || userType === 'admin'
  const isProtectedPreActivationBlocker =
    task.phase === 'pre_activation' &&
    task.blocking &&
    ['medical_admission_order', 'placement'].includes(task.task_type)

  return {
    canAcknowledge: admissionTaskMutationsAvailable && task.status === 'pending' && !task.blocking && isAssignedUser,
    canComplete: admissionTaskMutationsAvailable && task.status === 'pending' && isAssignedUser && !isProtectedPreActivationBlocker,
  }
}

function AdmissionTaskItem({
  acknowledgeTask,
  admissionTaskMutationsAvailable,
  clearFinancial,
  clearRegistration,
  completeTask,
  onTaskComplete,
  task,
  userType,
}) {
  const { canAcknowledge, canComplete } = getTaskActionState({
    admissionTaskMutationsAvailable,
    task,
    userType,
  })

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium capitalize">{titleizeTask(task.task_type)}</p>
            {task.blocking && <Badge variant="outline">Blocking</Badge>}
            <AdmissionTaskStatusBadge status={task.status} blocking={task.blocking} />
          </div>
          <p className="text-sm text-muted-foreground">
            {task.assigned_role ? `Assigned to ${task.assigned_role.replaceAll('_', ' ')}` : 'Unassigned'}
          </p>
          {task.notes && <p className="text-sm">{task.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canComplete && (
            <Button size="sm" onClick={() => onTaskComplete(task)} disabled={completeTask.isPending || clearRegistration.isPending || clearFinancial.isPending}>
              <CheckCircle2 className="mr-2 size-4" />
              {task.task_type === 'registration_completion'
                ? 'Clear Registration'
                : task.task_type === 'financial_clearance'
                  ? 'Clear Finance'
                  : 'Complete'}
            </Button>
          )}
          {canAcknowledge && (
            <Button size="sm" variant="outline" onClick={() => acknowledgeTask.mutateAsync({ taskId: task.id, notes: '' })} disabled={acknowledgeTask.isPending}>
              <XCircle className="mr-2 size-4" />
              Acknowledge
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function AdmissionTasksCard({
  acknowledgeTask,
  admissionCase,
  admissionTaskMutationsAvailable,
  clearFinancial,
  clearRegistration,
  completeTask,
  onTaskComplete,
  userType,
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-5" />
          Tasks
        </CardTitle>
        <CardDescription>Blocking tasks must clear before activation or intake completion. Advisory tasks stay visible but do not block.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!admissionTaskMutationsAvailable && <AdmissionTaskReviewNotice />}
        {(admissionCase.tasks || []).map((task) => (
          <AdmissionTaskItem
            acknowledgeTask={acknowledgeTask}
            admissionTaskMutationsAvailable={admissionTaskMutationsAvailable}
            clearFinancial={clearFinancial}
            clearRegistration={clearRegistration}
            completeTask={completeTask}
            key={task.id}
            onTaskComplete={onTaskComplete}
            task={task}
            userType={userType}
          />
        ))}
      </CardContent>
    </Card>
  )
}

export default function AdmissionCaseDetailPage() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: admissionCase, isLoading, error, refetch } = useAdmissionCase(caseId)
  const { data: patient } = usePatient(admissionCase?.patient, { enabled: !!admissionCase?.patient })
  const clearRegistration = useClearRegistration()
  const clearFinancial = useClearFinancial()
  const reserveBed = useReserveAdmissionBed()
  const activateCase = useActivateAdmissionCase()
  const completeIntake = useCompleteAdmissionIntake()
  const cancelCase = useCancelAdmissionCase()
  const completeTask = useCompleteAdmissionTask()
  const acknowledgeTask = useAcknowledgeAdmissionTask()
  const [selectedBed, setSelectedBed] = useState(null)
  const admissionTaskMutationsAvailable = !isRustV2ApiMode()

  const userType = user?.user_type || user?.role
  const userCapabilities = getUserCapabilities(user)
  const isNursingRole = ['admin', 'nurse', 'head_nurse', 'nurse_practitioner'].includes(userType)
  const canManageAdmissions = userCapabilities.has('admission.manage')
  const canManageWardBeds = userCapabilities.has('ward.manage_beds')
  const canReserveBed = isNursingRole || canManageAdmissions || canManageWardBeds
  const canActivateAdmission = isNursingRole || canManageAdmissions
  const pendingBlockers = useMemo(
    () => (admissionCase?.tasks || []).filter((task) => task.blocking && task.status === 'pending'),
    [admissionCase]
  )

  const pageMeta = usePageMeta({
    title: admissionCase?.patient_name
      ? `${admissionCase.patient_name} Admission Case | Hospital Management System`
      : 'Admission Case | Hospital Management System',
    breadcrumbs: [
      { label: 'Admissions', path: '/admissions/requests' },
      { label: 'Admission Case' },
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
          title="Unable to load admission case"
          description={error.message || 'Please try again.'}
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      </>
    )
  }

  if (!admissionCase) {
    return (
      <>
        {pageMeta}
        <PageState
          variant="empty"
          title="Admission case not found"
          description="The requested admission case could not be found."
          action={<Button variant="outline" onClick={() => navigate('/admissions/requests')}>Back to Admissions</Button>}
        />
      </>
    )
  }

  const patientGender = patient?.gender || patient?.user?.gender || patient?.user_details?.gender || null

  async function handleTaskComplete(task) {
    if (task.task_type === 'registration_completion') {
      await clearRegistration.mutateAsync({ caseId: admissionCase.id, notes: '' })
      return
    }
    if (task.task_type === 'financial_clearance') {
      await clearFinancial.mutateAsync({ caseId: admissionCase.id, notes: '' })
      return
    }
    await completeTask.mutateAsync({ taskId: task.id, notes: '' })
  }

  async function handleReserveBed() {
    if (!selectedBed?.id) {
      return
    }
    await reserveBed.mutateAsync({
      caseId: admissionCase.id,
      data: { bed_id: selectedBed.id },
    })
    setSelectedBed(null)
  }

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title={admissionCase.patient_name || 'Admission Case'}
        description={admissionCase.medical_record_number ? `MRN ${admissionCase.medical_record_number}` : undefined}
        actions={(
          <AdmissionCaseHeaderActions
            admissionCase={admissionCase}
            cancelCase={cancelCase}
            onNavigate={navigate}
          />
        )}
      >
        <AdmissionCaseHeaderBadges admissionCase={admissionCase} />
      </PageHeader>

      <main className="space-y-6 p-6">
        <AdmissionCaseSummaryCard admissionCase={admissionCase} />

        <AdmissionPlacementCard
          admissionCase={admissionCase}
          canReserveBed={canReserveBed}
          onReserveBed={handleReserveBed}
          onSelectedBedChange={setSelectedBed}
          patientGender={patientGender}
          reserveBed={reserveBed}
          selectedBed={selectedBed}
        />

        <AdmissionActivationCard
          activateCase={activateCase}
          admissionCase={admissionCase}
          canActivateAdmission={canActivateAdmission}
        />

        <AdmissionIntakeCard
          admissionCase={admissionCase}
          admissionTaskMutationsAvailable={admissionTaskMutationsAvailable}
          completeIntake={completeIntake}
          isNursingRole={isNursingRole}
          pendingBlockers={pendingBlockers}
        />

        <AdmissionTasksCard
          acknowledgeTask={acknowledgeTask}
          admissionCase={admissionCase}
          admissionTaskMutationsAvailable={admissionTaskMutationsAvailable}
          clearFinancial={clearFinancial}
          clearRegistration={clearRegistration}
          completeTask={completeTask}
          onTaskComplete={handleTaskComplete}
          userType={userType}
        />
      </main>
    </PageShell>
  )
}
