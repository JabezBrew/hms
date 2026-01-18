import { useQuery } from '@tanstack/react-query';

import { notificationsApi } from '@/lib/api/notifications';

export const inboxKeys = {
  all: ['inbox'],
  list: (params = {}) => [...inboxKeys.all, 'list', params],
};

export function useInboxItems(params = {}, options = {}) {
  return useQuery({
    queryKey: inboxKeys.list(params),
    queryFn: () => notificationsApi.getInbox(params),
    staleTime: 30 * 1000,
    ...options,
  });
}
