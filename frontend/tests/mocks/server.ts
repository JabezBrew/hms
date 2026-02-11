/**
 * MSW server setup for Node.js (Vitest) environment.
 *
 * This server is used in unit tests to intercept API requests
 * and return mock responses without hitting the real backend.
 */
import { setupServer } from 'msw/node'
import { delay, http, HttpResponse } from 'msw'
import { handlers } from './handlers'

// Create the MSW server with all handlers
export const server = setupServer(...handlers)

// Export handlers for use in tests that need to override specific endpoints
export { handlers }

/**
 * Helper function to add custom handlers for specific tests.
 *
 * Usage:
 *   import { server, addHandler } from '@/tests/mocks/server'
 *   import { http, HttpResponse } from 'msw'
 *
 *   test('handles error case', async () => {
 *     addHandler(
 *       http.get('/api/patients/', () => {
 *         return HttpResponse.json({ detail: 'Error' }, { status: 500 })
 *       })
 *     )
 *     // Test code...
 *   })
 */
export function addHandler(...customHandlers: Parameters<typeof server.use>) {
  server.use(...customHandlers)
}

/**
 * Helper function to reset all handlers to default state.
 * Useful after tests that add custom error handlers.
 */
export function resetHandlers() {
  server.resetHandlers()
}

/**
 * Helper to create an error response handler.
 *
 * Usage:
 *   import { createErrorHandler } from '@/tests/mocks/server'
 *
 *   test('handles 500 error', async () => {
 *     createErrorHandler('get', '/api/patients/', 500, 'Server error')
 *     // Test code...
 *   })
 */
type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export function createErrorHandler(method: HttpMethod, url: string, status: number, message: string) {
  const methodFn = http[method]

  server.use(
    methodFn(url, () => {
      return HttpResponse.json(
        { detail: message },
        { status }
      )
    })
  )
}

/**
 * Helper to create a delayed response handler for testing loading states.
 *
 * Usage:
 *   import { createDelayedHandler } from '@/tests/mocks/server'
 *
 *   test('shows loading state', async () => {
 *     createDelayedHandler('get', '/api/patients/', { data: [] }, 2000)
 *     // Test that loading state is shown
 *   })
 */
export function createDelayedHandler(
  method: HttpMethod,
  url: string,
  responseData: unknown,
  delayMs: number,
) {
  const methodFn = http[method]

  server.use(
    methodFn(url, async () => {
      await delay(delayMs)
      return HttpResponse.json(responseData)
    })
  )
}

/**
 * Helper to create a handler that returns empty results.
 * Useful for testing empty states.
 */
export function createEmptyHandler(method: HttpMethod, url: string) {
  const methodFn = http[method]

  server.use(
    methodFn(url, () => {
      return HttpResponse.json({
        count: 0,
        next: null,
        previous: null,
        results: [],
      })
    })
  )
}
