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
  inboxCount: () => [...referralKeys.all, 'inbox-count'],
  sent: () => [...referralKeys.all, 'sent'],
  pending: () => [...referralKeys.all, 'pending'],
  notifications: () => ['referralNotifications'],
  notificationCount: () => ['referralNotificationCount'],
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
      queryClient.invalidateQueries({ queryKey: referralKeys.inboxCount() });
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
      queryClient.invalidateQueries({ queryKey: referralKeys.inboxCount() });
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
      queryClient.invalidateQueries({ queryKey: referralKeys.inboxCount() });
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
      queryClient.invalidateQueries({ queryKey: referralKeys.inboxCount() });
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
      queryClient.invalidateQueries({ queryKey: referralKeys.inboxCount() });
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

/**
 * Get referral notifications for current user
 */
export function useReferralNotifications(params = {}) {
  return useQuery({
    queryKey: [...referralKeys.notifications(), params],
    queryFn: () => referralsApi.getNotifications(params),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Get unread referral notification count.
 * Note: WebSocket handles real-time updates, so polling is removed.
 * Increase staleTime since WebSocket invalidates cache on new notifications.
 */
export function useReferralNotificationCount() {
  return useQuery({
    queryKey: referralKeys.notificationCount(),
    queryFn: () => referralsApi.getUnreadNotificationCount(),
    staleTime: 5 * 60 * 1000, // 5 minutes - WebSocket handles real-time updates
  });
}

/**
 * Mark a notification as read with optimistic updates for instant UI feedback.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => referralsApi.markNotificationRead(id),
    onMutate: async (id) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: referralKeys.notifications() });
      await queryClient.cancelQueries({ queryKey: referralKeys.notificationCount() });

      // Snapshot the previous values
      const previousNotifications = queryClient.getQueryData(referralKeys.notifications());
      const previousCount = queryClient.getQueryData(referralKeys.notificationCount());

      // Optimistically update notifications list
      queryClient.setQueriesData({ queryKey: referralKeys.notifications() }, (old) => {
        if (!old?.results) return old;
        return {
          ...old,
          results: old.results.map((n) =>
            n.id === id ? { ...n, is_read: true } : n
          ),
        };
      });

      // Optimistically decrement the count
      queryClient.setQueryData(referralKeys.notificationCount(), (old) => {
        if (typeof old?.count !== 'number') return old;
        return { ...old, count: Math.max(0, old.count - 1) };
      });

      return { previousNotifications, previousCount };
    },
    onError: (_err, _id, context) => {
      // Rollback on error
      if (context?.previousNotifications) {
        queryClient.setQueriesData(
          { queryKey: referralKeys.notifications() },
          context.previousNotifications
        );
      }
      if (context?.previousCount) {
        queryClient.setQueryData(referralKeys.notificationCount(), context.previousCount);
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: referralKeys.notifications() });
      queryClient.invalidateQueries({ queryKey: referralKeys.notificationCount() });
    },
  });
}
