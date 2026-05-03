import { useQuery } from '@tanstack/react-query';

import { notificationsApi } from '@/features/inbox/api';
import { createKeyFactory } from '@/shared/lib/queryKeys';

const inboxKeyFactory = createKeyFactory('inbox');

export const inboxKeys = {
  all: inboxKeyFactory.all,
  list: (params = {}) => [...inboxKeyFactory.all, 'list', params],
  counts: () => [...inboxKeyFactory.all, 'counts'],
};

export function useInboxItems(params = {}, options = {}) {
  return useQuery({
    queryKey: inboxKeys.list(params),
    queryFn: ({ signal }) => notificationsApi.getInbox(params, { signal }),
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useInboxCounts(options = {}) {
  return useQuery({
    queryKey: inboxKeys.counts(),
    queryFn: ({ signal }) => notificationsApi.getInboxCounts({ signal }),
    staleTime: 30 * 1000,
    ...options,
  });
}
