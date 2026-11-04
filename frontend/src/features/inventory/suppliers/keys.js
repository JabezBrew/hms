import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const cursor = value => value ? hashQueryValue(value) : null;
export const supplierKeys = {
  all: scope => ['inventory-supplier-administration', scope],
  page: (scope, params) => [...supplierKeys.all(scope), 'page', { limit: params.limit, is_active: params.is_active ?? null, search: hashQueryValue(params.search || ''), cursor: cursor(params.cursor) }],
  detail: (scope, id) => [...supplierKeys.all(scope), 'supplier', hashQueryValue(id)],
  history: (scope, id, params) => [...supplierKeys.all(scope), 'history', hashQueryValue(id), { limit: params.limit, cursor: cursor(params.cursor) }],
};
