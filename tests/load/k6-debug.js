/**
 * K6 Debug Test - Identify failing endpoints
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  vus: 5,
  duration: '30s',
};

function login(email, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login/`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (res.status === 200) {
    return JSON.parse(res.body).access;
  }
  console.error(`Login failed for ${email}: ${res.status}`);
  return null;
}

export function setup() {
  const nurseToken = login('nurse@hms.local', 'testpass123');
  const doctorToken = login('doctor@hms.local', 'testpass123');
  const adminToken = login('admin@example.com', 'AdminPassword123');

  console.log(`Nurse token: ${nurseToken ? 'OK' : 'FAILED'}`);
  console.log(`Doctor token: ${doctorToken ? 'OK' : 'FAILED'}`);
  console.log(`Admin token: ${adminToken ? 'OK' : 'FAILED'}`);

  return { nurseToken, doctorToken, adminToken };
}

export default function(data) {
  const endpoints = [
    { name: 'Dashboard', url: '/api/nursing/monitoring/dashboard/', token: data.nurseToken },
    { name: 'Alerts', url: '/api/nursing/alerts/?is_acknowledged=false', token: data.nurseToken },
    { name: 'Vitals List', url: '/api/nursing/vital-signs/', token: data.nurseToken },
    { name: 'Medications', url: '/api/nursing/medications/', token: data.nurseToken },
    { name: 'Patient Search', url: '/api/patients/search/?query=john', token: data.doctorToken },
    { name: 'Appointments', url: '/api/appointments/', token: data.doctorToken },
    { name: 'Ward List', url: '/api/wards/wards/', token: data.adminToken },
    { name: 'Ward Analytics', url: '/api/wards/wards/analytics/', token: data.adminToken },
  ];

  for (const ep of endpoints) {
    const res = http.get(`${BASE_URL}${ep.url}`, {
      headers: { 'Authorization': `Bearer ${ep.token}` }
    });

    if (res.status !== 200) {
      const body = res.body || '';
      const preview = body.length > 100 ? body.slice(0, 100) + '...' : body;
      console.error(`FAIL [${ep.name}]: ${res.status} - ${preview}`);
    }
    sleep(0.5);
  }
}
