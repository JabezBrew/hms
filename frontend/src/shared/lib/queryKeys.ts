export function createKeyFactory(baseKey) {
  const all = [baseKey]
  return {
    all,
    lists: () => [...all, 'list'],
    list: (filters) => [...all, 'list', { filters }],
    details: () => [...all, 'detail'],
    detail: (id) => [...all, 'detail', id],
  }
}

export function keyWith(baseKey, ...parts) {
  return [baseKey, ...parts]
}
