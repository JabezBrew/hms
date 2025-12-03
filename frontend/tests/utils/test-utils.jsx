/**
 * Custom test utilities for HMS frontend testing.
 *
 * Provides:
 * - renderWithProviders: Custom render function with all app providers
 * - createMockUser: Factory for creating mock user objects
 * - createMockPatient: Factory for creating mock patient objects
 * - Test data factories for common entities
 */
import { render } from '@testing-library/react'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, useContext, useState } from 'react'
import { faker } from '@faker-js/faker'

// =============================================================================
// Mock Auth Context
// =============================================================================

const MockAuthContext = createContext(undefined)

/**
 * Mock auth provider for testing.
 * Provides a controlled auth state for tests.
 */
export function MockAuthProvider({
  children,
  initialUser = null,
  initialLoading = false,
  isAuthenticated: initialIsAuthenticated = null,
}) {
  const [user, setUser] = useState(initialUser)
  const [loading] = useState(initialLoading)

  const isAuthenticated = initialIsAuthenticated !== null
    ? initialIsAuthenticated
    : !!user

  const login = async (email, password) => {
    // Mock login - set user from mock data
    const mockUser = createMockUser({ email })
    setUser(mockUser)
    return mockUser
  }

  const logout = async () => {
    setUser(null)
  }

  const value = {
    user,
    loading,
    isAuthenticated,
    login,
    logout,
    setUser,
    getAccessToken: () => 'mock-access-token',
    refreshAuth: async () => {},
    isSessionValid: () => true,
    sessionExpiresAt: null,
    absoluteTimeoutAt: null,
    extendSession: () => {},
  }

  return (
    <MockAuthContext.Provider value={value}>
      {children}
    </MockAuthContext.Provider>
  )
}

/**
 * Hook to use mock auth context in tests.
 */
export function useMockAuth() {
  const context = useContext(MockAuthContext)
  if (!context) {
    throw new Error('useMockAuth must be used within a MockAuthProvider')
  }
  return context
}

// =============================================================================
// Query Client Factory
// =============================================================================

/**
 * Create a fresh QueryClient for testing.
 * Each test gets its own QueryClient to prevent state leakage.
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Disable retries for faster test failures
        retry: false,
        // Disable automatic refetching
        refetchOnWindowFocus: false,
        // Shorter stale time for testing
        staleTime: 0,
        // Shorter garbage collection time
        gcTime: 0,
      },
      mutations: {
        // Disable retries for mutations too
        retry: false,
      },
    },
    // Suppress console errors in tests
    logger: {
      log: console.log,
      warn: console.warn,
      error: () => {},
    },
  })
}

// =============================================================================
// Custom Render Functions
// =============================================================================

/**
 * Render with all providers - the main test render function.
 *
 * @param {React.ReactElement} ui - Component to render
 * @param {Object} options - Render options
 * @param {Object} options.user - Initial user for auth context
 * @param {string} options.route - Initial route (for MemoryRouter)
 * @param {boolean} options.useMemoryRouter - Use MemoryRouter instead of BrowserRouter
 * @param {Object} options.queryClient - Custom QueryClient
 * @param {Object} options.renderOptions - Additional render options
 * @returns {Object} Render result with utilities
 */
export function renderWithProviders(
  ui,
  {
    user = null,
    isAuthenticated = null,
    route = '/',
    useMemoryRouter = false,
    queryClient = createTestQueryClient(),
    ...renderOptions
  } = {}
) {
  // Router component based on configuration
  const Router = useMemoryRouter
    ? ({ children }) => (
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      )
    : ({ children }) => <BrowserRouter>{children}</BrowserRouter>

  // Wrapper with all providers
  function AllProviders({ children }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MockAuthProvider initialUser={user} isAuthenticated={isAuthenticated}>
          <Router>
            {children}
          </Router>
        </MockAuthProvider>
      </QueryClientProvider>
    )
  }

  return {
    ...render(ui, { wrapper: AllProviders, ...renderOptions }),
    // Return utilities for test manipulation
    queryClient,
    setUser: (newUser) => {
      // Note: This won't actually update the provider state
      // Tests should re-render if they need different user state
    },
  }
}

/**
 * Render with query client only (no auth, no router).
 * Useful for testing hooks or components that don't need auth/routing.
 */
export function renderWithQueryClient(ui, queryClient = createTestQueryClient()) {
  function Wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }

  return {
    ...render(ui, { wrapper: Wrapper }),
    queryClient,
  }
}

// =============================================================================
// Mock Data Factories
// =============================================================================

/**
 * Create a mock user object.
 */
export function createMockUser(overrides = {}) {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    username: faker.internet.userName(),
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    user_type: 'doctor',
    phone_number: faker.phone.number(),
    is_active: true,
    is_staff: false,
    is_superuser: false,
    date_joined: faker.date.past().toISOString(),
    ...overrides,
  }
}

/**
 * Create a mock patient object.
 */
export function createMockPatient(overrides = {}) {
  const firstName = faker.person.firstName()
  const lastName = faker.person.lastName()

  return {
    id: faker.string.uuid(),
    user: {
      id: faker.string.uuid(),
      email: faker.internet.email(),
      first_name: firstName,
      last_name: lastName,
    },
    medical_record_number: `MRN${faker.string.numeric(6)}`,
    blood_group: faker.helpers.arrayElement(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
    allergies: faker.helpers.maybe(() => faker.lorem.words(3), { probability: 0.3 }),
    emergency_contact_name: faker.person.fullName(),
    emergency_contact_phone: faker.phone.number(),
    emergency_contact_relationship: faker.helpers.arrayElement(['Spouse', 'Parent', 'Child', 'Sibling']),
    created_at: faker.date.past().toISOString(),
    updated_at: faker.date.recent().toISOString(),
    ...overrides,
  }
}

/**
 * Create a mock vital signs object.
 */
export function createMockVitalSigns(overrides = {}) {
  return {
    id: faker.string.uuid(),
    patient: faker.string.uuid(),
    temperature: faker.number.float({ min: 36.0, max: 38.5, fractionDigits: 1 }),
    heart_rate: faker.number.int({ min: 60, max: 100 }),
    blood_pressure_systolic: faker.number.int({ min: 100, max: 140 }),
    blood_pressure_diastolic: faker.number.int({ min: 60, max: 90 }),
    respiratory_rate: faker.number.int({ min: 12, max: 20 }),
    oxygen_saturation: faker.number.int({ min: 95, max: 100 }),
    pain_level: faker.number.int({ min: 0, max: 3 }),
    recorded_at: faker.date.recent().toISOString(),
    is_critical: false,
    notes: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.2 }),
    ...overrides,
  }
}

/**
 * Create a mock ward object.
 */
export function createMockWard(overrides = {}) {
  return {
    id: faker.string.uuid(),
    name: `${faker.word.adjective()} Ward`,
    description: faker.lorem.sentence(),
    ward_type: faker.helpers.arrayElement(['general', 'private', 'icu', 'emergency', 'maternity']),
    is_active: true,
    total_beds: faker.number.int({ min: 10, max: 30 }),
    available_beds_count: faker.number.int({ min: 0, max: 10 }),
    base_rate_per_night: faker.number.float({ min: 50, max: 500, fractionDigits: 2 }),
    ...overrides,
  }
}

/**
 * Create a mock appointment object.
 */
export function createMockAppointment(overrides = {}) {
  const startTime = faker.date.future()
  return {
    id: faker.string.uuid(),
    patient: createMockPatient(),
    practitioner: createMockUser({ user_type: 'doctor' }),
    appointment_type: faker.helpers.arrayElement(['consultation', 'follow_up', 'procedure']),
    status: faker.helpers.arrayElement(['scheduled', 'confirmed', 'completed', 'cancelled']),
    start_time: startTime.toISOString(),
    end_time: new Date(startTime.getTime() + 30 * 60000).toISOString(),
    reason: faker.lorem.sentence(),
    notes: faker.helpers.maybe(() => faker.lorem.paragraph(), { probability: 0.3 }),
    ...overrides,
  }
}

/**
 * Create a mock nursing task object.
 */
export function createMockNursingTask(overrides = {}) {
  return {
    id: faker.string.uuid(),
    patient: faker.string.uuid(),
    assigned_nurse: faker.string.uuid(),
    task_type: faker.helpers.arrayElement(['medication', 'assessment', 'vitals', 'wound_care', 'hygiene']),
    priority: faker.helpers.arrayElement(['low', 'medium', 'high', 'critical']),
    status: faker.helpers.arrayElement(['pending', 'in_progress', 'completed']),
    description: faker.lorem.sentence(),
    due_time: faker.date.future().toISOString(),
    completed_at: null,
    notes: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.3 }),
    ...overrides,
  }
}

/**
 * Create a mock prescription object.
 */
export function createMockPrescription(overrides = {}) {
  return {
    id: faker.string.uuid(),
    patient: faker.string.uuid(),
    prescriber: faker.string.uuid(),
    medication_name: faker.helpers.arrayElement(['Amoxicillin', 'Ibuprofen', 'Metformin', 'Lisinopril']),
    dosage: faker.helpers.arrayElement(['500mg', '250mg', '10mg', '20mg']),
    frequency: faker.helpers.arrayElement(['once_daily', 'twice_daily', 'three_times_daily', 'as_needed']),
    route: faker.helpers.arrayElement(['oral', 'intravenous', 'intramuscular', 'topical']),
    duration_days: faker.number.int({ min: 3, max: 30 }),
    start_date: faker.date.recent().toISOString(),
    status: faker.helpers.arrayElement(['active', 'completed', 'cancelled']),
    instructions: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.5 }),
    ...overrides,
  }
}

// =============================================================================
// Test Assertion Helpers
// =============================================================================

/**
 * Wait for an element to be removed from the DOM.
 */
export async function waitForElementToBeRemoved(callback, options = {}) {
  const { timeout = 5000, interval = 50 } = options
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const element = callback()
      if (!element || (Array.isArray(element) && element.length === 0)) {
        return
      }
    } catch {
      // Element not found, which is what we want
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error('Element was not removed within timeout')
}

/**
 * Assert that an element has specific text content.
 */
export function assertTextContent(element, expectedText) {
  const actualText = element.textContent
  if (!actualText.includes(expectedText)) {
    throw new Error(
      `Expected element to contain text "${expectedText}", but got "${actualText}"`
    )
  }
}

// =============================================================================
// Re-export testing-library utilities
// =============================================================================

export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
