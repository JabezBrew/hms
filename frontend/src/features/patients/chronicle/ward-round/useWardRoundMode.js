import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { labKeys } from '@/features/laboratory/hooks'
import { patientKeys } from '@/features/patients/hooks/usePatientQueries'
import { nursingKeys } from '@/hooks/useNursingQueries'
import { prescriptionKeys } from '@/hooks/usePrescriptionMutations'
import { wardRoundApi } from './api'

const initialNote = {
  overnight_events: '',
  assessment: '',
  plan: '',
  summary: '',
}

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
} = {}) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState(initialNote)
  const [medications, setMedications] = useState([])
  const [labOrders, setLabOrders] = useState([])
  const [nursingTasks, setNursingTasks] = useState([])
  const [dischargeRequest, setDischargeRequest] = useState({
    status: 'not_ready',
    request_discharge: false,
    note: '',
  })

  const admissionId = normalizeAdmissionId(admission)

  const payload = useMemo(() => ({
    patient_id: patientId,
    admission_case_id: admissionId,
    encounter_id: encounter?.id || null,
    note: {
      overnight_events: compactText(note.overnight_events),
      assessment: compactText(note.assessment),
      plan: compactText(note.plan),
      summary: compactText(note.summary),
    },
    actions: {
      medications: medications
        .filter((medication) => medicationIsComplete(medication))
        .map((medication) => ({
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
      })),
      nursing_tasks: nursingTasks
        .filter((task) => compactText(task.title) || compactText(task.instruction))
        .map((task) => ({
          title: compactText(task.title),
          instruction: compactText(task.instruction),
        })),
      discharge: {
        status: dischargeRequest.status,
        request_discharge: dischargeRequest.request_discharge,
        note: compactText(dischargeRequest.note),
      },
    },
  }), [admissionId, dischargeRequest, encounter?.id, labOrders, medications, note, nursingTasks, patientId])

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

  const saveDraftMutation = useMutation({
    mutationFn: () => wardRoundApi.saveDraft(patientId, payload),
    onSuccess: () => {
      toast.success('Ward round draft saved')
    },
    onError: (error) => {
      toast.error('Draft not saved', { description: error?.message || 'Please try again.' })
    },
  })

  const commitMutation = useMutation({
    mutationFn: () => {
      if (validation) {
        throw new Error(validation)
      }
      return wardRoundApi.commit(patientId, payload)
    },
    onSuccess: async () => {
      await invalidateWardRoundDependents()
      toast.success('Ward round signed')
      onCommitted?.()
    },
    onError: (error) => {
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
  }
}
