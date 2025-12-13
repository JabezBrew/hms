/**
 * Vitest test setup file.
 *
 * This file runs before each test file and configures:
 * - @testing-library/jest-dom matchers
 * - MSW server for API mocking
 * - Browser API mocks (matchMedia, IntersectionObserver, etc.)
 * - localStorage/sessionStorage mocks
 * - Cleanup after each test
 */
import { expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Import MSW server (to be created)
import { server } from './mocks/server'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// =============================================================================
// MSW Server Setup
// =============================================================================

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' })
})

// Reset handlers after each test (important for test isolation)
afterEach(() => {
  server.resetHandlers()
})

// Close MSW server after all tests
afterAll(() => {
  server.close()
})

// =============================================================================
// React Testing Library Cleanup
// =============================================================================

// Cleanup DOM after each test
afterEach(() => {
  cleanup()
})

// =============================================================================
// Browser API Mocks
// =============================================================================

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock IntersectionObserver
class MockIntersectionObserver {
  constructor(callback) {
    this.callback = callback
  }

  observe() {
    return null
  }

  unobserve() {
    return null
  }

  disconnect() {
    return null
  }
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
})

// Mock ResizeObserver
class MockResizeObserver {
  constructor(callback) {
    this.callback = callback
  }

  observe() {
    return null
  }

  unobserve() {
    return null
  }

  disconnect() {
    return null
  }
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
})

// Mock scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
})

// =============================================================================
// Storage Mocks
// =============================================================================

// Mock localStorage
const localStorageMock = {
  store: {},
  getItem(key) {
    return this.store[key] || null
  },
  setItem(key, value) {
    this.store[key] = String(value)
  },
  removeItem(key) {
    delete this.store[key]
  },
  clear() {
    this.store = {}
  },
  get length() {
    return Object.keys(this.store).length
  },
  key(index) {
    return Object.keys(this.store)[index] || null
  },
}

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock sessionStorage
const sessionStorageMock = {
  store: {},
  getItem(key) {
    return this.store[key] || null
  },
  setItem(key, value) {
    this.store[key] = String(value)
  },
  removeItem(key) {
    delete this.store[key]
  },
  clear() {
    this.store = {}
  },
  get length() {
    return Object.keys(this.store).length
  },
  key(index) {
    return Object.keys(this.store)[index] || null
  },
}

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
})

// Clear storage before each test
afterEach(() => {
  localStorageMock.clear()
  sessionStorageMock.clear()
})

// =============================================================================
// URL and Navigation Mocks
// =============================================================================

// Mock window.location
const locationMock = {
  href: 'http://localhost:5173',
  origin: 'http://localhost:5173',
  pathname: '/',
  search: '',
  hash: '',
  assign: vi.fn(),
  replace: vi.fn(),
  reload: vi.fn(),
}

Object.defineProperty(window, 'location', {
  writable: true,
  value: locationMock,
})

// =============================================================================
// Crypto API Mock (for UUID generation)
// =============================================================================

Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    },
    getRandomValues: (arr) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256)
      }
      return arr
    },
  },
})

// =============================================================================
// Console Suppression (optional - uncomment if needed)
// =============================================================================

// Suppress console.error for expected errors during tests
// const originalError = console.error
// beforeAll(() => {
//   console.error = (...args) => {
//     if (
//       typeof args[0] === 'string' &&
//       args[0].includes('Warning: ReactDOM.render is no longer supported')
//     ) {
//       return
//     }
//     originalError.call(console, ...args)
//   }
// })

// afterAll(() => {
//   console.error = originalError
// })

// =============================================================================
// Global Test Utilities
// =============================================================================

// Add any global test utilities here
globalThis.testUtils = {
  // Helper to wait for async operations
  waitFor: async (callback, { timeout = 5000, interval = 50 } = {}) => {
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      try {
        await callback()
        return
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
    }
    throw new Error('Timed out waiting for condition')
  },

  // Helper to create a delay
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

  // Helper to mock fetch response
  mockFetchResponse: (data, status = 200) => {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    })
  },
}
