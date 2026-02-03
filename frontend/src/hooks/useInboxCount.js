import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useInboxItems } from '@/features/inbox/hooks';

/**
 * Hook to get the total inbox count for the sidebar badge
 */
export function useInboxCount() {
  const { user } = useAuth();
  const enabled = Boolean(user);

  const { data: totalData } = useInboxItems({ page_size: 1 }, { enabled });
  const { data: unreadData } = useInboxItems({ status: 'unread', page_size: 1 }, { enabled });
  const { data: actionData } = useInboxItems({ action_required: true, page_size: 1 }, { enabled });

  const unreadCount = unreadData?.count ?? 0;
  const pendingCount = actionData?.count ?? 0;
  const totalCount = totalData?.count ?? 0;

  return {
    count: Math.max(totalCount, unreadCount + pendingCount),
    unreadCount,
    pendingCount,
  };
}

export default useInboxCount;
