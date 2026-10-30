import { hashQueryValue } from '@/shared/lib/privateQueryKey';
export const serviceKeys = {
  all: scope => ['bookable-service-administration', scope],
  page: (scope, query) => [...serviceKeys.all(scope), 'page', { ...query, search: hashQueryValue(query.search || '') }],
};
