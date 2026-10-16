import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { inventoryKeys } from '@/features/inventory/hooks';
import { standingApi } from './api';
export const standingKeys = {
  root: ['standing-templates'],
  all: () => ['standing-templates', getV2ClientScopeKey()],
  list: (query) => [...standingKeys.all(), 'list', query],
  detail: (id) => [...standingKeys.all(), 'detail', id],
  review: (id) => [...standingKeys.all(), 'request-review', id],
  choices: (kind, nonce, cursor) => [...standingKeys.all(), 'choices', kind, nonce, cursor || 'first'],
};
export function useStandingTemplates(query, enabled = true) {
  return useQuery({ queryKey: standingKeys.list(query), queryFn: ({ signal }) => standingApi.list(query, { signal }), enabled, retry: false, staleTime: 0 });
}
export function useStandingTemplate(id) {
  return useQuery({ queryKey: standingKeys.detail(id), queryFn: ({ signal }) => standingApi.get(id, { signal }), enabled: Boolean(id), retry: false, staleTime: 0, refetchOnMount: 'always' });
}
export function useStandingRequestReview(id) {
  return useQuery({ queryKey: standingKeys.review(id), queryFn: ({ signal }) => standingApi.review(id, { signal }), enabled: Boolean(id), retry: false, staleTime: 0, refetchOnMount: 'always' });
}
export function useStandingWrite(operation) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: standingKeys.root });
    void client.invalidateQueries({ queryKey: inventoryKeys.internalRequisitions() });
    if (operation === 'issue') void client.invalidateQueries({ queryKey: inventoryKeys.all });
  };
  return useMutation({
    retry: false,
    mutationFn: (payload) => standingApi[operation](...payload),
    onSuccess: (data) => {
      if (['approve', 'issue', 'cancel'].includes(operation)) client.setQueryData(standingKeys.review(data.id), data);
      refresh();
    },
    onError: (error) => { if (error.code === 'standing_write_unconfirmed') refresh(); },
  });
}
