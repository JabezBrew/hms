import { hashQueryValue } from '@/shared/lib/privateQueryKey';
export const storageLocationKeys = {
  all: scope => ['storage-location-administration', scope],
  page: (scope, query) => [...storageLocationKeys.all(scope), 'page', { ...query, search: hashQueryValue(query.search || '') }],
};
