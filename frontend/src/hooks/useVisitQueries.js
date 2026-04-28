/**
 * React Query hooks for outpatient visit lifecycle and triage queue management.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { visitsApi, triageApi } from '@/features/triage/api';
import { appointmentKeys } from '@/features/appointments/hooks/useAppointmentQueries';
import { invalidateEncounterMutationQueries } from '@/features/encounters/hooks/useEncounterQueries';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import {
  dashboardKeys,
  invalidateOperationalDoctorDashboardQueries,
} from '@/hooks/useDashboardQueries';
import {
  hasQueryPrefix,
  invalidateQueriesMatching,
  invalidateQueryKeys,
} from '@/shared/lib/queryInvalidation';

// =============================================================================
// Query Keys
// =============================================================================

const visitKeyFactory = createKeyFactory('visits');
const triageKeyFactory = createKeyFactory('triage');

export const visitKeys = {
  all: visitKeyFactory.all,
  waitingRoom: (clinicId) => keyWith('visits', 'waiting-room', clinicId),
  detail: (encounterId) => visitKeyFactory.detail(encounterId),
};

export const triageKeys = {
  all: triageKeyFactory.all,
  list: (filters) => triageKeyFactory.list(filters),
  detail: (id) => triageKeyFactory.detail(id),
};

function getVisitMutationEncounterId(variables) {
  if (!variables) return null;

  if (typeof variables === 'string' || typeof variables === 'number') {
    return variables;
  }

  return variables.encounterId ?? variables.id ?? null;
}

export function invalidateVisitMutationQueries(queryClient, encounterId) {
  const tasks = [
    invalidateQueriesMatching(queryClient, (query) =>
      hasQueryPrefix(query.queryKey, ['visits', 'waiting-room'])
    ),
    invalidateOperationalDoctorDashboardQueries(queryClient),
    invalidateEncounterMutationQueries(queryClient, { encounterId }),
  ];

  if (encounterId) {
    tasks.push(invalidateQueryKeys(queryClient, [visitKeys.detail(encounterId)]));
  }

  return Promise.all(tasks);
}

// =============================================================================
// Waiting Room Queries
// =============================================================================

/**
 * Get waiting room queue for a clinic with real-time polling
 * @param {string} clinicId - The clinic UUID
 * @param {Object} options - Query options
 */
export function useWaitingRoom(clinicId, options = {}) {
  const { facilityCode } = useAuth();

  return useQuery({
    queryKey: visitKeys.waitingRoom(clinicId),
    queryFn: () => visitsApi.waitingRoom(clinicId),
    refetchInterval: 10000, // Poll every 10 seconds
    refetchIntervalInBackground: false,
    staleTime: 5000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode) && Boolean(clinicId),
  });
}

/**
 * Get visit details for an encounter
 */
export function useVisit(encounterId, options = {}) {
  const { facilityCode } = useAuth();

  return useQuery({
    queryKey: visitKeys.detail(encounterId),
    queryFn: () => visitsApi.get(encounterId),
    staleTime: 30000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode) && Boolean(encounterId),
  });
}

// =============================================================================
// Visit Action Mutations
// =============================================================================

/**
 * Hook providing all visit state transition mutations
 */
export function useVisitActions() {
  const queryClient = useQueryClient();

  const invalidateVisitQueries = (variables) => {
    const encounterId = getVisitMutationEncounterId(variables);
    return invalidateVisitMutationQueries(queryClient, encounterId);
  };

  const addToWaiting = useMutation({
    mutationFn: (encounterId) => visitsApi.addToWaiting(encounterId),
    onSuccess: (data, variables) => {
      toast.success('Patient added to waiting room');
      void invalidateVisitQueries(variables);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to add patient to waiting room');
    },
  });

  const callPatient = useMutation({
    mutationFn: (encounterId) => visitsApi.call(encounterId),
    onSuccess: (data, variables) => {
      toast.success('Patient called');
      void invalidateVisitQueries(variables);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to call patient');
    },
  });

  const startConsultation = useMutation({
    mutationFn: (encounterId) => visitsApi.startConsultation(encounterId),
    onSuccess: (data, variables) => {
      toast.success('Consultation started');
      void invalidateVisitQueries(variables);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to start consultation');
    },
  });

  const putOnHold = useMutation({
    mutationFn: (encounterId) => visitsApi.hold(encounterId),
    onSuccess: (data, variables) => {
      toast.success('Consultation on hold');
      void invalidateVisitQueries(variables);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to put on hold');
    },
  });

  const endConsultation = useMutation({
    mutationFn: (encounterId) => visitsApi.endConsultation(encounterId),
    onSuccess: (data, variables) => {
      toast.success('Consultation ended');
      void invalidateVisitQueries(variables);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to end consultation');
    },
  });

  const checkout = useMutation({
    mutationFn: ({ encounterId, force = false }) => visitsApi.checkout(encounterId, force),
    onSuccess: (data, variables) => {
      toast.success('Patient checked out');
      void invalidateVisitQueries(variables);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to checkout patient');
    },
  });

  const markNoShow = useMutation({
    mutationFn: (encounterId) => visitsApi.noShow(encounterId),
    onSuccess: (data, variables) => {
      toast.success('Patient marked as no-show');
      void invalidateVisitQueries(variables);
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to mark no-show');
    },
  });

  return {
    addToWaiting,
    callPatient,
    startConsultation,
    putOnHold,
    endConsultation,
    checkout,
    markNoShow,
  };
}

// =============================================================================
// Triage Queue Queries
// =============================================================================

/**
 * Get triage queue with real-time polling
 * @param {Object} filters - { status, priority }
 * @param {Object} options - Query options
 */
export function useTriageQueue(filters = {}, options = {}) {
  const { facilityCode } = useAuth();

  return useQuery({
    queryKey: triageKeys.list(filters),
    queryFn: () => triageApi.list(filters),
    refetchInterval: 15000, // Poll every 15 seconds
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}

/**
 * Get single triage entry
 */
export function useTriageEntry(id, options = {}) {
  const { facilityCode } = useAuth();

  return useQuery({
    queryKey: triageKeys.detail(id),
    queryFn: () => triageApi.get(id),
    staleTime: 30000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode) && Boolean(id),
  });
}

// =============================================================================
// Triage Action Mutations
// =============================================================================

/**
 * Hook providing all triage workflow mutations
 */
export function useTriageActions() {
  const queryClient = useQueryClient();

  const invalidateTriageQueries = () => {
    queryClient.invalidateQueries({ queryKey: triageKeys.all });
    queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  };

  const addToQueue = useMutation({
    mutationFn: (data) => triageApi.create(data),
    onSuccess: () => {
      toast.success('Patient added to triage queue');
      invalidateTriageQueries();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to add patient to queue');
    },
  });

  const triagePatient = useMutation({
    mutationFn: ({ id, priority, notes }) => triageApi.triage(id, { priority, notes }),
    onSuccess: () => {
      toast.success('Triage assessment saved');
      invalidateTriageQueries();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to save triage assessment');
    },
  });

  const assignToClinic = useMutation({
    mutationFn: ({ id, ...data }) => triageApi.assign(id, data),
    onSuccess: () => {
      toast.success('Patient assigned to clinic');
      invalidateTriageQueries();
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to assign patient');
    },
  });

  const cancelEntry = useMutation({
    mutationFn: (id) => triageApi.cancel(id),
    onSuccess: () => {
      toast.success('Triage entry cancelled');
      invalidateTriageQueries();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to cancel entry');
    },
  });

  return {
    addToQueue,
    triagePatient,
    assignToClinic,
    cancelEntry,
  };
}
