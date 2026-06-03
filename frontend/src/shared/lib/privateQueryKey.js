function createPrivateQueryKeySalt() {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const values = new Uint32Array(4)
      crypto.getRandomValues(values)
      return Array.from(values, (value) => value.toString(36)).join('-')
    }
  } catch {
    // Fall back to process-local entropy for non-browser test environments.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const PRIVATE_QUERY_KEY_SALT = createPrivateQueryKeySalt()

export function hashQueryValue(value) {
  const input = `${PRIVATE_QUERY_KEY_SALT}:${String(value ?? '')}`
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(36)
}
