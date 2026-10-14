import { expect, test } from '@playwright/test';
import { paceIdentityLogin } from './login-pacing.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'owner@hms.local';
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const smokePatientName = process.env.E2E_SMOKE_PATIENT_NAME || 'Smoke Patient';
const expectRustV2RouteGuard = process.env.E2E_EXPECT_RUST_V2_ROUTE_GUARD === 'true';

if (!adminPassword) {
  throw new Error('E2E_ADMIN_PASSWORD is required; no default admin password is provided.');
}

async function signInAsAdmin(page) {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

  await page.getByLabel('Email Address').fill(adminEmail);
  await page.locator('#password').fill(adminPassword);
  await paceIdentityLogin(adminEmail);
  const loginResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v2/auth/login'
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Sign In' }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok()).toBe(true);
  const loginPayload = await loginResponse.json();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  return loginPayload.data.access_token;
}

test('admin can sign in, search the patient directory, and open an owned clinical record', async ({ page }) => {
  const token = await signInAsAdmin(page);
  const names = smokePatientName.trim().split(/\s+/);
  const identity = {
    first_name: names[0],
    last_name: names.slice(1).join(' ') || 'Patient',
    date_of_birth: '1990-01-15',
    sex: 'female',
  };
  const headers = { Authorization: `Bearer ${token}`, 'X-Facility-Code': 'HMS' };
  let response = await page.request.post('/api/v2/patients', { headers, data: identity });
  const payload = await response.json();
  if (response.status() === 409 && payload?.error?.code === 'patient_duplicate_review_required') {
    response = await page.request.post('/api/v2/patients', {
      headers,
      data: {
        ...identity,
        duplicate_review: {
          lookup_id: payload.error.details.lookup_id,
          decision: 'new_distinct_patient',
          reason_code: 'different_person_confirmed',
          reason_note: 'Synthetic browser smoke fixture; intentionally distinct test identity.',
        },
      },
    });
  }
  expect(response.ok()).toBe(true);
  const createdPatient = (await response.json()).data;
  expect(createdPatient?.patient_code).toBeTruthy();
  const encounterResponse = await page.request.post('/api/v2/encounters', {
    headers,
    data: { patient_id: createdPatient.id, encounter_type: 'outpatient' },
  });
  expect(encounterResponse.ok()).toBe(true);

  await page.goto('/patients');
  await expect(page.getByRole('heading', { name: 'Patient Directory' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search by name, MRN, or NHIS ID' }).fill(smokePatientName);

  const patientRow = page.getByRole('row').filter({ hasText: createdPatient.patient_code });
  await expect(patientRow).toBeVisible();
  await patientRow.click();

  await expect(page).toHaveURL(new RegExp(`/patients/${createdPatient.id}/chronicle$`));
  await expect(page.getByRole('heading', { name: smokePatientName })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
});

test('Rust V2 mode redirects unsupported standalone workflow routes', async ({ page }) => {
  test.skip(!expectRustV2RouteGuard, 'Rust V2 route guard smoke is opt-in.');

  await signInAsAdmin(page);

  await page.goto('/workflows/ward-round');

  await page.waitForURL(/\/feature-unavailable$/);
  await expect(page.getByRole('heading', { name: 'Feature Unavailable' })).toBeVisible();
  await expect(page.getByText('This module is not enabled for the current deployment.')).toBeVisible();
});
