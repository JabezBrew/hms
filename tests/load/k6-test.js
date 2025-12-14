/**
 * K6 Load Testing for HMS
 *
 * Alternative load testing using k6 for CI/CD integration.
 * Provides detailed metrics and thresholds for automated testing.
 *
 * Features:
 *   - Automatic token refresh: Each VU refreshes JWT tokens every 10 minutes
 *     (before the 15-minute expiry) to support long-running tests
 *   - Simulates nurse, doctor, and admin workflows
 *   - Tracks custom metrics for dashboards, vitals, and search operations
 *
 * Installation:
 *   brew install k6  (macOS)
 *   choco install k6  (Windows)
 *   apt install k6    (Linux)
 *
 * Usage:
 *   # Basic run (uses built-in stages, ramps up to 2000 VUs over 32 minutes)
 *   k6 run tests/load/k6-test.js
 *
 *   # Quick test with fixed VUs (overrides stages)
 *   k6 run --vus 25 --duration 5m --no-vu-connection-reuse=false tests/load/k6-test.js
 *
 *   # With environment variables
 *   k6 run -e BASE_URL=http://localhost:8000 tests/load/k6-test.js
 *
 *   # With load test key (bypasses rate limiting - key must match LOAD_TEST_SECRET_KEY in backend)
 *   k6 run -e BASE_URL=https://your-api.com -e LOAD_TEST_KEY=your-secret-key tests/load/k6-test.js
 *
 *   # Cloud run (k6 Cloud)
 *   k6 cloud tests/load/k6-test.js
 *
 *   # Output to JSON
 *   k6 run --out json=results.json tests/load/k6-test.js
 *
 * Target metrics:
 *   - P95 latency < 500ms for read operations
 *   - P95 latency < 200ms for write operations
 *   - Error rate < 1%
 *   - 10,000 concurrent users supported
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const LOAD_TEST_KEY = __ENV.LOAD_TEST_KEY || ''; // Secret key to bypass rate limiting
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // Refresh tokens every 10 minutes (before 15 min expiry)

// Per-VU token state (each VU maintains its own tokens)
let vuTokens = {
  nurse: { access: null, refresh: null, lastRefresh: 0 },
  doctor: { access: null, refresh: null, lastRefresh: 0 },
  admin: { access: null, refresh: null, lastRefresh: 0 },
  lab: { access: null, refresh: null, lastRefresh: 0 },
  reception: { access: null, refresh: null, lastRefresh: 0 },
  clerk: { access: null, refresh: null, lastRefresh: 0 },
};

// Custom metrics
const alertDeliveryTime = new Trend('alert_delivery_time', true);
const vitalsRecordTime = new Trend('vitals_record_time', true);
const dashboardLoadTime = new Trend('dashboard_load_time', true);
const searchTime = new Trend('search_time', true);
const prescriptionTime = new Trend('prescription_create_time', true);
const labOrderTime = new Trend('lab_order_process_time', true);
const appointmentBookingTime = new Trend('appointment_booking_time', true);
const admissionTime = new Trend('admission_time', true);
const errorRate = new Rate('errors');
const tokenRefreshes = new Counter('token_refreshes');

// Test configuration with stages
export const options = {
  // Ramping pattern for load test
  stages: [
    { duration: '1m', target: 50 },     // Ramp up to 50 users
    { duration: '3m', target: 200 },    // Ramp up to 200 users
    { duration: '5m', target: 500 },    // Ramp up to 500 users
    { duration: '5m', target: 500 },    // Hold at 500 users
    { duration: '2m', target: 0 },      // Ramp down
  ],

  // Thresholds for pass/fail
  thresholds: {
    // Overall HTTP metrics
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],  // <1% error rate

    // Custom metrics
    dashboard_load_time: ['p(95)<500'],
    vitals_record_time: ['p(95)<200'],
    search_time: ['p(95)<1000'],
    prescription_create_time: ['p(95)<800'],
    lab_order_process_time: ['p(95)<1500'],
    appointment_booking_time: ['p(95)<800'],
    admission_time: ['p(95)<1000'],
    errors: ['rate<0.01'],
  },

  // Tags for result filtering
  tags: {
    environment: __ENV.ENVIRONMENT || 'test',
    test_type: 'load',
  },
};

// Test data
const searchTerms = ['john', 'smith', 'mary', 'williams', 'jones', 'brown'];
const medications = [
  { name: 'Amoxicillin', dose: '500mg', route: 'oral', freq: 'tid' },
  { name: 'Lisinopril', dose: '10mg', route: 'oral', freq: 'daily' },
  { name: 'Metformin', dose: '500mg', route: 'oral', freq: 'bid' }
];

// Generate random vital signs
function randomVitals() {
  return {
    temperature: (Math.random() * 2.5 + 36.0).toFixed(1),
    heart_rate: randomIntBetween(60, 100),
    blood_pressure_systolic: randomIntBetween(100, 140),
    blood_pressure_diastolic: randomIntBetween(60, 90),
    respiratory_rate: randomIntBetween(12, 20),
    oxygen_saturation: randomIntBetween(95, 100),
    pain_level: randomIntBetween(0, 5),
  };
}

// Authentication helper with retry - returns access token (and refresh if available)
function login(email, password, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = http.post(
      `${BASE_URL}/api/auth/login/`,
      JSON.stringify({ email, password }),
      { headers: {
        'Content-Type': 'application/json',
        ...(LOAD_TEST_KEY && { 'X-Load-Test-Key': LOAD_TEST_KEY }),
      } }
    );

    if (res.status === 200) {
      try {
        const body = JSON.parse(res.body);
        if (body.access) {
          // Return access token; refresh is optional (API may not return it)
          return { access: body.access, refresh: body.refresh || null };
        }
      } catch (e) {
        console.error(`Login parse error for ${email}: ${e}`);
      }
    } else if (res.status === 429) {
      // Rate limited - wait and retry
      console.warn(`Rate limited on login attempt ${attempt} for ${email}, waiting...`);
      sleep(2);
    } else {
      const bodyPreview = res.body ? res.body.substring(0, 200) : '(no body)';
      console.error(`Login failed for ${email}: status=${res.status}, body=${bodyPreview}`);
    }

    if (attempt < retries) {
      sleep(1);
    }
  }
  console.error(`All login attempts failed for ${email}`);
  return null;
}

// Refresh token helper
function refreshToken(refresh) {
  const res = http.post(
    `${BASE_URL}/api/auth/token/refresh/`,
    JSON.stringify({ refresh }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      if (body.access) {
        return { access: body.access, refresh: body.refresh || refresh };
      }
    } catch (e) {
      console.error(`Token refresh parse error: ${e}`);
    }
  }
  return null;
}

// Get valid token for a user type, re-authenticating if needed
function getValidToken(userType, credentials) {
  const now = Date.now();
  const tokenState = vuTokens[userType];

  // Check if we need to re-authenticate (token older than 10 minutes or not initialized)
  if (!tokenState.access || (now - tokenState.lastRefresh) > TOKEN_REFRESH_INTERVAL_MS) {
    // Try to refresh using existing refresh token (if available)
    if (tokenState.refresh) {
      const refreshed = refreshToken(tokenState.refresh);
      if (refreshed) {
        tokenRefreshes.add(1, { type: userType, method: 'refresh' });
        vuTokens[userType] = {
          access: refreshed.access,
          refresh: refreshed.refresh || tokenState.refresh,
          lastRefresh: now,
        };
        return refreshed.access;
      }
    }

    // No refresh token or refresh failed - do fresh login
    const cred = credentials[userType] || credentials.admin; // Fallback to admin
    if (cred) {
      const tokens = login(cred.email, cred.password);
      if (tokens) {
        tokenRefreshes.add(1, { type: userType, method: 'login' });
        vuTokens[userType] = {
          access: tokens.access,
          refresh: tokens.refresh,
          lastRefresh: now,
        };
        return tokens.access;
      }
    }
    return null;
  }

  return tokenState.access;
}

// Setup function - runs once (shared across all VUs)
export function setup() {
  console.log('Setting up test - logging in test user...');

  // Use admin account for all workflows (has access to all endpoints)
  // In production, test users were created via registration API with auto-generated passwords
  const credentials = {
    nurse: { email: 'nurse@hms.com', password: 'Admin123!' },
    doctor: { email: 'doctor@hms.com', password: 'Admin123!' },
    admin: { email: 'admin@hms.com', password: 'Admin123!' },
    lab: { email: 'lab_tech@hms.com', password: 'Admin123!' },
    reception: { email: 'receptionist@hms.com', password: 'Admin123!' },
    clerk: { email: 'admin@hms.com', password: 'Admin123!' }, // Clerk uses admin for now as per seed
  };

  // Get initial token (same for all user types)
  const adminTokens = login(credentials.admin.email, credentials.admin.password);

  // Validate token
  if (!adminTokens) {
    console.error('SETUP ERROR: Admin token is null - cannot proceed');
  } else {
    console.log('Setup complete: Admin token obtained for all workflows');
  }

  return {
    credentials,
    initialTokens: {
      nurse: adminTokens,
      doctor: adminTokens,
      admin: adminTokens,
      lab: adminTokens,
      reception: adminTokens,
      clerk: adminTokens,
    },
  };
}

// Track failed requests for debugging
const failedRequests = new Counter('failed_requests_by_endpoint');

// Helper to log failed requests
function checkResponse(res, endpoint) {
  if (res.status >= 400) {
    failedRequests.add(1, { endpoint: endpoint });
    if (res.status !== 401) { // Don't spam auth errors
      console.error(`${endpoint} failed: status=${res.status}`);
    }
  }
  return res.status < 400;
}

// Initialize VU tokens from setup data (called once per VU on first iteration)
function initializeVuTokens(data) {
  if (vuTokens.nurse.access === null && data.initialTokens.nurse) {
    vuTokens.nurse = { ...data.initialTokens.nurse, lastRefresh: Date.now() };
  }
  if (vuTokens.doctor.access === null && data.initialTokens.doctor) {
    vuTokens.doctor = { ...data.initialTokens.doctor, lastRefresh: Date.now() };
  }
  if (vuTokens.admin.access === null && data.initialTokens.admin) {
    vuTokens.admin = { ...data.initialTokens.admin, lastRefresh: Date.now() };
  }
  if (vuTokens.lab.access === null && data.initialTokens.lab) {
    vuTokens.lab = { ...data.initialTokens.lab, lastRefresh: Date.now() };
  }
  if (vuTokens.reception.access === null && data.initialTokens.reception) {
    vuTokens.reception = { ...data.initialTokens.reception, lastRefresh: Date.now() };
  }
  if (vuTokens.clerk.access === null && data.initialTokens.clerk) {
    vuTokens.clerk = { ...data.initialTokens.clerk, lastRefresh: Date.now() };
  }
}

// Main test function
export default function (data) {
  // Initialize VU tokens from setup data on first iteration
  initializeVuTokens(data);

  // Simulate different user behaviors based on VU ID
  const vuType = __VU % 20;

  if (vuType < 8) { // 0-7 (40%)
    // Nurse workflow
    const token = getValidToken('nurse', data.credentials);
    if (!token) return sleep(1);
    const headers = getHeaders(token);
    nurseWorkflow(headers);
  } else if (vuType < 14) { // 8-13 (30%)
    // Doctor workflow
    const token = getValidToken('doctor', data.credentials);
    if (!token) return sleep(1);
    const headers = getHeaders(token);
    doctorWorkflow(headers);
  } else if (vuType < 17) { // 14-16 (15%)
    // Lab workflow
    const token = getValidToken('lab', data.credentials);
    if (!token) return sleep(1);
    const headers = getHeaders(token);
    labWorkflow(headers);
  } else if (vuType < 18) { // 17 (5%)
    // Receptionist workflow
    const token = getValidToken('reception', data.credentials);
    if (!token) return sleep(1);
    const headers = getHeaders(token);
    receptionistWorkflow(headers);
  } else if (vuType < 19) { // 18 (5%)
    // Admissions Clerk workflow
    const token = getValidToken('clerk', data.credentials);
    if (!token) return sleep(1);
    const headers = getHeaders(token);
    admissionWorkflow(headers);
  } else { // 19 (5%)
    // Admin workflow
    const token = getValidToken('admin', data.credentials);
    if (!token) return sleep(1);
    const headers = getHeaders(token);
    adminWorkflow(headers);
  }
}

function getHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(LOAD_TEST_KEY && { 'X-Load-Test-Key': LOAD_TEST_KEY }),
  };
}

// Nurse workflow simulation
function nurseWorkflow(headers) {
  group('Nurse: Dashboard', function () {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/nursing/monitoring/dashboard/`, { headers });

    dashboardLoadTime.add(Date.now() - start);
    errorRate.add(res.status !== 200);

    check(res, {
      'dashboard loaded': (r) => r.status === 200,
      'dashboard response time OK': (r) => r.timings.duration < 500,
    });

    // Extract patient IDs for subsequent requests
    let patientIds = [];
    if (res.status === 200) {
      try {
        const body = JSON.parse(res.body);
        const patients = body.results || body.patients || [];
        patientIds = patients.slice(0, 10).map((p) => p.patient_id || p.id);
      } catch (e) {
        console.error('Failed to parse dashboard response');
      }
    }

    sleep(randomIntBetween(1, 3));

    // View patient vitals
    if (patientIds.length > 0) {
      const patientId = randomItem(patientIds);
      const vitalsRes = http.get(
        `${BASE_URL}/api/nursing/vital-signs/?patient=${patientId}`,
        { headers }
      );
      check(vitalsRes, { 'vitals loaded': (r) => r.status === 200 });
    }

    sleep(randomIntBetween(1, 2));

    // Record vitals (20% of the time)
    if (Math.random() < 0.2 && patientIds.length > 0) {
      const patientId = randomItem(patientIds);
      const vitals = randomVitals();
      vitals.patient = patientId;

      const start = Date.now();
      const recordRes = http.post(
        `${BASE_URL}/api/nursing/vital-signs/`,
        JSON.stringify(vitals),
        { headers }
      );
      vitalsRecordTime.add(Date.now() - start);
      errorRate.add(recordRes.status !== 201);

      check(recordRes, {
        'vitals recorded': (r) => r.status === 201,
        'vitals record time OK': (r) => r.timings.duration < 200,
      });
    }

    sleep(randomIntBetween(2, 5));
  });

  group('Nurse: Alerts', function () {
    const res = http.get(
      `${BASE_URL}/api/nursing/alerts/?is_acknowledged=false`,
      { headers }
    );
    check(res, { 'alerts loaded': (r) => r.status === 200 });
    sleep(randomIntBetween(1, 3));
  });
}

// Doctor workflow simulation
function doctorWorkflow(headers) {
  let patientIds = [];

  group('Doctor: Patient Search', function () {
    const term = randomItem(searchTerms);
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/patients/search/?query=${term}`,
      { headers }
    );
    searchTime.add(Date.now() - start);
    errorRate.add(res.status !== 200);

    check(res, {
      'search completed': (r) => r.status === 200,
      'search time OK': (r) => r.timings.duration < 1000,
    });

    if (res.status === 200) {
      try {
        const body = JSON.parse(res.body);
        const results = body.results || body.patients || [];
        patientIds = results.map(p => p.id || (p.local_data && p.local_data.id));
      } catch (e) {
        console.error('Failed to parse search response');
      }
    }
    sleep(randomIntBetween(2, 5));
  });

  // Prescribe Medication (30% chance if patients found)
  if (Math.random() < 0.3 && patientIds.length > 0) {
    const patientId = randomItem(patientIds);
    const med = randomItem(medications);

    group('Doctor: Prescribe', function() {
      // 1. Search for drug
      const searchTerm = med.name.substring(0, 4);
      const searchStart = Date.now();
      const searchRes = http.get(
        `${BASE_URL}/api/drug-safety/safety/search_drugs/?q=${searchTerm}`,
        { headers }
      );
      searchTime.add(Date.now() - searchStart);
      check(searchRes, { 'drug search OK': (r) => r.status === 200 });

      if (searchRes.status === 200) {
        // 2. Create Prescription
        const payload = {
          patient: patientId,
          medication_name: med.name,
          dosage: med.dose,
          route: med.route,
          frequency: med.freq,
          start_date: new Date().toISOString().split('T')[0],
          duration_days: 7,
          instructions: "Take as directed",
          reason: "Load test prescription"
        };

        const start = Date.now();
        const res = http.post(
          `${BASE_URL}/api/clinical-notes/prescriptions/`,
          JSON.stringify(payload),
          { headers }
        );
        
        prescriptionTime.add(Date.now() - start);
        
        // 201 Created or 400 (Safety Alert) are acceptable
        check(res, {
          'prescription processed': (r) => r.status === 201 || (r.status === 400 && r.body.includes('safety')),
        });
      }
      sleep(randomIntBetween(2, 4));
    });
  }

  // Order Labs (30% chance if patients found)
  if (Math.random() < 0.3 && patientIds.length > 0) {
    group('Doctor: Order Labs', function() {
      // First get tests
      const testsRes = http.get(`${BASE_URL}/api/laboratory/tests/?is_active=true`, { headers });
      if (testsRes.status === 200) {
        const tests = JSON.parse(testsRes.body).results || [];
        if (tests.length > 0) {
          const patientId = randomItem(patientIds);
          const testId = randomItem(tests).id;
          
          const payload = {
            patient: patientId,
            test_ids: [testId],
            priority: 'routine',
            clinical_notes: 'Routine check',
            fasting_required: false
          };
          
          const orderRes = http.post(
            `${BASE_URL}/api/laboratory/orders/`,
            JSON.stringify(payload),
            { headers }
          );
          
          if (orderRes.status === 201) {
             const orderId = JSON.parse(orderRes.body).id;
             // Submit order
             http.post(
               `${BASE_URL}/api/laboratory/orders/${orderId}/submit/`, 
               {}, 
               { headers }
             );
          }
        }
      }
    });
  }
}

// Lab workflow simulation
function labWorkflow(headers) {
  group('Lab: Process Orders', function() {
    // 1. Find pending orders
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/laboratory/orders/?status=ordered&pending_only=true`, 
      { headers }
    );
    
    if (res.status === 200) {
      const orders = JSON.parse(res.body).results || [];
      if (orders.length > 0) {
        const order = randomItem(orders);
        const orderId = order.id;
        
        // 2. Collect Specimen
        const specRes = http.post(
          `${BASE_URL}/api/laboratory/specimens/`,
          JSON.stringify({
             order: orderId,
             specimen_type: "blood",
             container_type: "tube", 
             volume_collected: "5ml",
             collection_site: "arm",
             collected_at: new Date().toISOString()
          }),
          { headers }
        );
        
        if (specRes.status === 201) {
           const specId = JSON.parse(specRes.body).id;
           
           // Mark collected
           http.post(`${BASE_URL}/api/laboratory/orders/${orderId}/collect/`, {}, { headers });
           
           // Receive
           http.post(`${BASE_URL}/api/laboratory/specimens/${specId}/receive/`, {}, { headers });
           http.post(`${BASE_URL}/api/laboratory/orders/${orderId}/receive/`, {}, { headers });
           
           // Start processing
           http.post(`${BASE_URL}/api/laboratory/orders/${orderId}/start_processing/`, {}, { headers });
           
           // Result & Complete
           const detailRes = http.get(`${BASE_URL}/api/laboratory/orders/${orderId}/?expand=tests`, { headers });
           if (detailRes.status === 200) {
             const details = JSON.parse(detailRes.body);
             const test = details.order_tests ? details.order_tests[0] : null;
             
             if (test) {
               const resultRes = http.post(
                 `${BASE_URL}/api/laboratory/results/`,
                 JSON.stringify({
                   order_test: test.id,
                   specimen: specId,
                   value: "100",
                   unit: "mg/dL",
                   performed_at: new Date().toISOString()
                 }),
                 { headers }
               );
               
               if (resultRes.status === 201) {
                  const resultId = JSON.parse(resultRes.body).id;
                  http.post(`${BASE_URL}/api/laboratory/results/${resultId}/verify/`, {}, { headers });
                  http.post(`${BASE_URL}/api/laboratory/orders/${orderId}/complete/`, {}, { headers });
               }
             }
           }
        }
      }
    }
    labOrderTime.add(Date.now() - start);
    sleep(randomIntBetween(1, 3));
  });
}

// Receptionist workflow simulation
function receptionistWorkflow(headers) {
  group('Reception: Book Appointments', function() {
    // 1. Get resources (practitioners, types, patients) - usually cached, but fetching for test
    const practRes = http.get(`${BASE_URL}/api/users/practitioners/`, { headers });
    const typesRes = http.get(`${BASE_URL}/api/appointments/types/`, { headers });
    const patRes = http.get(`${BASE_URL}/api/patients/search/?query=`, { headers });
    
    if (practRes.status === 200 && typesRes.status === 200 && patRes.status === 200) {
      const practitioners = JSON.parse(practRes.body).results || [];
      const types = JSON.parse(typesRes.body).results || [];
      const patients = JSON.parse(patRes.body).results || [];
      
      if (practitioners.length && types.length && patients.length) {
        const practId = randomItem(practitioners).id;
        const typeId = randomItem(types).id;
        const patientId = randomItem(patients).id;
        
        // 2. Search Available Slots
        const startDate = new Date().toISOString().split('T')[0];
        const endDate = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0]; // +3 days
        
        const slotsRes = http.get(
          `${BASE_URL}/api/appointments/appointments/available_slots/?practitioner_id=${practId}&start_date=${startDate}&end_date=${endDate}&appointment_type_id=${typeId}`,
          { headers }
        );
        
        if (slotsRes.status === 200) {
          const slots = JSON.parse(slotsRes.body).slots || [];
          if (slots.length > 0) {
            const slot = randomItem(slots);
            
            // 3. Book Appointment
            const start = Date.now();
            const bookRes = http.post(
              `${BASE_URL}/api/appointments/appointments/`,
              JSON.stringify({
                patient_id: patientId,
                practitioner_id: practId,
                appointment_type_id: typeId,
                start_time: slot.start,
                end_time: slot.end,
                description: "Load test booking",
                comment: "Automated booking"
              }),
              { headers }
            );
            appointmentBookingTime.add(Date.now() - start);
            check(bookRes, { 'appointment booked': (r) => r.status === 201 });
          }
        }
      }
    }
    sleep(randomIntBetween(2, 5));
  });
}

// Admissions Clerk workflow
function admissionWorkflow(headers) {
  group('ADT: Admit Patient', function() {
    // 1. Get wards
    const wardsRes = http.get(`${BASE_URL}/api/wards/wards/`, { headers });
    if (wardsRes.status === 200) {
      const wards = JSON.parse(wardsRes.body).results || [];
      if (wards.length) {
        const wardId = randomItem(wards).id;
        
        // 2. Find Bed
        const bedsRes = http.get(
          `${BASE_URL}/api/wards/beds/?ward=${wardId}&status=available`,
          { headers }
        );
        
        if (bedsRes.status === 200) {
          const beds = JSON.parse(bedsRes.body).results || [];
          if (beds.length) {
            // Need a patient and doctor
            const patRes = http.get(`${BASE_URL}/api/patients/search/?query=`, { headers });
            const docRes = http.get(`${BASE_URL}/api/users/practitioners/`, { headers });
            
            if (patRes.status === 200 && docRes.status === 200) {
              const patients = JSON.parse(patRes.body).results || [];
              const doctors = JSON.parse(docRes.body).results || [];
              
              if (patients.length && doctors.length) {
                const bedId = randomItem(beds).id;
                
                // 3. Admit
                const start = Date.now();
                const admitRes = http.post(
                  `${BASE_URL}/api/wards/admissions/`,
                  JSON.stringify({
                    patient: randomItem(patients).id,
                    bed: bedId,
                    admission_date: new Date().toISOString(),
                    admission_type: "emergency",
                    admitting_doctor: randomItem(doctors).id,
                    admission_notes: "Load test admission"
                  }),
                  { headers }
                );
                
                admissionTime.add(Date.now() - start);
                // 201 or 400 (Occupied) are valid for load test race conditions
                check(admitRes, { 
                  'admission processed': (r) => r.status === 201 || (r.status === 400 && r.body.includes('occupied')) 
                });
              }
            }
          }
        }
      }
    }
    sleep(randomIntBetween(5, 10));
  });
}

// Admin workflow simulation
function adminWorkflow(headers) {
  group('Admin: Ward Analytics', function () {
    const res = http.get(`${BASE_URL}/api/wards/wards/analytics/`, { headers });
    check(res, {
      'analytics loaded': (r) => r.status === 200,
      'analytics time OK': (r) => r.timings.duration < 2000,
    });
    sleep(randomIntBetween(5, 10));
  });

  group('Admin: Ward List', function () {
    const res = http.get(`${BASE_URL}/api/wards/wards/`, { headers });
    check(res, { 'wards loaded': (r) => r.status === 200 });
    sleep(randomIntBetween(3, 5));
  });
}

// Teardown function
export function teardown(data) {
  console.log('Load test completed');
}

// Handle summary
export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
  };
}

// Text summary helper
function textSummary(data, options) {
  const { metrics, root_group } = data;

  let summary = '\n=== HMS Load Test Summary ===\n\n';

  // Key metrics
  summary += 'Key Metrics:\n';
  summary += `  Total Requests: ${metrics.http_reqs?.values?.count || 0}\n`;
  summary += `  Failed Requests: ${metrics.http_req_failed?.values?.passes || 0}\n`;
  summary += `  Avg Response Time: ${(metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms\n`;
  summary += `  P95 Response Time: ${(metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms\n`;
  summary += `  P99 Response Time: ${(metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms\n`;

  // Custom metrics
  summary += '\nCustom Metrics:\n';
  summary += `  Dashboard Load P95: ${(metrics.dashboard_load_time?.values?.['p(95)'] || 0).toFixed(2)}ms\n`;
  summary += `  Vitals Record P95: ${(metrics.vitals_record_time?.values?.['p(95)'] || 0).toFixed(2)}ms\n`;
  summary += `  Search P95: ${(metrics.search_time?.values?.['p(95)'] || 0).toFixed(2)}ms\n`;
  summary += `  Rx Create P95: ${(metrics.prescription_create_time?.values?.['p(95)'] || 0).toFixed(2)}ms\n`;
  summary += `  Lab Order Process P95: ${(metrics.lab_order_process_time?.values?.['p(95)'] || 0).toFixed(2)}ms\n`;
  summary += `  Appt Booking P95: ${(metrics.appointment_booking_time?.values?.['p(95)'] || 0).toFixed(2)}ms\n`;
  summary += `  Admission P95: ${(metrics.admission_time?.values?.['p(95)'] || 0).toFixed(2)}ms\n`;
  summary += `  Token Refreshes: ${metrics.token_refreshes?.values?.count || 0}\n`;

  return summary;
}
