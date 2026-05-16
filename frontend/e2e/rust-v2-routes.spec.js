import { expect, test } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'owner@hms.local';
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const patientDetailRoutePattern = /\/patients\/[0-9a-f-]{36}(?:\/chronicle)?$/;
const appointmentDetailRoutePattern = /\/appointments\/[0-9a-f-]{36}$/;

const rustV2Routes = [
  '/',
  '/patients',
  '/appointments',
  '/wards',
  '/ward-board',
  '/admissions/requests',
  '/billing',
  '/billing/invoices',
  '/billing/payments',
  '/billing/catalog',
  '/nursing/dashboard',
  '/nursing/tasks',
  '/nursing/ward-stock-requests',
  '/laboratory/dashboard',
  '/laboratory/orders',
  '/laboratory/results',
  '/inventory',
  '/inventory/items',
  '/inventory/locations',
  '/inventory/requisitions',
  '/inventory/purchase-orders',
  '/inventory/grns',
  '/inventory/internal-requisitions',
  '/inventory/transfers',
  '/inventory/controlled',
  '/pharmacy/dispensing',
  '/triage',
  '/encounters',
  '/staff',
  '/admin/audit-logs',
  '/settings',
  '/settings/security',
  '/referrals/inbox',
];

if (!adminPassword) {
  throw new Error('E2E_ADMIN_PASSWORD is required; no default admin password is provided.');
}

async function signInAsAdmin(page) {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

  await page.getByLabel('Email Address').fill(adminEmail);
  await page.locator('#password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

async function selectOutpatientDepartment(page) {
  await page.getByRole('combobox').filter({ hasText: /Select department/i }).click();
  await expect(page.getByRole('option', { name: 'Outpatient Department' })).toBeVisible();
  await page.getByRole('option', { name: 'Outpatient Department' }).click();
}

async function fillMinimumPatientIdentity(page, email) {
  await page.getByPlaceholder('First name').fill('Playwright');
  await page.getByPlaceholder('Last name').fill('Smoke');
  await page.getByText('Pick a date').click();
  await expect(page.locator('[role=grid] button').filter({ hasText: /^15$/ })).toBeVisible();
  await page.locator('[role=grid] button').filter({ hasText: /^15$/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox').filter({ hasText: /Select sex/i }).click();
  await page.getByRole('option', { name: 'Female' }).click();
  await page.getByPlaceholder('Email address').fill(email);
}

async function submitMinimumPatientRegistration(page) {
  await page.goto('/patients/create');
  await selectOutpatientDepartment(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await fillMinimumPatientIdentity(page, `playwright.${Date.now()}@example.test`);

  const createPatientResponse = page.waitForResponse((response) => (
    response.url().includes('/api/v2/patients') &&
    response.request().method() === 'POST'
  ));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (patientDetailRoutePattern.test(new URL(page.url()).pathname)) {
      break;
    }
    const registerButton = page.getByRole('button', { name: 'Register Patient' });
    if (await registerButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await registerButton.click({ force: true });
      break;
    }
    const nextButton = page.getByRole('button', { name: 'Next' });
    if (!(await nextButton.isVisible({ timeout: 500 }).catch(() => false))) {
      break;
    }
    await nextButton.click();
  }

  const response = await createPatientResponse;
  expect(response.status()).toBeLessThan(300);
  await expect(page).toHaveURL(patientDetailRoutePattern);
}

async function createSmokePatient(page) {
  await submitMinimumPatientRegistration(page);
  return new URL(page.url()).pathname.match(/\/patients\/([0-9a-f-]{36})/)?.[1];
}

async function createSmokeAppointment(page) {
  const patientId = await createSmokePatient(page);
  expect(patientId).toBeTruthy();

  await page.goto(`/appointments/create?patientId=${patientId}`);
  await expect(page.getByRole('heading', { name: 'Schedule Appointment' })).toBeVisible();

  await page.getByRole('combobox').filter({ hasText: /Select clinic/i }).click();
  await page.getByRole('option', { name: /General Clinic/i }).click();

  await page.getByRole('combobox').filter({ hasText: /Select type/i }).click();
  await page.getByRole('option', { name: /General/i }).click();

  await expect(page.getByText(/No slots for this date/i)).toHaveCount(0);
  await page.getByRole('button', { name: /\d{1,2}:\d{2} [AP]M - \d{1,2}:\d{2} [AP]M/ }).first().click();

  const createAppointmentResponse = page.waitForResponse((response) => (
    response.url().includes('/api/v2/appointments') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Schedule Appointment' }).click();

  const response = await createAppointmentResponse;
  expect(response.status()).toBeLessThan(300);
  await expect(page).toHaveURL(appointmentDetailRoutePattern);

  return new URL(page.url()).pathname.match(/\/appointments\/([0-9a-f-]{36})/)?.[1];
}

test('Rust V2 static work surfaces load without route crashes or server errors', async ({ page }) => {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/api/v2/')) {
      return;
    }
    if (response.status() >= 500) {
      failures.push(`${response.status()} ${url}`);
    }
  });

  await signInAsAdmin(page);

  for (const route of rustV2Routes) {
    await page.goto(route);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  }

  expect(failures).toEqual([]);
});

test('Rust V2 patient registration exposes seeded departments without requiring roster clinic schedules', async ({ page }) => {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v2/') && response.status() >= 500) {
      failures.push(`${response.status()} ${url}`);
    }
  });

  await signInAsAdmin(page);
  await page.goto('/patients/create');

  await expect(page.getByRole('heading', { name: /Register New Patient/i })).toBeVisible();
  await selectOutpatientDepartment(page);
  await expect(page.getByText(/Registration will continue under the selected department/i)).toBeVisible();

  expect(failures).toEqual([]);
});

test('Rust V2 patient registration submits the existing multi-step form', async ({ page }) => {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v2/') && response.status() >= 500) {
      failures.push(`${response.status()} ${url}`);
    }
  });

  await signInAsAdmin(page);
  await submitMinimumPatientRegistration(page);
  await expect(page.getByRole('heading', { name: 'Playwright Smoke' })).toBeVisible();

  expect(failures).toEqual([]);
});

test('Rust V2 patient edit preloads and updates demographics from the existing form', async ({ page }) => {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v2/') && response.status() >= 500) {
      failures.push(`${response.status()} ${url}`);
    }
  });

  await signInAsAdmin(page);
  await submitMinimumPatientRegistration(page);
  await page.getByRole('link', { name: /Edit Demographics/i }).click();

  await expect(page.getByPlaceholder('First name')).toHaveValue('Playwright');
  await expect(page.getByPlaceholder('Last name')).toHaveValue('Smoke');
  await page.getByPlaceholder('Last name').fill('Updated');

  const updatePatientResponse = page.waitForResponse((response) => (
    /\/api\/v2\/patients\/[0-9a-f-]+$/.test(new URL(response.url()).pathname) &&
    response.request().method() === 'PATCH'
  ));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (patientDetailRoutePattern.test(new URL(page.url()).pathname)) {
      break;
    }
    const updateButton = page.getByRole('button', { name: 'Update Patient' });
    if (await updateButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await updateButton.click({ force: true });
      break;
    }
    const nextButton = page.getByRole('button', { name: 'Next' });
    if (!(await nextButton.isVisible({ timeout: 500 }).catch(() => false))) {
      break;
    }
    await nextButton.click();
  }

  const response = await updatePatientResponse;
  expect(response.status()).toBeLessThan(300);
  await expect(page).toHaveURL(patientDetailRoutePattern);
  await expect(page.getByRole('heading', { name: 'Playwright Updated' })).toBeVisible();

  expect(failures).toEqual([]);
});

test('Rust V2 appointment create schedules through the existing appointment UI', async ({ page }) => {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v2/') && response.status() >= 500) {
      failures.push(`${response.status()} ${url}`);
    }
  });

  await signInAsAdmin(page);
  const appointmentId = await createSmokeAppointment(page);
  expect(appointmentId).toBeTruthy();

  expect(failures).toEqual([]);
});

test('Rust V2 appointment detail checks in through the existing appointment UI', async ({ page }) => {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v2/') && response.status() >= 500) {
      failures.push(`${response.status()} ${url}`);
    }
  });

  await signInAsAdmin(page);
  const appointmentId = await createSmokeAppointment(page);
  expect(appointmentId).toBeTruthy();

  await expect(page.getByRole('button', { name: 'Check In' })).toBeVisible();

  const checkInResponse = page.waitForResponse((response) => (
    response.url().includes('/api/v2/visits/check-in') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Check In' }).click();

  const response = await checkInResponse;
  expect(response.status()).toBeLessThan(300);
  await expect(page.getByText(/^Arrived$/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel Appointment' })).toHaveCount(0);

  expect(failures).toEqual([]);
});

test('Rust V2 appointment detail cancels scheduled appointments through the existing appointment UI', async ({ page }) => {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v2/') && response.status() >= 500) {
      failures.push(`${response.status()} ${url}`);
    }
  });

  await signInAsAdmin(page);
  const appointmentId = await createSmokeAppointment(page);
  expect(appointmentId).toBeTruthy();

  await expect(page.getByRole('button', { name: 'Cancel Appointment' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel Appointment' }).click();

  const cancelResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/v2/appointments/${appointmentId}/cancel`) &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Confirm Cancellation' }).click();

  const response = await cancelResponse;
  expect(response.status()).toBeLessThan(300);
  await expect(page.getByText(/^Cancelled$/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check In' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel Appointment' })).toHaveCount(0);

  expect(failures).toEqual([]);
});

test('Rust V2 appointment edit reschedules through the existing appointment UI', async ({ page }) => {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v2/') && response.status() >= 500) {
      failures.push(`${response.status()} ${url}`);
    }
  });

  await signInAsAdmin(page);
  const appointmentId = await createSmokeAppointment(page);
  expect(appointmentId).toBeTruthy();

  await page.getByRole('button', { name: /^Edit$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments/${appointmentId}/edit$`));
  await expect(page.getByRole('heading', { name: 'Edit Appointment' })).toBeVisible();

  await page.getByRole('button', { name: /\d{1,2}:\d{2} [AP]M - \d{1,2}:\d{2} [AP]M/ }).last().click();

  const updateResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/v2/appointments/${appointmentId}`) &&
    response.request().method() === 'PATCH'
  ));

  await page.getByRole('button', { name: 'Save Changes' }).click();

  const response = await updateResponse;
  expect(response.status()).toBeLessThan(300);
  await expect(page).toHaveURL(new RegExp(`/appointments/${appointmentId}$`));
  await expect(page.getByText(/^Booked$/i).first()).toBeVisible();

  expect(failures).toEqual([]);
});

test('Rust V2 practitioner availability opens as a read-only scheduling surface', async ({ page }) => {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v2/') && response.status() >= 500) {
      failures.push(`${response.status()} ${url}`);
    }
  });

  await signInAsAdmin(page);
  await page.goto('/practitioner-availability');

  await expect(page.getByRole('heading', { name: 'Practitioner Availability' })).toBeVisible();
  await expect(page.getByText(/calendar availability remains read-only/i)).toBeVisible();
  await expect(page.getByText(/Rust V2/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /new rule/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /block time/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /create rule/i })).toHaveCount(0);

  expect(failures).toEqual([]);
});
