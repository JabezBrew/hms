import { getV2ClientScopeKey } from './session';

const DEFAULT_OMITTED_KEYS = new Set(['page', 'cursor', 'next_cursor', 'signal']);

function stableValue(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  return Object.keys(value)
    .sort()
    .reduce((accumulator, key) => {
      const nextValue = stableValue(value[key]);
      if (nextValue !== undefined) {
        accumulator[key] = nextValue;
      }
      return accumulator;
    }, {});
}

export function hashCursorValue(value) {
  let hash = 0;
  const input = JSON.stringify(stableValue(value));
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function cursorCacheKey(scope, params = {}, omittedKeys = []) {
  const omitted = new Set([...DEFAULT_OMITTED_KEYS, ...omittedKeys]);
  const cacheParams = Object.keys(params || {})
    .sort()
    .reduce((accumulator, key) => {
      if (!omitted.has(key)) {
        accumulator[key] = params[key];
      }
      return accumulator;
    }, {});
  return `${getV2ClientScopeKey()}:${scope}:${hashCursorValue(cacheParams)}`;
}

export function cursorCacheEntryKey(scope, params = {}, page = Number(params.page || 1), omittedKeys = []) {
  return `${cursorCacheKey(scope, params, omittedKeys)}:${page}`;
}

export function resolveCursorPage(cache, scope, params = {}, omittedKeys = []) {
  const requestedPage = Math.max(1, Number(params.page || 1));
  if (params.cursor || params.next_cursor) {
    return {
      cursor: params.cursor || params.next_cursor,
      page: requestedPage,
      requestedPage,
      cursorMissing: false,
    };
  }
  if (requestedPage <= 1) {
    return {
      cursor: undefined,
      page: 1,
      requestedPage: 1,
      cursorMissing: false,
    };
  }
  const cursor = cache.get(cursorCacheEntryKey(scope, params, requestedPage, omittedKeys));
  return {
    cursor,
    page: cursor ? requestedPage : 1,
    requestedPage,
    cursorMissing: !cursor,
  };
}

export function cacheCursorForNextPage(cache, scope, params = {}, response, omittedKeys = []) {
  const nextCursor = response?.page?.next_cursor;
  if (!nextCursor) {
    return;
  }
  const currentPage = resolveCursorPage(cache, scope, params, omittedKeys).page;
  cache.set(cursorCacheEntryKey(scope, params, currentPage + 1, omittedKeys), nextCursor);
}
