import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { referralsApi } from '@/features/referrals/api';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys
const referralKeyFactory = createKeyFactory('referrals');

export const referralKeys = {
  all: referralKeyFactory.all,
  lists: referralKeyFactory.lists,
  list: (filters) => referralKeyFactory.list(filters),
  details: referralKeyFactory.details,
  detail: (id) => referralKeyFactory.detail(id),
  inbox: () => keyWith('referrals', 'inbox'),
  inboxCount: () => keyWith('referrals', 'inbox-count'),
  sent: () => keyWith('referrals', 'sent'),
  pending: () => keyWith('referrals', 'pending'),
  slaDashboard: () => keyWith('referrals', 'sla-dashboard'),
  slaState: (id) => keyWith('referrals', 'sla-state', id),
  clinicWaitlist: (filters) => keyWith('referrals', 'clinic-waitlist', filters),
  clinicWaitlistSummary: () => keyWith('referrals', 'clinic-waitlist-summary'),
  notifications: () => keyWith('referralNotifications'),
  notificationCount: () => keyWith('referralNotificationCount'),
};

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
 * Get referral inbox (received referrals)
 */
export function useReferralInbox() {
  return useQuery({
    queryKey: referralKeys.inbox(),
    queryFn: ({ signal }) => referralsApi.getReferralInbox({ signal }),
  });
}

/**
 * Get sent referrals
 */
export function useReferralsSent() {
  return useQuery({
    queryKey: referralKeys.sent(),
    queryFn: ({ signal }) => referralsApi.getReferralsSent({ signal }),
  });
}

/**
 * Get aggregate referral SLA dashboard for open referrals.
 */
export function useReferralSlaDashboard(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: referralKeys.slaDashboard(),
    queryFn: ({ signal }) => referralsApi.getReferralSlaDashboard({ signal }),
    enabled,
    staleTime: 30 * 1000,
  });
}

/**
 * Get SLA state for one referral.
 */
export function useReferralSlaState(id, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: referralKeys.slaState(id),
    queryFn: ({ signal }) => referralsApi.getReferralSlaState(id, { signal }),
    enabled: enabled && !!id,
    staleTime: 30 * 1000,
  });
}

/**
 * Get clinic waitlist entries.
 */
export function useClinicWaitlist(filters = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: referralKeys.clinicWaitlist(filters),
    queryFn: ({ signal }) => referralsApi.getClinicWaitlist(filters, { signal }),
    enabled,
  });
}

/**
 * Get aggregate waitlist summary rows.
 */
export function useClinicWaitlistSummary(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: referralKeys.clinicWaitlistSummary(),
    queryFn: ({ signal }) => referralsApi.getClinicWaitlistSummary({ signal }),
    enabled,
    staleTime: 30 * 1000,
  });
}

/**
 * Get referral notifications for current user
 */
export function useReferralNotifications(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: [...referralKeys.notifications(), params],
    queryFn: ({ signal }) => referralsApi.getNotifications(params, { signal }),
    staleTime: 30 * 1000, // 30 seconds
    enabled,
  });
}

/**
 * Get unread referral notification count.
 * Note: WebSocket handles real-time updates, so polling is removed.
 * Increase staleTime since WebSocket invalidates cache on new notifications.
 */
export function useReferralNotificationCount(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: referralKeys.notificationCount(),
    queryFn: ({ signal }) => referralsApi.getUnreadNotificationCount({ signal }),
    staleTime: 5 * 60 * 1000, // 5 minutes - WebSocket handles real-time updates
    enabled,
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
