export function hasQueryPrefix(queryKey, prefix) {
  if (!Array.isArray(queryKey) || !Array.isArray(prefix) || prefix.length > queryKey.length) {
    return false;
  }

  return prefix.every((value, index) => Object.is(queryKey[index], value));
}

export function invalidateQueryKeys(queryClient, queryKeys = []) {
  const tasks = queryKeys
    .filter(Boolean)
    .map((queryKey) => queryClient.invalidateQueries({ queryKey }));

  return Promise.all(tasks);
}

export function invalidateQueriesMatching(queryClient, predicate) {
  return queryClient.invalidateQueries({
    predicate: (query) => predicate(query),
  });
}
