import { useAuth } from '@/lib/auth';
import { useInboxCounts, inboxKeys } from '@/features/inbox/hooks';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useAuthScope } from '@/features/auth/useAuthScope';
import { optionalReadAccess } from '@/shared/lib/optionalReadAccess';

/** Hook to get the total inbox count for the sidebar badge. */
export function useInboxCount() {
  const { user } = useAuth();
  const rust = isRustV2ApiMode();
  const scope = useAuthScope(user);
  const enabled = Boolean(user) && (!rust || optionalReadAccess(user).notifications);
  const { data: countData, isError } = useInboxCounts({
    ...(rust ? { queryKey: [...inboxKeys.counts(), scope] } : {}),
    enabled,
  });
  const available = !rust || (enabled && !isError && Boolean(countData));
  if (!available) return { count: null, unreadCount: null, pendingCount: null, available: false };

  const unreadCount = countData?.unread ?? 0;
  const pendingCount = countData?.action_required ?? 0;
  const totalCount = countData?.total ?? 0;
  return { count: Math.max(totalCount, unreadCount + pendingCount), unreadCount, pendingCount, available };
}

export default useInboxCount;
