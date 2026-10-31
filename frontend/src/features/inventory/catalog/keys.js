import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const cursor = value => value ? hashQueryValue(value) : null;
export const catalogKeys = {
  all: scope => ['inventory-catalog', scope],
  page: (scope, params) => ['inventory-catalog', scope, 'administration', { limit: params.limit, is_active: params.is_active ?? null, search: hashQueryValue(params.search || ''), cursor: cursor(params.cursor) }],
  detail: (scope, id) => ['inventory-catalog', scope, 'item', hashQueryValue(id)],
  history: (scope, id, params) => ['inventory-catalog', scope, 'history', hashQueryValue(id), { limit: params.limit, cursor: cursor(params.cursor) }],
  categories: (scope, params = {}) => ['inventory-catalog', scope, 'categories', { search: hashQueryValue(params.search || ''), cursor: cursor(params.cursor), limit: params.limit ?? 100 }],
};
