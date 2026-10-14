import { describe, expect, it, vi } from 'vitest'
import { queryClient } from '../react-query'

describe('clinical mutation retries', () => {
  it('does not repeat a write after its response is lost', async () => {
    const write = vi.fn().mockRejectedValue(new Error('response lost after commit'))
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn: write })
    await expect(mutation.execute({})).rejects.toThrow('response lost after commit')
    expect(write).toHaveBeenCalledTimes(1)
    queryClient.getMutationCache().remove(mutation)
  })

  it('allows a proven idempotent operation to request an explicit retry', async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce('confirmed')
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: write,
      retry: 1,
      retryDelay: 0,
    })
    await expect(mutation.execute({})).resolves.toBe('confirmed')
    expect(write).toHaveBeenCalledTimes(2)
    queryClient.getMutationCache().remove(mutation)
  })
})
