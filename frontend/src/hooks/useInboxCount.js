import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { referralsApi } from '@/lib/api/referrals';
import { referralKeys } from '@/hooks/useReferralQueries';

/**
 * Hook to get the total inbox count for the sidebar badge
 * Combines unread referral notifications + pending action items
 */
export function useInboxCount() {
  const { user } = useAuth();
  const isDoctor = user && ['doctor', 'inpatient_doctor'].includes(user.role);

  // Unread referral notifications count
  const { data: unreadCount = 0 } = useQuery({
    queryKey: referralKeys.notificationCount(),
    queryFn: () => referralsApi.getUnreadNotificationCount(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    enabled: isDoctor,
  });

  // Pending referrals count (items requiring action)
  const { data: pendingCount = 0 } = useQuery({
    queryKey: referralKeys.inboxCount(),
    queryFn: () => referralsApi.getReferralInboxCount(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    enabled: isDoctor,
  });

  // For doctors: unread notifications + pending referrals
  // For others: 0 (could extend later for other notification types)
  const totalCount = isDoctor ? unreadCount + pendingCount : 0;

  return {
    count: totalCount,
    unreadCount,
    pendingCount,
    isDoctor,
  };
}

export default useInboxCount;
