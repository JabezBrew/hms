import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { referralsApi } from '@/lib/api/referrals';

// Query keys
export const referralKeys = {
  all: ['referrals'],
  lists: () => [...referralKeys.all, 'list'],
  list: (filters) => [...referralKeys.lists(), { filters }],
  details: () => [...referralKeys.all, 'detail'],
  detail: (id) => [...referralKeys.details(), id],
  inbox: () => [...referralKeys.all, 'inbox'],
  sent: () => [...referralKeys.all, 'sent'],
  pending: () => [...referralKeys.all, 'pending'],
};

/**
 * Get referrals list with optional filtering
 */
export function useReferrals(filters = {}) {
  return useQuery({
    queryKey: referralKeys.list(filters),
    queryFn: () => referralsApi.getReferrals(filters),
  });
}

/**
 * Get a single referral by ID
 */
export function useReferral(id) {
  return useQuery({
    queryKey: referralKeys.detail(id),
    queryFn: () => referralsApi.getReferral(id),
    enabled: !!id,
  });
}

/**
 * Create a new referral
 */
export function useCreateReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => referralsApi.createReferral(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      queryClient.invalidateQueries({ queryKey: referralKeys.sent() });
    },
  });
}

/**
 * Update an existing referral
 */
export function useUpdateReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => referralsApi.updateReferral(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: referralKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
    },
  });
}

/**
 * Submit a referral
 */
export function useSubmitReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => referralsApi.submitReferral(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: referralKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      queryClient.invalidateQueries({ queryKey: referralKeys.sent() });
      queryClient.invalidateQueries({ queryKey: referralKeys.pending() });
    },
  });
}

/**
 * Accept a referral
 */
export function useAcceptReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, acceptanceNotes }) => referralsApi.acceptReferral(id, acceptanceNotes),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: referralKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      queryClient.invalidateQueries({ queryKey: referralKeys.inbox() });
      queryClient.invalidateQueries({ queryKey: referralKeys.pending() });
    },
  });
}

/**
 * Decline a referral
 */
export function useDeclineReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, declineReason }) => referralsApi.declineReferral(id, declineReason),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: referralKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      queryClient.invalidateQueries({ queryKey: referralKeys.inbox() });
    },
  });
}

/**
 * Schedule a referral
 */
export function useScheduleReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, appointmentId }) => referralsApi.scheduleReferral(id, appointmentId),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: referralKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      queryClient.invalidateQueries({ queryKey: referralKeys.inbox() });
      queryClient.invalidateQueries({ queryKey: referralKeys.pending() });
    },
  });
}

/**
 * Complete a referral
 */
export function useCompleteReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, specialistNotes, recommendations }) =>
      referralsApi.completeReferral(id, specialistNotes, recommendations),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: referralKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      queryClient.invalidateQueries({ queryKey: referralKeys.inbox() });
      queryClient.invalidateQueries({ queryKey: referralKeys.sent() });
    },
  });
}

/**
 * Start consultation from a referral
 */
export function useStartConsultation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => referralsApi.startConsultation(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: referralKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
      queryClient.invalidateQueries({ queryKey: referralKeys.inbox() });
      queryClient.invalidateQueries({ queryKey: referralKeys.pending() });
    },
  });
}

/**
 * Update referral response
 */
export function useUpdateReferralResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, specialistNotes, recommendations }) =>
      referralsApi.updateReferralResponse(id, specialistNotes, recommendations),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: referralKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: referralKeys.lists() });
    },
  });
}

/**
 * Get referral inbox (received referrals)
 */
export function useReferralInbox() {
  return useQuery({
    queryKey: referralKeys.inbox(),
    queryFn: () => referralsApi.getReferralInbox(),
  });
}

/**
 * Get sent referrals
 */
export function useReferralsSent() {
  return useQuery({
    queryKey: referralKeys.sent(),
    queryFn: () => referralsApi.getReferralsSent(),
  });
}

/**
 * Get pending referrals (admin view)
 */
export function usePendingReferrals() {
  return useQuery({
    queryKey: referralKeys.pending(),
    queryFn: () => referralsApi.getPendingReferrals(),
  });
}
