import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { dischargeApi } from '@/features/discharge/api'
import { createKeyFactory } from '@/shared/lib/queryKeys'
import { patientKeys } from '@/features/patients/hooks/usePatientQueries'
import { wardKeys } from '@/features/wards/hooks/useWardQueries'

const baseKeys = createKeyFactory('discharge')

export const dischargeKeys = {
  ...baseKeys,
  tasks: () => [...dischargeKeys.all, 'tasks'],
  taskList: (filters) => [...dischargeKeys.tasks(), { filters }],
}

function invalidateDischargeQueries(queryClient, caseId, patientId) {
  queryClient.invalidateQueries({ queryKey: dischargeKeys.all })
  queryClient.invalidateQueries({ queryKey: wardKeys.admissions() })
  if (caseId) {
    queryClient.invalidateQueries({ queryKey: dischargeKeys.detail(caseId) })
  }
  if (patientId) {
    queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) })
  }
}

export function useDischargeCases(filters = {}, options = {}) {
  const { enabled = true } = options
  return useQuery({
    queryKey: dischargeKeys.list(filters),
    queryFn: ({ signal }) => dischargeApi.getCases(filters, { signal }),
    enabled,
  })
}

export function useDischargeCase(id, options = {}) {
  const { enabled = true } = options
  return useQuery({
    queryKey: dischargeKeys.detail(id),
    queryFn: ({ signal }) => dischargeApi.getCase(id, { signal }),
    enabled: !!id && enabled,
  })
}

export function useDischargeTasks(filters = {}, options = {}) {
  const { enabled = true } = options
  return useQuery({
    queryKey: dischargeKeys.taskList(filters),
    queryFn: ({ signal }) => dischargeApi.getTasks(filters, { signal }),
    enabled,
  })
}

export function useUpdateBillingCutoff() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, billingCutoffAt }) => dischargeApi.updateBillingCutoff(caseId, billingCutoffAt),
    onSuccess: (data, variables) => {
      invalidateDischargeQueries(queryClient, variables.caseId, data?.patient)
      toast.success('Billing cutoff updated')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update billing cutoff')
    },
  })
}

export function useClearBilling() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId }) => dischargeApi.clearBilling(caseId),
    onSuccess: (data, variables) => {
      invalidateDischargeQueries(queryClient, variables.caseId, data?.patient)
      toast.success('Billing cleared')
    },
    onError: (error) => {
      toast.error(error.message || 'Billing clearance failed')
    },
  })
}

export function useFinalizeDischargeCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, data }) => dischargeApi.finalizeCase(caseId, data),
    onSuccess: (data, variables) => {
      invalidateDischargeQueries(queryClient, variables.caseId, data?.patient)
      toast.success('Discharge finalized')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to finalize discharge')
    },
  })
}

export function useCancelDischargeCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, reason }) => dischargeApi.cancelCase(caseId, reason),
    onSuccess: (data, variables) => {
      invalidateDischargeQueries(queryClient, variables.caseId, data?.patient)
      toast.success('Discharge cancelled')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to cancel discharge')
    },
  })
}

export function useReopenDischargeCase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId }) => dischargeApi.reopenCase(caseId),
    onSuccess: (data, variables) => {
      invalidateDischargeQueries(queryClient, variables.caseId, data?.patient)
      toast.success('Discharge reopened')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to reopen discharge')
    },
  })
}

export function useCompleteDischargeTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, notes }) => dischargeApi.completeTask(taskId, notes),
    onSuccess: (data) => {
      invalidateDischargeQueries(queryClient, data?.id, data?.patient)
      toast.success('Task completed')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to complete task')
    },
  })
}

export function useAcknowledgeDischargeTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, notes }) => dischargeApi.acknowledgeTask(taskId, notes),
    onSuccess: (data) => {
      invalidateDischargeQueries(queryClient, data?.id, data?.patient)
      toast.success('Task acknowledged')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to acknowledge task')
    },
  })
}
