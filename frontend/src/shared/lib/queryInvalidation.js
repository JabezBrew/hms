export function hasQueryPrefix(queryKey, prefix) {
  if (!Array.isArray(queryKey) || !Array.isArray(prefix) || prefix.length > queryKey.length) {
    return false;
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (!Object.is(queryKey[index], prefix[index])) {
      return false;
    }
  }

  return true;
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
