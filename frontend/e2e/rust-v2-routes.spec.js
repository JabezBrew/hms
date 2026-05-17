import { expect, test } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'owner@hms.local';
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const patientDetailRoutePattern = /\/patients\/[0-9a-f-]{36}(?:\/chronicle)?$/;
const appointmentDetailRoutePattern = /\/appointments\/[0-9a-f-]{36}$/;
const encounterDetailRoutePattern = /\/encounters\/[0-9a-f-]{36}$/;

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
  '/clinical-notes/templates',
  '/nursing/dashboard',
  '/nursing/tasks',
  '/nursing/shift-handoff',
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

async function fillMinimumPatientIdentity(page, email, identity = {}) {
  await page.getByPlaceholder('First name').fill(identity.firstName || 'Playwright');
  await page.getByPlaceholder('Last name').fill(identity.lastName || 'Smoke');
  await page.getByText('Pick a date').click();
  await expect(page.locator('[role=grid] button').filter({ hasText: /^15$/ })).toBeVisible();
  await page.locator('[role=grid] button').filter({ hasText: /^15$/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox').filter({ hasText: /Select sex/i }).click();
  await page.getByRole('option', { name: 'Female' }).click();
  await page.getByPlaceholder('Email address').fill(email);
}

async function submitMinimumPatientRegistration(page, identity = {}) {
  await page.goto('/patients/create');
  await selectOutpatientDepartment(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await fillMinimumPatientIdentity(page, `playwright.${Date.now()}@example.test`, identity);

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

async function createSmokePatient(page, identity = {}) {
  await submitMinimumPatientRegistration(page, identity);
  return new URL(page.url()).pathname.match(/\/patients\/([0-9a-f-]{36})/)?.[1];
}

async function createSmokeAppointment(page, identity = {}) {
  const patientId = await createSmokePatient(page, identity);
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

function uniquePatientName(label) {
  const uniqueSuffix = Date.now()
    .toString()
    .slice(-6)
    .split('')
    .map((digit) => String.fromCharCode(65 + Number(digit)))
    .join('');
  return `Playwright ${label}${uniqueSuffix}`;
}

async function postV2FromBrowser(page, path, body) {
  return page.evaluate(async ({ requestPath, requestBody }) => {
    const readCookie = (name) => {
      return document.cookie
        .split(';')
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(`${name}=`))
        ?.split('=')
        .slice(1)
        .join('=') || '';
    };

    const csrfToken = readCookie('hms_v2_csrf');
    const refreshResponse = await fetch('/api/v2/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: csrfToken ? { 'X-HMS-CSRF': csrfToken } : {},
    });

    if (!refreshResponse.ok) {
      throw new Error(`token refresh failed with ${refreshResponse.status}`);
    }

    const refreshPayload = await refreshResponse.json();
    const accessToken = refreshPayload?.data?.access_token;
    if (!accessToken) {
      throw new Error('token refresh did not return an access token');
    }

    const nextCsrfToken = readCookie('hms_v2_csrf') || csrfToken;
    const response = await fetch(requestPath, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Facility-Code': 'HMS',
        ...(nextCsrfToken ? { 'X-HMS-CSRF': nextCsrfToken } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`POST ${requestPath} failed with ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
  }, { requestPath: path, requestBody: body });
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

test('Rust V2 clinic waiting room calls a checked-in visit through the existing queue UI', async ({ page }) => {
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
  const patientName = uniquePatientName('Waiting');
  const appointmentId = await createSmokeAppointment(page, {
    firstName: 'Playwright',
    lastName: patientName.replace('Playwright ', ''),
  });
  expect(appointmentId).toBeTruthy();

  const checkInResponse = page.waitForResponse((response) => (
    response.url().includes('/api/v2/visits/check-in') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Check In' }).click();

  const visitResponse = await checkInResponse;
  expect(visitResponse.status()).toBeLessThan(300);
  const visitPayload = await visitResponse.json();
  const visitId = visitPayload?.data?.id;
  const clinicId = visitPayload?.data?.clinic_id;
  expect(visitId).toBeTruthy();
  expect(clinicId).toBeTruthy();

  await page.goto(`/clinics/${clinicId}/waiting-room`);
  await expect(page.getByRole('heading', { name: /Waiting Room/i })).toBeVisible();

  const waitingCard = page
    .locator('article')
    .filter({ hasText: patientName })
    .filter({ hasText: 'Call Patient' })
    .first();
  await expect(waitingCard).toBeVisible();

  const callResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/v2/visits/${visitId}/call`) &&
    response.request().method() === 'POST'
  ));

  await waitingCard.getByRole('button', { name: 'Call Patient' }).click();

  const response = await callResponse;
  expect(response.status()).toBeLessThan(300);

  const calledCard = page
    .locator('article')
    .filter({ hasText: patientName })
    .filter({ hasText: 'Start Consultation' })
    .first();
  await expect(page.getByText(/Called/i).first()).toBeVisible();
  await expect(calledCard).toBeVisible();

  expect(failures).toEqual([]);
});

test('Rust V2 triage assesses a checked-in visit through the existing triage UI', async ({ page }) => {
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
  const patientName = uniquePatientName('Triage');
  const appointmentId = await createSmokeAppointment(page, {
    firstName: 'Playwright',
    lastName: patientName.replace('Playwright ', ''),
  });
  expect(appointmentId).toBeTruthy();

  const checkInResponse = page.waitForResponse((response) => (
    response.url().includes('/api/v2/visits/check-in') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Check In' }).click();

  const visitResponse = await checkInResponse;
  expect(visitResponse.status()).toBeLessThan(300);
  const visitPayload = await visitResponse.json();
  const visitId = visitPayload?.data?.id;
  expect(visitId).toBeTruthy();

  const triagePayload = await postV2FromBrowser(page, '/api/v2/triage', {
    visit_id: visitId,
    acuity: 'urgent',
  });
  const triageId = triagePayload?.data?.id;
  expect(triageId).toBeTruthy();

  await page.goto('/triage');
  await expect(page.getByRole('heading', { name: 'Triage Queue' })).toBeVisible();
  const waitingCard = page
    .locator('article')
    .filter({ hasText: patientName })
    .filter({ hasText: 'Triage' })
    .first();
  await expect(waitingCard).toBeVisible();

  await waitingCard.getByRole('button', { name: 'Triage' }).click();
  await expect(page.getByRole('heading', { name: 'Triage Assessment' })).toBeVisible();
  const assessmentDialog = page.getByRole('dialog', { name: 'Triage Assessment' });
  await assessmentDialog.getByText('Emergency').click();
  await page.getByLabel('Triage Notes').fill('Browser smoke assessment notes.');

  const assessmentResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/v2/triage/${triageId}/assessment`) &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Save Assessment' }).click();

  const response = await assessmentResponse;
  expect(response.status()).toBeLessThan(300);
  const triagedCard = page
    .locator('article')
    .filter({ hasText: patientName })
    .filter({ hasText: 'Browser smoke assessment notes.' })
    .first();
  await expect(page.getByText(/Triaged - Pending Assignment/i)).toBeVisible();
  await expect(triagedCard).toBeVisible();
  await expect(triagedCard.getByRole('button', { name: 'Assign to Clinic' })).toBeVisible();

  expect(failures).toEqual([]);
});

test('Rust V2 encounters create, detail, edit, workspace, and cancel through the existing UI', async ({ page }) => {
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
  const patientName = uniquePatientName('Encounter');
  const patientId = await createSmokePatient(page, {
    firstName: 'Playwright',
    lastName: patientName.replace('Playwright ', ''),
  });
  expect(patientId).toBeTruthy();

  await page.goto('/encounters/new');
  await expect(page.getByRole('heading', { name: 'New Encounter' })).toBeVisible();

  await page.getByPlaceholder('Search for a patient...').fill(patientName);
  await expect(page.getByText(patientName)).toBeVisible();
  await page.getByText(patientName).click();

  const createResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/encounters') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Create Encounter' }).click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBeLessThan(300);
  const createPayload = await createResponse.json();
  const encounterId = createPayload?.data?.id;
  expect(encounterId).toBeTruthy();

  await expect(page).toHaveURL(encounterDetailRoutePattern);
  await expect(page.getByRole('heading', { name: 'Outpatient Visit' })).toBeVisible();
  await expect(page.getByRole('link', { name: patientName, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Encounter' }).click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${encounterId}/edit$`));
  await expect(page.getByRole('heading', { name: 'Edit Encounter' })).toBeVisible();

  await page.getByRole('combobox').filter({ hasText: /Outpatient/i }).click();
  await page.getByRole('option', { name: 'Emergency' }).click();

  const updateResponsePromise = page.waitForResponse((response) => (
    response.url().includes(`/api/v2/encounters/${encounterId}`) &&
    response.request().method() === 'PATCH'
  ));

  await page.getByRole('button', { name: 'Update Encounter' }).click();

  const updateResponse = await updateResponsePromise;
  expect(updateResponse.status()).toBeLessThan(300);
  await expect(page).toHaveURL(new RegExp(`/encounters/${encounterId}$`));
  await expect(page.getByRole('heading', { name: 'Emergency Visit' })).toBeVisible();

  await page.goto(`/encounters/${encounterId}/workspace`);
  await expect(page.getByRole('tab', { name: 'Clinical Note' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Review of Systems' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Orders & Plan' })).toBeVisible();

  await page.goto(`/encounters/${encounterId}`);
  await page.getByRole('button', { name: /^Cancel$/ }).click();
  await expect(page.getByRole('heading', { name: 'Cancel Encounter' })).toBeVisible();

  const cancelResponsePromise = page.waitForResponse((response) => (
    response.url().includes(`/api/v2/encounters/${encounterId}/cancel`) &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Cancel Encounter' }).click();

  const cancelResponse = await cancelResponsePromise;
  expect(cancelResponse.status()).toBeLessThan(300);
  await expect(page.getByText(/^Cancelled$/i)).toBeVisible();

  expect(failures).toEqual([]);
});

test('Rust V2 wards list, detail, section setup, and reports use the existing UI', async ({ page }) => {
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
  await page.goto('/wards');
  await expect(page.getByRole('heading', { name: 'Ward Management' })).toBeVisible();
  await expect(page.getByText('Total Beds')).toBeVisible();

  const seededWardRow = page
    .getByRole('row')
    .filter({ hasText: 'Active' })
    .first();
  await expect(seededWardRow).toBeVisible();
  await seededWardRow.click();
  await expect(page).toHaveURL(/\/wards\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('tab', { name: 'Ward Overview' })).toBeVisible();
  await expect(page.getByText('Total Beds')).toBeVisible();

  const wardName = `Playwright Ward ${Date.now()}`;
  await page.goto('/wards/new');
  await expect(page.getByRole('heading', { name: 'Create New Ward' })).toBeVisible();
  await page.getByLabel('Ward Name').fill(wardName);
  await page.getByLabel('Total Beds').fill('1');
  await page.getByLabel(/Base Rate Per Night/i).fill('100');

  const createWardResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/wards') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Create Ward' }).click();

  const createWardResponse = await createWardResponsePromise;
  expect(createWardResponse.status()).toBeLessThan(300);
  const createWardPayload = await createWardResponse.json();
  const wardId = createWardPayload?.data?.id;
  expect(wardId).toBeTruthy();

  await expect(page).toHaveURL(/\/wards$/);
  await page.getByPlaceholder('Search wards...').fill(wardName);
  const createdWardRow = page.getByRole('row').filter({ hasText: wardName }).first();
  await expect(createdWardRow).toBeVisible();
  await createdWardRow.click();
  await expect(page).toHaveURL(new RegExp(`/wards/${wardId}$`));
  await expect(page.getByRole('heading', { name: wardName })).toBeVisible();

  await page.getByRole('tab', { name: 'Manage Sections' }).click();
  await expect(page.getByRole('heading', { name: 'Ward Sections' })).toBeVisible();

  const sectionName = `Recovery Bay ${Date.now()}`;
  await page.getByRole('button', { name: 'Create Section' }).first().click();
  const sectionDialog = page.getByRole('dialog', { name: 'Create Section' });
  await expect(sectionDialog).toBeVisible();
  await sectionDialog.getByLabel(/Section Name/i).fill(sectionName);

  const createSectionResponsePromise = page.waitForResponse((response) => (
    response.url().includes(`/api/v2/wards/${wardId}/sections`) &&
    response.request().method() === 'POST'
  ));

  await sectionDialog.getByRole('button', { name: 'Create Section' }).click();

  const createSectionResponse = await createSectionResponsePromise;
  expect(createSectionResponse.status()).toBeLessThan(300);
  await expect(page.getByText(sectionName)).toBeVisible();

  await page.goto('/wards/reports');
  await expect(page.getByRole('heading', { name: /Ward Occupancy Reports/i })).toBeVisible();
  await expect(page.getByText('Report Filters')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Report' })).toBeVisible();

  expect(failures).toEqual([]);
});

test('Rust V2 Ward board patient scope loads through the existing UI', async ({ page }) => {
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

  const patientName = uniquePatientName('Board');
  const patientId = await createSmokePatient(page, {
    firstName: 'Playwright',
    lastName: patientName.replace('Playwright ', ''),
  });
  expect(patientId).toBeTruthy();

  const wardSuffix = Date.now().toString(36).toUpperCase();
  const wardPayload = await postV2FromBrowser(page, '/api/v2/wards', {
    code: `PWB-${wardSuffix}`,
    name: `Playwright Board Ward ${wardSuffix}`,
  });
  const wardId = wardPayload?.data?.id;
  expect(wardId).toBeTruthy();

  const admissionPayload = await postV2FromBrowser(page, '/api/v2/admissions', {
    patient_id: patientId,
    ward_id: wardId,
    bed_id: null,
  });
  expect(admissionPayload?.data?.admission_id).toBeTruthy();

  const boardResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/wards/board')
      && url.searchParams.get('patient_id') === patientId
      && response.request().method() === 'GET';
  });

  await page.goto(`/ward-board?patient=${patientId}`);

  const boardResponse = await boardResponsePromise;
  expect(boardResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: 'Ward Board' })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();

  expect(failures).toEqual([]);
});

test('Rust V2 admission and discharge queues complete the inpatient movement flow', async ({ page }) => {
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

  const patientName = uniquePatientName('Admission');
  const patientId = await createSmokePatient(page, {
    firstName: 'Playwright',
    lastName: patientName.replace('Playwright ', ''),
  });
  expect(patientId).toBeTruthy();

  const suffix = Date.now().toString(36).toUpperCase();
  const wardPayload = await postV2FromBrowser(page, '/api/v2/wards', {
    code: `PWA-${suffix}`,
    name: `Playwright Admission Ward ${suffix}`,
  });
  const wardId = wardPayload?.data?.id;
  expect(wardId).toBeTruthy();

  const bedPayload = await postV2FromBrowser(page, `/api/v2/wards/${wardId}/beds`, {
    section_id: null,
    bed_code: `A-${suffix}`,
  });
  expect(bedPayload?.data?.id).toBeTruthy();

  const admissionCasePayload = await postV2FromBrowser(page, '/api/v2/admissions/cases', {
    patient_id: patientId,
    ward_id: wardId,
  });
  const admissionCaseId = admissionCasePayload?.data?.id;
  expect(admissionCaseId).toBeTruthy();

  await page.goto('/admissions/requests');
  await expect(page.getByRole('heading', { name: 'Admission Requests' })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();

  await page.goto('/nursing/admissions');
  await expect(page.getByRole('heading', { name: 'Nursing Admission Queue' })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();

  await page.goto(`/admissions/cases/${admissionCaseId}`);
  await expect(page.getByRole('heading', { name: patientName })).toBeVisible();

  const activateResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/admissions/cases/${admissionCaseId}/activate`) &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Activate Admission' }).click();

  const activateResponse = await activateResponsePromise;
  expect(activateResponse.status()).toBeLessThan(300);

  await expect(page.getByRole('button', { name: 'Active Stay' })).toBeVisible();
  await page.getByRole('button', { name: 'Active Stay' }).click();
  await expect(page).toHaveURL(new RegExp(`/admissions/${admissionCaseId}$`));
  await expect(page.getByRole('heading', { name: patientName })).toBeVisible();

  const requestDischargeResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/discharges') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Request Discharge' }).click();

  const requestDischargeResponse = await requestDischargeResponsePromise;
  expect(requestDischargeResponse.status()).toBeLessThan(300);
  const requestDischargePayload = await requestDischargeResponse.json();
  const dischargeId = requestDischargePayload?.data?.id;
  expect(dischargeId).toBeTruthy();

  await expect(page).toHaveURL(new RegExp(`/nursing/discharges\\?case=${dischargeId}$`));
  await expect(page.getByRole('heading', { name: 'Nursing Discharges' })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();

  const completeDischargeResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/discharges/${dischargeId}/complete`) &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Finalize Discharge' }).click();

  const completeDischargeResponse = await completeDischargeResponsePromise;
  expect(completeDischargeResponse.status()).toBeLessThan(300);

  expect(failures).toEqual([]);
});

test('Rust V2 nursing dashboard tasks and handoff use generated nursing contracts', async ({ page }) => {
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

  const patientName = uniquePatientName('Nursing');
  const patientId = await createSmokePatient(page, {
    firstName: 'Playwright',
    lastName: patientName.replace('Playwright ', ''),
  });
  expect(patientId).toBeTruthy();

  const suffix = Date.now().toString(36).toUpperCase();
  const wardPayload = await postV2FromBrowser(page, '/api/v2/wards', {
    code: `PWN-${suffix}`,
    name: `Playwright Nursing Ward ${suffix}`,
  });
  const wardId = wardPayload?.data?.id;
  expect(wardId).toBeTruthy();

  const bedPayload = await postV2FromBrowser(page, `/api/v2/wards/${wardId}/beds`, {
    section_id: null,
    bed_code: `N-${suffix}`,
  });
  expect(bedPayload?.data?.id).toBeTruthy();

  const admissionCasePayload = await postV2FromBrowser(page, '/api/v2/admissions/cases', {
    patient_id: patientId,
    ward_id: wardId,
  });
  const admissionCaseId = admissionCasePayload?.data?.id;
  expect(admissionCaseId).toBeTruthy();

  const activatePayload = await postV2FromBrowser(page, `/api/v2/admissions/cases/${admissionCaseId}/activate`, {});
  expect(activatePayload?.data?.status).toBe('admitted');

  const taskPayload = await postV2FromBrowser(page, '/api/v2/nursing/tasks', {
    admission_case_id: admissionCaseId,
    task_type: 'observation',
    due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    assigned_to_user_id: null,
  });
  const taskId = taskPayload?.data?.id;
  expect(taskId).toBeTruthy();

  await page.goto('/nursing/dashboard');
  await expect(page.getByRole('heading', { name: 'Patient Monitoring Dashboard' })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();

  await page.goto('/nursing/tasks');
  await expect(page.getByRole('heading', { name: 'Nursing Tasks' })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();

  const completeTaskResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/nursing/tasks/${taskId}/complete`) &&
    response.request().method() === 'POST'
  ));

  const taskRow = page.getByRole('row').filter({ hasText: patientName });
  await expect(taskRow).toContainText('Pending');
  await taskRow.locator('.lucide-ellipsis').locator('xpath=ancestor::button[1]').click();
  await page.getByRole('menuitem', { name: 'Complete Task' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Complete Task/ }).click();

  const completeTaskResponse = await completeTaskResponsePromise;
  expect(completeTaskResponse.status()).toBeLessThan(300);

  await page.goto('/nursing/shift-handoff');
  await expect(page.getByRole('heading', { name: 'Shift Handoff' })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();
  await page.getByText(patientName).first().click();

  await expect(page.getByText(/Ward-specific nurse assignments are not available for this deployment yet/i)).toBeVisible();
  await page.getByPlaceholder("Describe the patient's current condition...").fill('Stable for nursing handoff.');

  const nurseSelect = page.getByRole('combobox').filter({ hasText: /Select nurse/i });
  await expect(nurseSelect).toBeEnabled();
  await nurseSelect.click();
  await page.getByRole('option').first().click();

  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByPlaceholder('List pending tasks...').fill('Routine observations next shift.');
  await page.getByRole('button', { name: /Continue/ }).click();

  const handoffResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/nursing/handoffs') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: /Complete Handoff/ }).click();

  const handoffResponse = await handoffResponsePromise;
  expect(handoffResponse.status()).toBeLessThan(300);

  expect(failures).toEqual([]);
});

test('Rust V2 clinical note templates and encounter notes use generated clinical contracts', async ({ page }) => {
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

  const suffix = Date.now().toString(36).toUpperCase();
  const templateTitle = `AAA Playwright SOAP ${suffix}`;

  await page.goto('/clinical-notes/templates');
  await expect(page.getByRole('heading', { name: 'Note Templates' })).toBeVisible();

  await page.getByRole('button', { name: 'Create Template' }).click();
  await expect(page.getByRole('heading', { name: 'New Note Template' })).toBeVisible();
  await page.getByLabel(/Template Title/i).fill(templateTitle);

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'SOAP', exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  const createTemplateResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/clinical/note-templates') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Create Template' }).click();

  const createTemplateResponse = await createTemplateResponsePromise;
  expect(createTemplateResponse.status()).toBeLessThan(300);
  const createTemplatePayload = await createTemplateResponse.json();
  expect(createTemplatePayload?.data?.title).toBe(templateTitle);
  expect(createTemplatePayload?.data?.note_type).toBe('soap');

  await page.goto('/clinical-notes/templates');
  await expect(page.getByRole('heading', { name: 'Note Templates' })).toBeVisible();
  await page.getByPlaceholder('Search templates...').fill(templateTitle);
  await expect(page.getByText(templateTitle).first()).toBeVisible();

  const patientName = uniquePatientName('Notes');
  const patientId = await createSmokePatient(page, {
    firstName: 'Playwright',
    lastName: patientName.replace('Playwright ', ''),
  });
  expect(patientId).toBeTruthy();

  const encounterPayload = await postV2FromBrowser(page, '/api/v2/encounters', {
    patient_id: patientId,
    visit_id: null,
    encounter_type: 'outpatient',
  });
  const encounterId = encounterPayload?.data?.id;
  expect(encounterId).toBeTruthy();

  await page.goto(`/encounters/${encounterId}/clinical-notes`);
  await expect(page.getByRole('heading', { name: 'Clinical Notes' })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();

  await page.getByRole('combobox').filter({ hasText: /Select a template/i }).click();
  await page.getByRole('option', { name: templateTitle }).click();
  await page.getByRole('button', { name: 'Use Template' }).click();

  await expect(page.getByText(templateTitle).first()).toBeVisible();
  await page.getByPlaceholder('Enter subjective').fill('Cough for two days.');
  await page.getByPlaceholder('Enter diagnosis or condition').fill('Upper respiratory tract infection.');
  await page.getByPlaceholder('Enter plan').fill('Hydration and review if symptoms worsen.');

  const createNoteResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/patients/${patientId}/clinical/notes`) &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Submit Note' }).click();

  const createNoteResponse = await createNoteResponsePromise;
  expect(createNoteResponse.status()).toBeLessThan(300);
  const noteRequestBody = createNoteResponse.request().postDataJSON();
  expect(noteRequestBody.note_type).toBe('soap');
  expect(noteRequestBody.title).toBe(templateTitle);
  expect(JSON.parse(noteRequestBody.body)).toEqual(expect.objectContaining({
    Subjective: 'Cough for two days.',
    Assessment: 'Upper respiratory tract infection.',
    Plan: 'Hydration and review if symptoms worsen.',
  }));

  const notePayload = await createNoteResponse.json();
  const noteId = notePayload?.data?.id;
  expect(noteId).toBeTruthy();

  const versionPayload = await postV2FromBrowser(page, `/api/v2/clinical/notes/${noteId}/versions`, {
    body: JSON.stringify({
      Subjective: 'Cough improving.',
      Assessment: 'Improving upper respiratory tract infection.',
      Plan: 'Continue supportive care.',
    }),
  });
  expect(versionPayload?.data?.version).toBe(2);

  expect(failures).toEqual([]);
});
