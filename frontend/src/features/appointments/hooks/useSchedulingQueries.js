import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { schedulingApi } from '@/features/appointments/api';
import { createKeyFactory } from '@/shared/lib/queryKeys';
import { appointmentKeys } from './useAppointmentQueries';

const baseKeys = createKeyFactory('scheduling');
const availabilitySlotsKey = [...appointmentKeys.all, 'availableSlots'];

const schedulingKeys = {
  ...baseKeys,
  services: (params = {}) => [...baseKeys.all, 'services', params],
  sessions: (params = {}) => [...baseKeys.all, 'sessions', params],
  templates: (params = {}) => [...baseKeys.all, 'templates', params],
  exceptions: (params = {}) => [...baseKeys.all, 'exceptions', params],
};

export function useSchedulingServices(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: schedulingKeys.services(params),
    queryFn: ({ signal }) => schedulingApi.listServices({ ...params, signal }),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useSchedulingSessions(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: schedulingKeys.sessions(params),
    queryFn: ({ signal }) => schedulingApi.listSessions({ ...params, signal }),
    enabled,
    staleTime: 15 * 1000,
  });
}

export function useSchedulingExceptions(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: schedulingKeys.exceptions(params),
    queryFn: ({ signal }) => schedulingApi.listExceptions({ ...params, signal }),
    enabled,
    staleTime: 15 * 1000,
  });
}

export function useSchedulingTemplates(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: schedulingKeys.templates(params),
    queryFn: ({ signal }) => schedulingApi.listTemplates({ ...params, signal }),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useCreateSchedulingSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => schedulingApi.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schedulingKeys.all });
      queryClient.invalidateQueries({ queryKey: availabilitySlotsKey });
    },
  });
}

export function useCreateSchedulingService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => schedulingApi.createService(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schedulingKeys.all });
    },
  });
}

export function useCreateSchedulingTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => schedulingApi.createTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schedulingKeys.all });
    },
  });
}

export function useGenerateSchedulingSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => schedulingApi.generateSessions(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schedulingKeys.all });
      queryClient.invalidateQueries({ queryKey: availabilitySlotsKey });
    },
  });
}

export function useCreateSchedulingException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => schedulingApi.createException(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schedulingKeys.all });
      queryClient.invalidateQueries({ queryKey: availabilitySlotsKey });
    },
  });
}
