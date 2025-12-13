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
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // Refresh tokens every 10 minutes (before 15 min expiry)

// Per-VU token state (each VU maintains its own tokens)
let vuTokens = {
  nurse: { access: null, refresh: null, lastRefresh: 0 },
  doctor: { access: null, refresh: null, lastRefresh: 0 },
  admin: { access: null, refresh: null, lastRefresh: 0 },
};

// Custom metrics
const alertDeliveryTime = new Trend('alert_delivery_time', true);
const vitalsRecordTime = new Trend('vitals_record_time', true);
const dashboardLoadTime = new Trend('dashboard_load_time', true);
const searchTime = new Trend('search_time', true);
const errorRate = new Rate('errors');
const tokenRefreshes = new Counter('token_refreshes');

// Test configuration with stages
export const options = {
  // Ramping pattern for load test
  stages: [
    { duration: '1m', target: 100 },    // Ramp up to 100 users
    { duration: '3m', target: 500 },    // Ramp up to 500 users
    { duration: '5m', target: 1000 },   // Ramp up to 1000 users
    { duration: '10m', target: 1000 },  // Hold at 1000 users
    { duration: '5m', target: 2000 },   // Push to 2000 users
    { duration: '5m', target: 2000 },   // Hold at 2000 users
    { duration: '3m', target: 0 },      // Ramp down
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
      { headers: { 'Content-Type': 'application/json' } }
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
    const cred = credentials[userType];
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
  console.log('Setting up test - logging in test users...');

  // Store credentials for token refresh during test
  const credentials = {
    nurse: { email: 'nurse@hms.local', password: 'testpass123' },
    doctor: { email: 'doctor@hms.local', password: 'testpass123' },
    admin: { email: 'admin@example.com', password: 'AdminPassword123' },
  };

  // Get initial tokens
  const nurseTokens = login(credentials.nurse.email, credentials.nurse.password);
  const doctorTokens = login(credentials.doctor.email, credentials.doctor.password);
  const adminTokens = login(credentials.admin.email, credentials.admin.password);

  // Validate tokens
  if (!nurseTokens) console.error('SETUP ERROR: Nurse tokens are null');
  if (!doctorTokens) console.error('SETUP ERROR: Doctor tokens are null');
  if (!adminTokens) console.error('SETUP ERROR: Admin tokens are null');

  const validTokenCount = [nurseTokens, doctorTokens, adminTokens].filter(t => t).length;
  console.log(`Setup complete: ${validTokenCount}/3 token pairs obtained`);

  return {
    credentials,
    initialTokens: {
      nurse: nurseTokens,
      doctor: doctorTokens,
      admin: adminTokens,
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
    vuTokens.nurse = {
      access: data.initialTokens.nurse.access,
      refresh: data.initialTokens.nurse.refresh,
      lastRefresh: Date.now(),
    };
  }
  if (vuTokens.doctor.access === null && data.initialTokens.doctor) {
    vuTokens.doctor = {
      access: data.initialTokens.doctor.access,
      refresh: data.initialTokens.doctor.refresh,
      lastRefresh: Date.now(),
    };
  }
  if (vuTokens.admin.access === null && data.initialTokens.admin) {
    vuTokens.admin = {
      access: data.initialTokens.admin.access,
      refresh: data.initialTokens.admin.refresh,
      lastRefresh: Date.now(),
    };
  }
}

// Main test function
export default function (data) {
  // Initialize VU tokens from setup data on first iteration
  initializeVuTokens(data);

  // Simulate different user behaviors based on VU ID
  const vuType = __VU % 10;

  if (vuType < 5) {
    // 50% - Nurse workflow (requires nurse or admin token)
    const nurseToken = getValidToken('nurse', data.credentials) || getValidToken('admin', data.credentials);
    if (!nurseToken) {
      console.error('No valid nurse/admin token for nurse workflow');
      errorRate.add(1);
      sleep(1);
      return;
    }
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${nurseToken}`,
    };
    nurseWorkflow(headers);
  } else if (vuType < 8) {
    // 30% - Doctor workflow (can use any clinical token)
    const doctorToken = getValidToken('doctor', data.credentials) || getValidToken('nurse', data.credentials) || getValidToken('admin', data.credentials);
    if (!doctorToken) {
      console.error('No valid token for doctor workflow');
      errorRate.add(1);
      sleep(1);
      return;
    }
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${doctorToken}`,
    };
    doctorWorkflow(headers);
  } else {
    // 20% - Admin/Ward workflow
    const adminToken = getValidToken('admin', data.credentials) || getValidToken('nurse', data.credentials);
    if (!adminToken) {
      console.error('No valid admin token for admin workflow');
      errorRate.add(1);
      sleep(1);
      return;
    }
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    };
    adminWorkflow(headers);
  }
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
  group('Doctor: Appointments', function () {
    const today = new Date().toISOString().split('T')[0];
    const res = http.get(
      `${BASE_URL}/api/appointments/?date=${today}`,
      { headers }
    );
    check(res, { 'appointments loaded': (r) => r.status === 200 });
    sleep(randomIntBetween(2, 4));
  });

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

    // View patient detail if results found
    // Response format: { results: [...] } (lightweight serializer)
    if (res.status === 200) {
      try {
        const body = JSON.parse(res.body);
        // Handle new format (results) or legacy format (patients)
        const results = body.results || body.patients || [];
        if (results.length > 0) {
          sleep(randomIntBetween(1, 2));
          // New format returns id directly, legacy had local_data.id
          const patientId = results[0].id || (results[0].local_data && results[0].local_data.id);
          if (patientId) {
            // Note: PatientViewSet uses /get_patient/ action, not standard DRF retrieve
            const detailRes = http.get(
              `${BASE_URL}/api/patients/${patientId}/get_patient/`,
              { headers }
            );
            check(detailRes, { 'patient detail loaded': (r) => r.status === 200 });
          }
        }
      } catch (e) {
        console.error('Failed to parse search response');
      }
    }

    sleep(randomIntBetween(3, 6));
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
  summary += `  Token Refreshes: ${metrics.token_refreshes?.values?.count || 0}\n`;

  // Threshold results
  summary += '\nThreshold Results:\n';
  for (const [name, threshold] of Object.entries(data.thresholds || {})) {
    const passed = threshold.ok ? '✓' : '✗';
    summary += `  ${passed} ${name}\n`;
  }

  return summary;
}
