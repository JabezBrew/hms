import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { admissionsApi } from '@/features/admissions/api'
import { createKeyFactory } from '@/shared/lib/queryKeys'
import { patientKeys } from '@/features/patients/hooks/usePatientQueries'
import { wardKeys } from '@/features/wards/hooks/useWardQueries'

const baseKeys = createKeyFactory('admission-cases')

export const admissionCaseKeys = {
  ...baseKeys,
  tasks: () => [...admissionCaseKeys.all, 'tasks'],
  taskList: (filters) => [...admissionCaseKeys.tasks(), { filters }],
}

function invalidateAdmissionCaseQueries(queryClient, caseId, patientId, admissionId) {
  queryClient.invalidateQueries({ queryKey: admissionCaseKeys.all })
  queryClient.invalidateQueries({ queryKey: wardKeys.all })
  if (caseId) {
    queryClient.invalidateQueries({ queryKey: admissionCaseKeys.detail(caseId) })
  }
  if (patientId) {
    queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) })
  }
  if (admissionId) {
    queryClient.invalidateQueries({ queryKey: wardKeys.admission(admissionId) })
  }
}

export function useAdmissionCases(filters = {}, options = {}) {
  const { enabled = true } = options
  return useQuery({
    queryKey: admissionCaseKeys.list(filters),
    queryFn: ({ signal }) => admissionsApi.getCases(filters, { signal }),
    enabled,
  })
}

export function useAdmissionCase(caseId, options = {}) {
  const { enabled = true } = options
  return useQuery({
    queryKey: admissionCaseKeys.detail(caseId),
    queryFn: () => admissionsApi.getCase(caseId),
    enabled: !!caseId && enabled,
  })
}

export function useAdmissionTasks(filters = {}, options = {}) {
  const { enabled = true } = options
  return useQuery({
    queryKey: admissionCaseKeys.taskList(filters),
    queryFn: () => admissionsApi.getTasks(filters),
    enabled,
  })
}

export function useClearRegistration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, notes }) => admissionsApi.clearRegistration(caseId, notes),
    onSuccess: (data, variables) => {
      invalidateAdmissionCaseQueries(queryClient, variables.caseId, data?.patient, data?.admission_id)
      toast.success('Registration cleared')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to clear registration')
    },
  })
}

export function useClearFinancial() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, notes }) => admissionsApi.clearFinancial(caseId, notes),
    onSuccess: (data, variables) => {
      invalidateAdmissionCaseQueries(queryClient, variables.caseId, data?.patient, data?.admission_id)
      toast.success('Financial clearance recorded')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to clear billing blocker')
    },
  })
}

export function useReserveAdmissionBed() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, data }) => admissionsApi.reserveBed(caseId, data),
    onSuccess: (data, variables) => {
      invalidateAdmissionCaseQueries(queryClient, variables.caseId, data?.patient, data?.admission_id)
      toast.success('Bed reserved')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to reserve bed')
    },
  })
}

export function useActivateAdmissionCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, data }) => admissionsApi.activateCase(caseId, data),
    onSuccess: (data, variables) => {
      invalidateAdmissionCaseQueries(queryClient, variables.caseId, data?.patient, data?.admission_id)
      toast.success('Patient admitted to ward')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to activate admission')
    },
  })
}

export function useCompleteAdmissionIntake() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId }) => admissionsApi.completeIntake(caseId),
    onSuccess: (data, variables) => {
      invalidateAdmissionCaseQueries(queryClient, variables.caseId, data?.patient, data?.admission_id)
      toast.success('Admission intake completed')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to complete intake')
    },
  })
}

export function useCancelAdmissionCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, notes }) => admissionsApi.cancelCase(caseId, notes),
    onSuccess: (data, variables) => {
      invalidateAdmissionCaseQueries(queryClient, variables.caseId, data?.patient, data?.admission_id)
      toast.success('Admission case cancelled')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to cancel admission case')
    },
  })
}

export function useCompleteAdmissionTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, notes }) => admissionsApi.completeTask(taskId, notes),
    onSuccess: (data) => {
      invalidateAdmissionCaseQueries(queryClient, data?.id, data?.patient, data?.admission_id)
      toast.success('Task completed')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to complete task')
    },
  })
}

export function useAcknowledgeAdmissionTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, notes }) => admissionsApi.acknowledgeTask(taskId, notes),
    onSuccess: (data) => {
      invalidateAdmissionCaseQueries(queryClient, data?.id, data?.patient, data?.admission_id)
      toast.success('Task acknowledged')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to acknowledge task')
    },
  })
}
