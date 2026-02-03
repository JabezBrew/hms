import { useQuery } from '@tanstack/react-query';

import { notificationsApi } from '@/features/inbox/api';
import { createKeyFactory } from '@/shared/lib/queryKeys';

const inboxKeyFactory = createKeyFactory('inbox');

export const inboxKeys = {
  all: inboxKeyFactory.all,
  list: (params = {}) => [...inboxKeyFactory.all, 'list', params],
};

export function useInboxItems(params = {}, options = {}) {
  return useQuery({
    queryKey: inboxKeys.list(params),
    queryFn: () => notificationsApi.getInbox(params),
    staleTime: 30 * 1000,
    ...options,
  });
}
