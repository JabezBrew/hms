import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { labKeys } from '@/features/laboratory/hooks'
import { patientKeys } from '@/features/patients/hooks/usePatientQueries'
import { nursingKeys } from '@/hooks/useNursingQueries'
import { prescriptionKeys } from '@/hooks/usePrescriptionMutations'
import { wardRoundApi } from './api'
import { wardRoundDraftState } from './draftState'

function normalizeAdmissionId(admission) {
  return admission?.admission_id || admission?.id || admission?.admission_case_id || null
}

function compactText(value) {
  return String(value || '').trim()
}

function medicationIsComplete(medication) {
  if (medication.prescription_id && medication.decision) {
    return true
  }
  return Boolean(
    compactText(medication.medication_name)
      && compactText(medication.dose)
      && compactText(medication.frequency),
  )
}

function nursingTaskIsComplete(task) {
  const hasTitle = compactText(task.title)
  const hasInstruction = compactText(task.instruction)
  return (!hasTitle && !hasInstruction) || (hasTitle && hasInstruction)
}

export function useWardRoundMode({
  patientId,
  admission,
  encounter,
  onCommitted,
  initialDraft,
} = {}) {
  const queryClient = useQueryClient()
  const [initialState] = useState(() => wardRoundDraftState(initialDraft))
  const [note, setNote] = useState(initialState.note)
  const [medications, setMedications] = useState(initialState.medications)
  const [labOrders, setLabOrders] = useState(initialState.labOrders)
  const [nursingTasks, setNursingTasks] = useState(initialState.nursingTasks)
  const [dischargeRequest, setDischargeRequest] = useState(initialState.dischargeRequest)
  const [draftIdentity, setDraftIdentity] = useState(initialState.identity)
  const [isCommitted, setIsCommitted] = useState(false)

  const admissionId = normalizeAdmissionId(admission)

  const payload = useMemo(() => ({
    patient_id: patientId,
    admission_case_id: admissionId,
    ...(draftIdentity ? { ward_round_id: draftIdentity.id, expected_version: draftIdentity.version } : {}),
    encounter_id: encounter?.id || null,
    note: {
      overnight_events: compactText(note.overnight_events),
      examination: compactText(note.examination),
      assessment: compactText(note.assessment),
      plan: compactText(note.plan),
      summary: compactText(note.summary),
    },
    actions: {
      medications: medications.map((medication) => ({
            prescription_id: medication.prescription_id || null,
            medication_name: compactText(medication.medication_name),
            dose: compactText(medication.dose),
            frequency: compactText(medication.frequency),
            decision: medication.decision || null,
            status: medication.status || medication.decision || 'continue',
          })),
      lab_orders: labOrders.map((order) => ({
        catalog_item_id: order.id,
        catalog_item_type: order.kind || 'test',
        test_name: order.name,
        priority: order.priority,
      })),
      nursing_tasks: nursingTasks.reduce((completeTasks, task) => {
        const title = compactText(task.title)
        const instruction = compactText(task.instruction)
        if (title || instruction) {
          completeTasks.push({
            title, instruction,
            due_at: task.due_at,
            task_type: task.task_type,
            assigned_to_user_id: task.assigned_to_user_id,
          })
        }
        return completeTasks
      }, []),
      discharge: {
        status: dischargeRequest.status,
        request_discharge: dischargeRequest.request_discharge,
        note: compactText(dischargeRequest.note),
        original_blockers: dischargeRequest.original_blockers,
      },
    },
  }), [admissionId, dischargeRequest, draftIdentity, encounter?.id, labOrders, medications, note, nursingTasks, patientId])

  const validation = useMemo(() => {
    if (!admissionId) {
      return 'Ward Round requires an active admission.'
    }
    if (!compactText(note.assessment) && !compactText(note.plan) && !compactText(note.summary)) {
      return 'Add an assessment, plan, or summary before signing.'
    }
    if (medications.some((medication) => !medicationIsComplete(medication))) {
      return 'Complete medication name, dose, and frequency, or remove the incomplete medication action.'
    }
    if (!nursingTasks.every(nursingTaskIsComplete)) {
      return 'Nursing task actions need both a title and instruction.'
    }
    return null
  }, [admissionId, medications, note.assessment, note.plan, note.summary, nursingTasks])

  const invalidateWardRoundDependents = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: patientKeys.chronicleStartup(patientId) }),
      queryClient.invalidateQueries({ queryKey: [...patientKeys.detail(patientId), 'chronicle'] }),
      queryClient.invalidateQueries({ queryKey: labKeys.orders() }),
      queryClient.invalidateQueries({ queryKey: labKeys.results() }),
      queryClient.invalidateQueries({ queryKey: prescriptionKeys.active(patientId) }),
      queryClient.invalidateQueries({ queryKey: prescriptionKeys.list(patientId) }),
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksAll() }),
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksToday() }),
    ])
  }, [patientId, queryClient])

  // No cache invalidation: draft save confirms server persistence of the local payload; signed commit below invalidates patient clinical caches.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const saveDraftMutation = useMutation({
    mutationFn: () => wardRoundApi.saveDraft(patientId, payload),
    retry: false,
    onSuccess: (result) => {
      const saved = result?.data || result
      if (saved?.id && Number.isSafeInteger(saved.version)) setDraftIdentity({ id: saved.id, version: saved.version })
      toast.success('Ward round draft saved')
    },
    onError: (error) => {
      if (error?.confirmedDraftIdentity) setDraftIdentity(error.confirmedDraftIdentity)
      toast.error('Draft not saved', { description: error?.message || 'Please try again.' })
    },
  })

  // Invalidation is centralized in invalidateWardRoundDependents so chronicle startup, patient, lab, prescription, and nursing caches refresh together.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const commitMutation = useMutation({
    retry: false,
    mutationFn: () => {
      if (validation) {
        throw new Error(validation)
      }
      return wardRoundApi.commit(patientId, payload)
    },
    onSuccess: async () => {
      setIsCommitted(true)
      await invalidateWardRoundDependents()
      toast.success('Ward round signed')
      onCommitted?.()
    },
    onError: (error) => {
      if (error?.confirmedDraftIdentity) setDraftIdentity(error.confirmedDraftIdentity)
      toast.error('Ward round not signed', { description: error?.message || 'Please review the note.' })
    },
  })

  return {
    note,
    setNote,
    medications,
    setMedications,
    labOrders,
    setLabOrders,
    nursingTasks,
    setNursingTasks,
    dischargeRequest,
    setDischargeRequest,
    admissionId,
    payload,
    validation,
    saveDraft: saveDraftMutation.mutateAsync,
    signRound: commitMutation.mutateAsync,
    isSavingDraft: saveDraftMutation.isPending,
    isSigning: commitMutation.isPending,
    isReadOnly: isCommitted || initialDraft?.permissions?.read_only || initialDraft?.permissions?.can_edit_draft === false,
  }
}
