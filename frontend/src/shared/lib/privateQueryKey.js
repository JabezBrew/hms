export function hashQueryValue(value) {
  const input = String(value || '')
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index)
    hash |= 0
  }
  return String(hash)
}
