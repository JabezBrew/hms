/**
 * MSW request handlers for API mocking.
 *
 * These handlers intercept API requests and return mock responses.
 * Organized by API domain (auth, patients, nursing, etc.)
 */
import { http, HttpResponse } from 'msw'
import { faker } from '@faker-js/faker'

const API_BASE = '/api'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a paginated response.
 */
function paginatedResponse(results, total = null) {
  const count = total ?? results.length
  return {
    count,
    next: null,
    previous: null,
    results,
  }
}

/**
 * Generate a mock UUID.
 */
function mockUUID() {
  return faker.string.uuid()
}

// =============================================================================
// Mock Data Generators
// =============================================================================

function generateMockUser(overrides = {}) {
  return {
    id: mockUUID(),
    email: faker.internet.email(),
    username: faker.internet.userName(),
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    user_type: 'doctor',
    phone_number: faker.phone.number(),
    is_active: true,
    ...overrides,
  }
}

function generateMockPatient(overrides = {}) {
  return {
    id: mockUUID(),
    user: generateMockUser({ user_type: 'patient' }),
    medical_record_number: `MRN${faker.string.numeric(6)}`,
    blood_group: faker.helpers.arrayElement(['A+', 'B+', 'O+', 'AB+']),
    allergies: faker.helpers.maybe(() => 'Penicillin', { probability: 0.3 }),
    emergency_contact_name: faker.person.fullName(),
    emergency_contact_phone: faker.phone.number(),
    ...overrides,
  }
}

function generateMockVitalSigns(overrides = {}) {
  return {
    id: mockUUID(),
    temperature: faker.number.float({ min: 36.5, max: 37.5, fractionDigits: 1 }),
    heart_rate: faker.number.int({ min: 60, max: 100 }),
    blood_pressure_systolic: faker.number.int({ min: 110, max: 130 }),
    blood_pressure_diastolic: faker.number.int({ min: 70, max: 85 }),
    respiratory_rate: faker.number.int({ min: 14, max: 18 }),
    oxygen_saturation: faker.number.int({ min: 96, max: 100 }),
    pain_level: faker.number.int({ min: 0, max: 3 }),
    recorded_at: new Date().toISOString(),
    is_critical: false,
    ...overrides,
  }
}

function generateMockWard(overrides = {}) {
  return {
    id: mockUUID(),
    name: `${faker.word.adjective()} Ward`,
    ward_type: 'general',
    is_active: true,
    total_beds: 20,
    available_beds_count: 8,
    ...overrides,
  }
}

function generateMockNursingTask(overrides = {}) {
  return {
    id: mockUUID(),
    task_type: 'medication',
    priority: 'medium',
    status: 'pending',
    description: faker.lorem.sentence(),
    due_time: faker.date.future().toISOString(),
    ...overrides,
  }
}

// =============================================================================
// Authentication Handlers
// =============================================================================

export const authHandlers = [
  // Login
  http.post(`${API_BASE}/auth/login/`, async ({ request }) => {
    const body = await request.json()

    // Simulate validation
    if (!body.email || !body.password) {
      return HttpResponse.json(
        { detail: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Simulate invalid credentials
    if (body.password === 'wrongpassword') {
      return HttpResponse.json(
        { detail: 'Invalid credentials' },
        { status: 401 }
      )
    }

    return HttpResponse.json({
      access: 'mock-access-token',
      refresh: 'mock-refresh-token',
      user: generateMockUser({ email: body.email }),
    })
  }),

  // Logout
  http.post(`${API_BASE}/auth/logout/`, () => {
    return HttpResponse.json({ detail: 'Successfully logged out' })
  }),

  // Token refresh
  http.post(`${API_BASE}/auth/token/refresh/`, () => {
    return HttpResponse.json({
      access: 'new-mock-access-token',
    })
  }),

  // Current user
  http.get(`${API_BASE}/auth/me/`, () => {
    return HttpResponse.json(generateMockUser())
  }),

  // Password reset request
  http.post(`${API_BASE}/auth/password-reset/`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({
      detail: `Password reset email sent to ${body.email}`,
    })
  }),

  // Password reset confirm
  http.post(`${API_BASE}/auth/password-reset/confirm/`, () => {
    return HttpResponse.json({
      detail: 'Password has been reset successfully',
    })
  }),
]

// =============================================================================
// Patient Handlers
// =============================================================================

const mockPatients = Array.from({ length: 10 }, () => generateMockPatient())

export const patientHandlers = [
  // List patients (from users app endpoint)
  http.get(`${API_BASE}/users/patients/`, ({ request }) => {
    const url = new URL(request.url)
    const search = url.searchParams.get('search')
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = parseInt(url.searchParams.get('page_size') || '10', 10)

    let filtered = mockPatients
    if (search) {
      const searchLower = search.toLowerCase()
      filtered = mockPatients.filter(
        (p) =>
          p.user.first_name.toLowerCase().includes(searchLower) ||
          p.user.last_name.toLowerCase().includes(searchLower) ||
          p.medical_record_number.toLowerCase().includes(searchLower)
      )
    }

    const start = (page - 1) * pageSize
    const results = filtered.slice(start, start + pageSize)

    return HttpResponse.json(paginatedResponse(results, filtered.length))
  }),

  // List patients (legacy endpoint)
  http.get(`${API_BASE}/patients/`, ({ request }) => {
    const url = new URL(request.url)
    const search = url.searchParams.get('search')
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = parseInt(url.searchParams.get('page_size') || '10', 10)

    let filtered = mockPatients
    if (search) {
      const searchLower = search.toLowerCase()
      filtered = mockPatients.filter(
        (p) =>
          p.user.first_name.toLowerCase().includes(searchLower) ||
          p.user.last_name.toLowerCase().includes(searchLower) ||
          p.medical_record_number.toLowerCase().includes(searchLower)
      )
    }

    const start = (page - 1) * pageSize
    const results = filtered.slice(start, start + pageSize)

    return HttpResponse.json(paginatedResponse(results, filtered.length))
  }),

  // Get patient detail (new endpoint)
  http.get(`${API_BASE}/patients/:id/get_patient/`, ({ params }) => {
    const patient = mockPatients.find((p) => p.id === params.id)
    if (!patient) {
      return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json(patient)
  }),

  // Get patient detail (legacy endpoint)
  http.get(`${API_BASE}/patients/:id/`, ({ params }) => {
    const patient = mockPatients.find((p) => p.id === params.id)
    if (!patient) {
      return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json(patient)
  }),

  // Create patient
  http.post(`${API_BASE}/patients/`, async ({ request }) => {
    const body = await request.json()
    const newPatient = generateMockPatient({
      user: {
        ...generateMockUser({ user_type: 'patient' }),
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
      },
      medical_record_number: `MRN${faker.string.numeric(6)}`,
    })
    return HttpResponse.json(newPatient, { status: 201 })
  }),

  // Update patient (PUT)
  http.put(`${API_BASE}/patients/:id/`, async ({ params, request }) => {
    const body = await request.json()
    const patient = mockPatients.find((p) => p.id === params.id)
    if (!patient) {
      return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json({ ...patient, ...body })
  }),

  // Update patient (PATCH)
  http.patch(`${API_BASE}/patients/:id/`, async ({ params, request }) => {
    const body = await request.json()
    const patient = mockPatients.find((p) => p.id === params.id)
    if (!patient) {
      return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json({ ...patient, ...body })
  }),

  // Delete patient
  http.delete(`${API_BASE}/patients/:id/delete_patient/`, ({ params }) => {
    const patientIndex = mockPatients.findIndex((p) => p.id === params.id)
    if (patientIndex === -1) {
      return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json({ detail: 'Patient deleted successfully' })
  }),

  // Search patients
  http.get(`${API_BASE}/patients/search/`, ({ request }) => {
    const url = new URL(request.url)
    const query = url.searchParams.get('query') || url.searchParams.get('q') || ''
    const queryLower = query.toLowerCase()

    const results = mockPatients.filter(
      (p) =>
        p.user.first_name.toLowerCase().includes(queryLower) ||
        p.user.last_name.toLowerCase().includes(queryLower) ||
        p.medical_record_number.toLowerCase().includes(queryLower)
    )

    return HttpResponse.json(results.slice(0, 10))
  }),

  // Recent patients
  http.get(`${API_BASE}/patients/recent/`, () => {
    return HttpResponse.json(mockPatients.slice(0, 5))
  }),

  // Register patient
  http.post(`${API_BASE}/patients/register/`, async ({ request }) => {
    const body = await request.json()
    const newPatient = generateMockPatient({
      user: {
        ...generateMockUser({ user_type: 'patient' }),
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
      },
      medical_record_number: `MRN${faker.string.numeric(6)}`,
    })
    return HttpResponse.json(newPatient, { status: 201 })
  }),

  // Update patient with FHIR
  http.put(`${API_BASE}/patients/:id/update_patient/`, async ({ params, request }) => {
    const body = await request.json()
    const patient = mockPatients.find((p) => p.id === params.id)
    if (!patient) {
      return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json({ ...patient, ...body })
  }),

  // Patient history
  http.get(`${API_BASE}/patients/:id/history/`, ({ params }) => {
    const patient = mockPatients.find((p) => p.id === params.id)
    if (!patient) {
      return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    }
    return HttpResponse.json([
      { type: 'encounter', date: faker.date.past().toISOString(), description: 'General checkup' },
      { type: 'lab_result', date: faker.date.past().toISOString(), description: 'Blood test' },
    ])
  }),

  // Validation rules
  http.get(`${API_BASE}/patients/validation-rules/`, () => {
    return HttpResponse.json({
      required_fields: ['first_name', 'last_name', 'date_of_birth'],
      optional_fields: ['blood_group', 'allergies'],
    })
  }),
]

// =============================================================================
// Nursing Handlers
// =============================================================================

export const nursingHandlers = [
  // List vital signs
  http.get(`${API_BASE}/nursing/vital-signs/`, ({ request }) => {
    const url = new URL(request.url)
    const patientId = url.searchParams.get('patient')

    const vitals = Array.from({ length: 5 }, () =>
      generateMockVitalSigns({ patient: patientId || mockUUID() })
    )

    return HttpResponse.json(paginatedResponse(vitals))
  }),

  // Create vital signs
  http.post(`${API_BASE}/nursing/vital-signs/`, async ({ request }) => {
    const body = await request.json()
    const newVitals = generateMockVitalSigns(body)

    // Check for critical values
    if (
      body.temperature > 39 ||
      body.temperature < 36 ||
      body.heart_rate > 120 ||
      body.heart_rate < 50 ||
      body.oxygen_saturation < 92
    ) {
      newVitals.is_critical = true
    }

    return HttpResponse.json(newVitals, { status: 201 })
  }),

  // List nursing tasks
  http.get(`${API_BASE}/nursing/tasks/`, ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')

    let tasks = Array.from({ length: 8 }, () => generateMockNursingTask())
    if (status) {
      tasks = tasks.filter((t) => t.status === status)
    }

    return HttpResponse.json(paginatedResponse(tasks))
  }),

  // Update nursing task
  http.patch(`${API_BASE}/nursing/tasks/:id/`, async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json({
      id: params.id,
      ...generateMockNursingTask(),
      ...body,
    })
  }),

  // Complete nursing task
  http.post(`${API_BASE}/nursing/tasks/:id/complete/`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      ...generateMockNursingTask({ status: 'completed' }),
      completed_at: new Date().toISOString(),
    })
  }),

  // List nursing alerts
  http.get(`${API_BASE}/nursing/alerts/`, () => {
    const alerts = Array.from({ length: 3 }, () => ({
      id: mockUUID(),
      patient: mockUUID(),
      alert_type: faker.helpers.arrayElement(['vital_signs', 'medication_due', 'task_overdue']),
      severity: faker.helpers.arrayElement(['low', 'medium', 'high']),
      message: faker.lorem.sentence(),
      is_acknowledged: false,
      created_at: faker.date.recent().toISOString(),
    }))

    return HttpResponse.json(paginatedResponse(alerts))
  }),

  // Acknowledge alert
  http.post(`${API_BASE}/nursing/alerts/:id/acknowledge/`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      is_acknowledged: true,
      acknowledged_at: new Date().toISOString(),
    })
  }),

  // MAR entries
  http.get(`${API_BASE}/nursing/mar/`, ({ request }) => {
    const url = new URL(request.url)
    const patientId = url.searchParams.get('patient')

    const entries = Array.from({ length: 6 }, () => ({
      id: mockUUID(),
      patient: patientId || mockUUID(),
      medication_name: faker.helpers.arrayElement(['Amoxicillin', 'Metformin', 'Lisinopril']),
      dosage: faker.helpers.arrayElement(['500mg', '250mg', '10mg']),
      scheduled_time: faker.date.recent().toISOString(),
      status: faker.helpers.arrayElement(['scheduled', 'administered', 'missed']),
    }))

    return HttpResponse.json(paginatedResponse(entries))
  }),

  // Administer medication
  http.post(`${API_BASE}/nursing/mar/:id/administer/`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      status: 'administered',
      administered_at: new Date().toISOString(),
    })
  }),
]

// =============================================================================
// Ward Handlers
// =============================================================================

const mockWards = Array.from({ length: 5 }, () => generateMockWard())

export const wardHandlers = [
  // Root endpoint for wards API
  http.get(`${API_BASE}/wards/`, () => {
    return HttpResponse.json({
      id: 'wards',
      wards: `${API_BASE}/wards/wards/`,
      beds: `${API_BASE}/wards/beds/`,
      admissions: `${API_BASE}/wards/admissions/`,
    })
  }),

  // List wards (nested under /wards/wards/)
  http.get(`${API_BASE}/wards/wards/`, ({ request }) => {
    const url = new URL(request.url)
    const isActive = url.searchParams.get('is_active')
    const wardType = url.searchParams.get('ward_type')

    let filtered = mockWards
    if (isActive !== null) {
      filtered = filtered.filter(w => w.is_active === (isActive === 'true'))
    }
    if (wardType) {
      filtered = filtered.filter(w => w.ward_type === wardType)
    }

    return HttpResponse.json(paginatedResponse(filtered))
  }),

  // Get ward detail
  http.get(`${API_BASE}/wards/wards/:id/`, ({ params }) => {
    const ward = mockWards.find(w => w.id === params.id)
    if (ward) {
      return HttpResponse.json(ward)
    }
    return HttpResponse.json(generateMockWard({ id: params.id }))
  }),

  // Create ward
  http.post(`${API_BASE}/wards/wards/`, async ({ request }) => {
    const body = await request.json()
    const newWard = generateMockWard({
      name: body.name,
      ward_type: body.ward_type,
      total_beds: 0,
      available_beds_count: 0,
    })
    return HttpResponse.json(newWard, { status: 201 })
  }),

  // Update ward (PUT)
  http.put(`${API_BASE}/wards/wards/:id/`, async ({ params, request }) => {
    const body = await request.json()
    const ward = mockWards.find(w => w.id === params.id) || generateMockWard({ id: params.id })
    return HttpResponse.json({ ...ward, ...body })
  }),

  // Update ward (PATCH)
  http.patch(`${API_BASE}/wards/wards/:id/`, async ({ params, request }) => {
    const body = await request.json()
    const ward = mockWards.find(w => w.id === params.id) || generateMockWard({ id: params.id })
    return HttpResponse.json({ ...ward, ...body })
  }),

  // Delete ward
  http.delete(`${API_BASE}/wards/wards/:id/`, () => {
    return HttpResponse.json({ detail: 'Deleted successfully' })
  }),

  // Get beds for a specific ward (nested)
  http.get(`${API_BASE}/wards/wards/:wardId/beds/`, ({ params }) => {
    const beds = Array.from({ length: 10 }, (_, i) => ({
      id: mockUUID(),
      ward: params.wardId,
      bed_number: `B-${i + 1}`,
      bed_type: 'standard',
      status: faker.helpers.arrayElement(['available', 'occupied', 'reserved']),
    }))

    return HttpResponse.json(paginatedResponse(beds))
  }),

  // List all beds
  http.get(`${API_BASE}/wards/beds/`, ({ request }) => {
    const url = new URL(request.url)
    const wardId = url.searchParams.get('ward')

    const beds = Array.from({ length: 10 }, (_, i) => ({
      id: mockUUID(),
      ward: wardId || mockUUID(),
      bed_number: `B-${i + 1}`,
      bed_type: 'standard',
      status: faker.helpers.arrayElement(['available', 'occupied', 'reserved']),
    }))

    return HttpResponse.json(paginatedResponse(beds))
  }),

  // Admissions list
  http.get(`${API_BASE}/wards/admissions/`, ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')

    const admissions = Array.from({ length: 5 }, () => ({
      id: mockUUID(),
      patient: mockUUID(),
      ward: mockUUID(),
      bed: mockUUID(),
      admission_type: faker.helpers.arrayElement(['emergency', 'elective', 'transfer']),
      status: status || faker.helpers.arrayElement(['active', 'discharged', 'transferred']),
      admission_date: faker.date.past().toISOString(),
    }))

    return HttpResponse.json(paginatedResponse(admissions))
  }),
]

// =============================================================================
// Appointment Handlers
// =============================================================================

export const appointmentHandlers = [
  // List appointments
  http.get(`${API_BASE}/appointments/`, ({ request }) => {
    const url = new URL(request.url)
    const date = url.searchParams.get('date')

    const appointments = Array.from({ length: 8 }, () => ({
      id: mockUUID(),
      patient: generateMockPatient(),
      practitioner: generateMockUser({ user_type: 'doctor' }),
      appointment_type: 'consultation',
      status: faker.helpers.arrayElement(['scheduled', 'confirmed', 'completed']),
      start_time: faker.date.future().toISOString(),
      end_time: faker.date.future().toISOString(),
      reason: faker.lorem.sentence(),
    }))

    return HttpResponse.json(paginatedResponse(appointments))
  }),

  // Create appointment
  http.post(`${API_BASE}/appointments/`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(
      {
        id: mockUUID(),
        ...body,
        status: 'scheduled',
      },
      { status: 201 }
    )
  }),

  // Cancel appointment
  http.post(`${API_BASE}/appointments/:id/cancel/`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      status: 'cancelled',
    })
  }),
]

// =============================================================================
// Dashboard Handlers
// =============================================================================

export const dashboardHandlers = [
  // Nurse dashboard
  http.get(`${API_BASE}/dashboards/nurse/`, () => {
    return HttpResponse.json({
      shift_patients: Array.from({ length: 5 }, () => generateMockPatient()),
      overdue_medications: faker.number.int({ min: 0, max: 5 }),
      critical_alerts: faker.number.int({ min: 0, max: 3 }),
      pending_tasks: faker.number.int({ min: 0, max: 10 }),
    })
  }),

  // Doctor dashboard
  http.get(`${API_BASE}/dashboards/doctor/`, () => {
    return HttpResponse.json({
      todays_appointments: faker.number.int({ min: 0, max: 15 }),
      pending_results: faker.number.int({ min: 0, max: 8 }),
      active_patients: faker.number.int({ min: 0, max: 20 }),
    })
  }),
]

// =============================================================================
// Workflow Handlers
// =============================================================================

export const workflowHandlers = [
  // Start workflow
  http.post(`${API_BASE}/workflows/:type/start/`, async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json(
      {
        id: mockUUID(),
        workflow_type: params.type,
        status: 'in_progress',
        current_step: 1,
        context_data: body,
        created_at: new Date().toISOString(),
      },
      { status: 201 }
    )
  }),

  // Get workflow state
  http.get(`${API_BASE}/workflows/:type/:id/`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      workflow_type: params.type,
      status: 'in_progress',
      current_step: 1,
      steps_completed: [],
      context_data: {},
    })
  }),

  // Update workflow step
  http.patch(`${API_BASE}/workflows/:type/:id/step/`, async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json({
      id: params.id,
      workflow_type: params.type,
      status: 'in_progress',
      current_step: body.step || 2,
      context_data: body.data || {},
    })
  }),

  // Complete workflow
  http.post(`${API_BASE}/workflows/:type/:id/complete/`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      workflow_type: params.type,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
  }),
]

// =============================================================================
// Omni Search Handlers
// =============================================================================

export const omniSearchHandlers = [
  http.get(`${API_BASE}/search/omni/`, ({ request }) => {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim()
    const types = (url.searchParams.get('types') || '').trim()
    const limit = parseInt(url.searchParams.get('limit') || '8', 10)

    const groups = {
      recent_patients: [
        {
          id: 'recent-patient-1',
          medical_record_number: 'MRN000001',
          name: 'John Doe',
          date_of_birth: '1980-01-01',
          gender: 'M',
          created_at: new Date().toISOString(),
          current_ward: null,
          admission_status: null,
          admission_date: null,
          last_accessed_at: new Date().toISOString(),
        },
      ],
      patients: [],
      wards: [],
      encounters: [],
      appointments: [],
      admissions: [],
      staff: [],
    }

    if (q.length < 2) {
      return HttpResponse.json({
        query: q,
        types: [],
        limit: Number.isFinite(limit) ? limit : 8,
        groups,
      })
    }

    const requestedTypes = types ? types.split(',').map((t) => t.trim()).filter(Boolean) : []
    const effectiveTypes = requestedTypes.length > 0 ? requestedTypes : ['patients', 'wards', 'encounters', 'appointments', 'admissions', 'staff']

    if (effectiveTypes.includes('patients')) {
      groups.patients = [
        {
          id: 'patient-1',
          medical_record_number: 'MRN000123',
          name: q.toLowerCase().includes('jo') ? 'John Doe' : 'Jane Smith',
          date_of_birth: '1990-01-01',
          gender: 'F',
          created_at: new Date().toISOString(),
          current_ward: null,
          admission_status: null,
          admission_date: null,
        },
      ]
    }

    if (effectiveTypes.includes('staff')) {
      groups.staff = [
        {
          id: 'staff-1',
          user_id: 'user-1',
          name: 'Alice Alpha',
          email: 'alice@example.com',
          user_type: 'doctor',
          employee_id: 'EMP00001',
          practitioner_id: 'pract-1',
        },
      ]
    }

    return HttpResponse.json({
      query: q,
      types: effectiveTypes,
      limit: Number.isFinite(limit) ? limit : 8,
      groups,
    })
  }),
]

// =============================================================================
// Combined Handlers Export
// =============================================================================

export const handlers = [
  ...authHandlers,
  ...patientHandlers,
  ...omniSearchHandlers,
  ...nursingHandlers,
  ...wardHandlers,
  ...appointmentHandlers,
  ...dashboardHandlers,
  ...workflowHandlers,
]
