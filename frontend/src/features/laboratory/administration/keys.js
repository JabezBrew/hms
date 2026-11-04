import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const opaque = value => value ? hashQueryValue(value) : null;
export const catalogKeys = {
  all: scope => ['laboratory-catalog-administration', scope],
  page: (scope, kind, params) => [...catalogKeys.all(scope), kind, 'page', { limit: params.limit, search: opaque(params.search), cursor: opaque(params.cursor), category: opaque(params.category), is_active: params.is_active ?? null, is_system_default: params.is_system_default ?? null, is_facility_modified: params.is_facility_modified ?? null }],
  detail: (scope, kind, id) => [...catalogKeys.all(scope), kind, 'detail', opaque(id)],
  history: (scope, kind, id, params) => [...catalogKeys.all(scope), kind, 'history', opaque(id), { limit: params.limit, cursor: opaque(params.cursor) }],
};
