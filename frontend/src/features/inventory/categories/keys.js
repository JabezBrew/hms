import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const cursor = value => value ? hashQueryValue(value) : null;
export const categoryKeys = {
  all: scope => ['inventory-category-administration', scope],
  page: (scope, params) => [...categoryKeys.all(scope), 'page', { limit: params.limit, is_active: params.is_active ?? null, search: hashQueryValue(params.search || ''), cursor: cursor(params.cursor) }],
  detail: (scope, id) => [...categoryKeys.all(scope), 'category', hashQueryValue(id)],
  history: (scope, id, params) => [...categoryKeys.all(scope), 'history', hashQueryValue(id), { limit: params.limit, cursor: cursor(params.cursor) }],
  parents: (scope, params) => [...categoryKeys.all(scope), 'parents', { limit: params.limit, is_active: true, search: hashQueryValue(params.search || ''), cursor: cursor(params.cursor) }],
};
