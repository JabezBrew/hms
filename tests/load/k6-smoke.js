/**
 * K6 Smoke Test for HMS
 *
 * Lightweight test for local development validation.
 * Use this to verify endpoints work correctly before running full load tests.
 *
 * Usage:
 *   k6 run tests/load/k6-smoke.js
 *   k6 run -e BASE_URL=http://localhost:8000 tests/load/k6-smoke.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const errorRate = new Rate('errors');

// Smoke test configuration - light load for dev server
export const options = {
  stages: [
    { duration: '30s', target: 5 },   // Ramp to 5 users
    { duration: '1m', target: 10 },   // Hold at 10 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // More lenient for dev server
    http_req_failed: ['rate<0.1'],      // Allow up to 10% failures
    errors: ['rate<0.1'],
  },
};

// Authentication helper
function login(email, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login/`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      return body.access;
    } catch (e) {
      console.error('Failed to parse login response');
      return null;
    }
  }
  console.error(`Login failed: ${res.status} - ${res.body}`);
  return null;
}

// Setup - runs once at start
export function setup() {
  console.log(`Testing against: ${BASE_URL}`);

  const nurseToken = login('nurse@hms.local', 'testpass123');
  const doctorToken = login('doctor@hms.local', 'testpass123');
  const adminToken = login('admin@example.com', 'AdminPassword123');

  if (!nurseToken) {
    console.error('WARNING: Nurse login failed - tests will fail');
  }
  if (!doctorToken) {
    console.error('WARNING: Doctor login failed - tests will fail');
  }
  if (!adminToken) {
    console.error('WARNING: Admin login failed - tests will fail');
  }

  return {
    tokens: {
      nurse: nurseToken,
      doctor: doctorToken,
      admin: adminToken,
    },
  };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.tokens.nurse}`,
  };

  // Rotate through different workflows
  const scenario = __ITER % 4;

  switch (scenario) {
    case 0:
      testNurseDashboard(headers);
      break;
    case 1:
      testPatientSearch({ ...headers, 'Authorization': `Bearer ${data.tokens.doctor}` });
      break;
    case 2:
      testWardList({ ...headers, 'Authorization': `Bearer ${data.tokens.admin}` });
      break;
    case 3:
      testAlerts(headers);
      break;
  }
}

function testNurseDashboard(headers) {
  group('Nurse Dashboard', function () {
    const res = http.get(`${BASE_URL}/api/nursing/monitoring/dashboard/`, { headers });

    const success = check(res, {
      'dashboard status 200': (r) => r.status === 200,
      'dashboard has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.results !== undefined || body.patients !== undefined;
        } catch (e) {
          return false;
        }
      },
    });

    errorRate.add(!success);
    sleep(1);
  });
}

function testPatientSearch(headers) {
  group('Patient Search', function () {
    const terms = ['john', 'smith', 'mary'];
    const term = terms[Math.floor(Math.random() * terms.length)];

    const res = http.get(`${BASE_URL}/api/patients/search/?query=${term}`, { headers });

    const success = check(res, {
      'search status 200': (r) => r.status === 200,
    });

    errorRate.add(!success);
    sleep(1);
  });
}

function testWardList(headers) {
  group('Ward List', function () {
    const res = http.get(`${BASE_URL}/api/wards/wards/`, { headers });

    const success = check(res, {
      'wards status 200': (r) => r.status === 200,
    });

    errorRate.add(!success);
    sleep(1);
  });
}

function testAlerts(headers) {
  group('Nursing Alerts', function () {
    const res = http.get(`${BASE_URL}/api/nursing/alerts/?is_acknowledged=false`, { headers });

    const success = check(res, {
      'alerts status 200': (r) => r.status === 200,
    });

    errorRate.add(!success);
    sleep(1);
  });
}

export function teardown(data) {
  console.log('Smoke test completed');
}
