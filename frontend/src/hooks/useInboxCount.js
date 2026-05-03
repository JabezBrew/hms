import { useAuth } from '@/lib/auth';
import { useInboxCounts } from '@/features/inbox/hooks';

/**
 * Hook to get the total inbox count for the sidebar badge
 */
export function useInboxCount() {
  const { user } = useAuth();
  const enabled = Boolean(user);

  const { data: countData } = useInboxCounts({ enabled });

  const unreadCount = countData?.unread ?? 0;
  const pendingCount = countData?.action_required ?? 0;
  const totalCount = countData?.total ?? 0;

  return {
    count: Math.max(totalCount, unreadCount + pendingCount),
    unreadCount,
    pendingCount,
  };
}

export default useInboxCount;
