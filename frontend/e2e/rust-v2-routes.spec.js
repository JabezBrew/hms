import { expect, test } from '@playwright/test';
import { paceIdentityLogin } from './login-pacing.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'owner@hms.local';
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const adminPasskeyEnrolled = process.env.E2E_ADMIN_PASSKEY_ENROLLED === 'true';
const staffSetupDeliveryEnabled = process.env.E2E_STAFF_SETUP_DELIVERY_ENABLED === 'true';
const patientDetailRoutePattern = /\/patients\/[0-9a-f-]{36}(?:\/(?:profile|chronicle))?$/;
const appointmentDetailRoutePattern = /\/appointments\/[0-9a-f-]{36}$/;
const encounterDetailRoutePattern = /\/encounters\/[0-9a-f-]{36}$/;
// Use the browser's real login token in test memory. Test setup must not rotate
// the app's refresh cookie independently of its in-memory authentication state.
const accessTokens = new WeakMap();

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
  '/care-areas/outpatient',
  '/care-areas/inpatient',
  '/care-areas/emergency',
  '/ward-board?view=my-work',
  '/laboratory/catalog',
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
  '/staff/create',
  '/admin/organization',
  '/admin/audit-logs',
  '/settings',
  '/settings/profile',
  '/settings/security',
  '/settings/preferences',
  '/inbox',
  '/dashboards/admin',
  '/dashboards/reception',
  '/dashboard/provider',
  '/dashboard/doctor',
  '/dashboards/inpatient',
  '/referrals/inbox',
  '/referrals/sent',
];

if (!adminPassword) {
  throw new Error('E2E_ADMIN_PASSWORD is required; no default admin password is provided.');
}

async function signInAsAdmin(page) {
  page.on('response', async (response) => {
    const path = new URL(response.url()).pathname;
    if (response.ok() && response.request().method() === 'POST'
        && ['/api/v2/auth/login', '/api/v2/auth/refresh'].includes(path)) {
      const payload = await response.json().catch(() => null);
      if (payload?.data?.access_token) accessTokens.set(page, payload.data.access_token);
    }
  });
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
  expect(loginPayload?.data?.access_token).toBeTruthy();
  accessTokens.set(page, loginPayload.data.access_token);

  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

async function fillMinimumPatientIdentity(page, identity = {}) {
  await page.getByLabel('First name', { exact: true }).fill(identity.firstName || 'Playwright');
  await page.getByLabel('Last name', { exact: true }).fill(identity.lastName || 'Smoke');
  await page.getByLabel('Date of birth', { exact: true }).fill('1990-01-15');
  await page.getByRole('combobox', { name: 'Sex', exact: true }).click();
  await page.getByRole('option', { name: 'Female' }).click();
}

async function submitMinimumPatientRegistration(page, identity = {}) {
  await page.goto('/patients/find-or-register');
  await fillMinimumPatientIdentity(page, identity);
  const lookupResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v2/patients/identity/lookup'
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Check for Existing Patient' }).click();
  const lookupResponse = await lookupResponsePromise;
  expect(lookupResponse.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'New Patient Registration' })).toBeVisible();
  await expectMobileViewportFits(page);
  if (await page.getByRole('combobox', { name: 'Reason', exact: true }).isVisible()) {
    await page.getByRole('combobox', { name: 'Reason', exact: true }).click();
    await page.getByRole('option', { name: 'Different person confirmed', exact: true }).click();
    await page.getByLabel('Note', { exact: true }).fill('Synthetic end-to-end fixture; intentionally distinct test identity.');
  }

  const createPatientResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v2/patients' &&
    response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: /^(Continue New Registration|Register New Distinct Patient)$/ }).click();

  const response = await createPatientResponse;
  expect(response.status()).toBeLessThan(300);
  await expect(page).toHaveURL(patientDetailRoutePattern);
}

async function createSmokePatient(page, identity = {}) {
  await submitMinimumPatientRegistration(page, identity);
  return new URL(page.url()).pathname.match(/\/patients\/([0-9a-f-]{36})/)?.[1];
}

async function startClinicalFixture(page, patientId) {
  const encounter = await postV2FromBrowser(page, '/api/v2/encounters', {
    patient_id: patientId,
    encounter_type: 'outpatient',
  });
  expect(encounter?.data?.id).toBeTruthy();
  return encounter.data;
}

async function createSmokeAppointment(page, identity = {}) {
  const patientId = await createSmokePatient(page, identity);
  expect(patientId).toBeTruthy();

  const clinics = v2DataList(await getV2FromBrowser(page, '/api/v2/clinics?limit=100'));
  const clinic = clinics.find((item) => /general clinic/i.test(item.name));
  expect(clinic?.id).toBeTruthy();
  const sessionDate = new Date();
  sessionDate.setUTCDate(sessionDate.getUTCDate() + 1);
  const sessionDay = sessionDate.toISOString().slice(0, 10);
  await postV2FromBrowser(page, '/api/v2/scheduling/sessions', {
    clinic_id: clinic.id,
    owner_type: 'clinic',
    owner_id: clinic.id,
    name: `Synthetic browser availability ${Date.now()}`,
    mode: 'fixed_slot',
    starts_at: `${sessionDay}T09:00:00Z`,
    ends_at: `${sessionDay}T11:00:00Z`,
    slot_minutes: 15,
    capacity: 10,
    allow_overbooking: false,
    overbook_limit: 0,
  });

  await page.goto(`/appointments/create?patientId=${patientId}`);
  await expect(page.getByRole('heading', { name: 'Schedule Appointment' })).toBeVisible();

  await page.getByRole('combobox').filter({ hasText: /Select clinic/i }).click();
  await page.getByRole('option', { name: /General Clinic/i }).click();

  const availabilityResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v2/scheduling/availability'
      && url.searchParams.get('clinic_id') === clinic.id
      && Boolean(url.searchParams.get('service_id'))
      && response.request().method() === 'GET';
  });
  await page.getByRole('combobox').filter({ hasText: /Select type/i }).click();
  await page.getByRole('option', { name: /General/i }).click();
  const availabilityResponse = await availabilityResponsePromise;
  expect(availabilityResponse.ok()).toBe(true);
  await availabilityResponse.finished();

  // Seeded demonstration schedules have fixed dates. Create real future
  // availability so this test remains valid at any time of day or year.
  if (sessionDate.getUTCMonth() !== new Date().getUTCMonth()) {
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
  }
  await page.getByRole('gridcell', { name: String(sessionDate.getUTCDate()), exact: true }).first().click();
  await expect(page.getByText(/No slots for this date/i)).toHaveCount(0);
  await page.getByRole('button', { name: /\d{1,2}:\d{2} [AP]M - \d{1,2}:\d{2} [AP]M/, disabled: false }).first().click();

  const createAppointmentResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v2/scheduling/appointments/book' &&
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
  let result = await postV2FromBrowserRaw(page, path, body);
  // Positive synthetic fixtures still cross the production duplicate-review
  // contract. Raw helpers remain available for tests asserting rejection.
  if (path === '/api/v2/patients'
      && result.status === 409
      && result.payload?.error?.code === 'patient_duplicate_review_required') {
    const lookupId = result.payload.error.details?.lookup_id;
    expect(lookupId).toBeTruthy();
    result = await postV2FromBrowserRaw(page, path, {
      ...body,
      duplicate_review: {
        lookup_id: lookupId,
        decision: 'new_distinct_patient',
        reason_code: 'different_person_confirmed',
        reason_note: 'Synthetic end-to-end fixture; intentionally distinct test identity.',
      },
    });
  }
  if (!result.ok) {
    const routeTemplate = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id');
    throw new Error(`POST ${routeTemplate} failed with ${result.status} (${result.payload?.error?.code || 'unknown_error'})`);
  }
  return result.payload;
}

async function postV2FromBrowserRaw(page, path, body) {
  return page.evaluate(async ({ requestPath, requestBody, accessToken }) => {
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
    if (!accessToken) {
      throw new Error('A successful browser login is required for fixture setup');
    }
    const response = await fetch(requestPath, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Facility-Code': 'HMS',
        ...(csrfToken ? { 'X-HMS-CSRF': csrfToken } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload };
  }, { requestPath: path, requestBody: body, accessToken: accessTokens.get(page) });
}

async function getV2FromBrowser(page, path) {
  return page.evaluate(async ({ requestPath, accessToken }) => {
    if (!accessToken) {
      throw new Error('A successful browser login is required for fixture setup');
    }

    const response = await fetch(requestPath, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Facility-Code': 'HMS',
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const routeTemplate = requestPath.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id');
      throw new Error(`GET ${routeTemplate} failed with ${response.status} (${payload?.error?.code || 'unknown_error'})`);
    }
    return payload;
  }, { requestPath: path, accessToken: accessTokens.get(page) });
}

function v2DataList(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function expectMobileViewportFits(page) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width > 480) return;
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
    message: 'Clinical workflow must fit the mobile viewport without page-level horizontal scrolling',
  }).toBeLessThanOrEqual(viewport.width);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function selectByVisibleText(page, trigger, text) {
  await trigger.click();
  await page.getByRole('option', { name: new RegExp(escapeRegExp(text), 'i') }).first().click();
}

async function pickVisibleCalendarDay(page, fieldLabel, day) {
  await page.getByRole('button', { name: new RegExp(escapeRegExp(fieldLabel), 'i') }).click();
  const dayButton = page.locator('[role=grid] button').filter({ hasText: new RegExp(`^${escapeRegExp(day)}$`) }).first();
  await expect(dayButton).toBeVisible();
  await dayButton.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('grid')).toHaveCount(0);
}

test('Rust V2 static work surfaces load without route crashes or server errors', async ({ page }) => {
  // This exercises the complete route catalog, rather than one short workflow.
  test.setTimeout(120_000);
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
    await test.step(route, async () => {
      await page.goto(route);
      await expect(page.locator('[data-perf-ready="app-shell"]')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page).not.toHaveURL(/\/feature-unavailable(?:[?#]|$)/);
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    });
  }

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 settings shell loads profile, security sessions, and preferences through auth endpoints', async ({ page }) => {
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

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Profile: Manage your personal information/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Security: Password, multi-factor authentication/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Preferences: Theme, notifications/i })).toBeVisible();

  const profileResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/auth/me') &&
    response.request().method() === 'GET'
  ));
  await page.getByRole('button', { name: /Profile: Manage your personal information/i }).click();
  const profileResponse = await profileResponsePromise;
  expect(profileResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email Address')).toHaveValue(adminEmail);
  await expect(page.getByLabel('First Name')).not.toHaveValue('');
  await expect(page.getByLabel('Last Name')).not.toHaveValue('');

  const sessionsResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/auth/sessions') &&
    response.request().method() === 'GET'
  ));
  await page.goto('/settings/security');
  const sessionsResponse = await sessionsResponsePromise;
  expect(sessionsResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Change Password' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active Sessions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Multi-Factor Authentication' })).toBeVisible();
  await expect(page.getByText('MFA Management Unavailable')).toBeVisible();

  await page.goto('/settings/preferences');
  await expect(page.getByRole('heading', { name: 'Preferences', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.getByRole('button', { name: /Dark/i }).click();
  await expect(page.getByRole('button', { name: /Dark/i })).toHaveAttribute('aria-pressed', 'true');

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 inbox lists marks read and exposes PHI-safe realtime subscriptions', async ({ page }) => {
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

  const notificationsPayload = await getV2FromBrowser(page, '/api/v2/notifications?limit=5');
  const notification = v2DataList(notificationsPayload)[0];
  expect(notification?.id).toBeTruthy();
  expect(notification?.title).toBeTruthy();

  await postV2FromBrowser(page, `/api/v2/notifications/${notification.id}/read`, { read: false });

  const realtimePayload = await getV2FromBrowser(page, '/api/v2/realtime/subscriptions');
  const subscriptions = v2DataList(realtimePayload);
  const notificationSubscription = subscriptions.find((subscription) => (
    subscription.channel_kind === 'notifications'
  ));
  expect(notificationSubscription?.channel_name).toMatch(/^facility:[A-Za-z0-9_-]+:notifications$/);
  expect(notificationSubscription.channel_name).not.toContain('HMS');
  expect(notificationSubscription.channel_name).not.toContain(notification.id);

  const inboxResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/notifications')
      && url.searchParams.get('limit') === '50'
      && response.request().method() === 'GET';
  });
  const countsResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/notifications/counts')
      && response.request().method() === 'GET'
  ));
  await page.goto('/inbox');
  const inboxResponse = await inboxResponsePromise;
  const countsResponse = await countsResponsePromise;
  expect(inboxResponse.status()).toBeLessThan(300);
  expect(countsResponse.status()).toBeLessThan(300);
  const inboxPayload = await inboxResponse.json();
  expect(v2DataList(inboxPayload).some((item) => item.id === notification.id)).toBe(true);

  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  const notificationCard = page.locator('article').filter({ hasText: notification.title }).first();
  await expect(notificationCard).toBeVisible();
  await expect(notificationCard.getByRole('button', { name: /Mark read/i })).toBeVisible();

  const markReadResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/notifications/${notification.id}/read`)
      && response.request().method() === 'POST'
  ));
  await notificationCard.getByRole('button', { name: /Mark read/i }).click();
  const markReadResponse = await markReadResponsePromise;
  expect(markReadResponse.status()).toBeLessThan(300);
  expect(markReadResponse.request().postDataJSON()).toEqual({ read: true });
  await expect(notificationCard.getByRole('button', { name: /Mark read/i })).toHaveCount(0);

  const unreadResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/notifications')
      && url.searchParams.get('unread_only') === 'true'
      && response.request().method() === 'GET';
  });
  await page.getByRole('button', { name: /Unread/i }).click();
  const unreadResponse = await unreadResponsePromise;
  expect(unreadResponse.status()).toBeLessThan(300);
  const unreadPayload = await unreadResponse.json();
  expect(v2DataList(unreadPayload).some((item) => item.id === notification.id)).toBe(false);
  await expect(page.locator('article').filter({ hasText: notification.title })).toHaveCount(0);

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 role dashboards render generated snapshot and operational lists', async ({ page }) => {
  test.setTimeout(90_000);
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
  const firstName = 'Dashboard';
  const lastName = `Role${suffix}`;
  const patientName = `${firstName} ${lastName}`;
  const today = new Date().toISOString().slice(0, 10);
  const patientPayload = await postV2FromBrowser(page, '/api/v2/patients', {
    first_name: firstName,
    last_name: lastName,
    date_of_birth: '1991-03-14',
    sex: 'female',
  });
  const patientId = patientPayload?.data?.id;
  expect(patientId).toBeTruthy();

  const appointmentPayload = await postV2FromBrowser(page, '/api/v2/appointments', {
    patient_id: patientId,
    starts_at: `${today}T09:00:00Z`,
    ends_at: `${today}T09:30:00Z`,
  });
  const appointmentId = appointmentPayload?.data?.id;
  expect(appointmentId).toBeTruthy();

  const wardName = `Playwright Dashboard Ward ${suffix}`;
  const wardPayload = await postV2FromBrowser(page, '/api/v2/wards', {
    code: `PWD-${suffix}`,
    name: wardName,
  });
  const wardId = wardPayload?.data?.id;
  expect(wardId).toBeTruthy();

  const bedPayload = await postV2FromBrowser(page, `/api/v2/wards/${wardId}/beds`, {
    section_id: null,
    bed_code: `D-${suffix}`,
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
  expect(taskPayload?.data?.id).toBeTruthy();

  await page.goto('/dashboards/admin');
  await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
  await expect(page.getByText('Current operational posture')).toBeVisible();
  // The worker materializes the dashboard projection asynchronously. Await
  // actual measured metrics rather than treating an empty cache miss as zero.
  await expect.poll(async () => {
    const snapshot = await getV2FromBrowser(page, '/api/v2/dashboards/snapshot');
    return v2DataList({ data: snapshot?.data?.metrics }).map((metric) => metric.key);
  }, { timeout: 20_000, intervals: [250, 500, 1000] }).toEqual(expect.arrayContaining([
    'active_patients', 'waiting_visits', 'open_invoices',
  ]));

  const adminSnapshotResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/dashboards/snapshot')
      && response.request().method() === 'GET'
  ));
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  const adminSnapshotResponse = await adminSnapshotResponsePromise;
  expect(adminSnapshotResponse.status()).toBeLessThan(300);
  const adminSnapshotPayload = await adminSnapshotResponse.json();
  const snapshotMetricKeys = v2DataList({ data: adminSnapshotPayload?.data?.metrics })
    .map((metric) => metric.key);
  expect(snapshotMetricKeys).toEqual(expect.arrayContaining([
    'active_patients',
    'waiting_visits',
    'open_invoices',
  ]));
  await expect(page.getByText('Active Patients', { exact: true })).toBeVisible();
  await expect(page.getByText('Waiting Visits', { exact: true })).toBeVisible();
  await expect(page.getByText('Open Invoices', { exact: true })).toBeVisible();
  await expect(page.getByText(/Alert summary unavailable/)).toBeVisible();

  const capacityResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/dashboards/admin-v2/capacity')
      && url.searchParams.get('limit') === '8'
      && response.request().method() === 'GET';
  });
  await page.getByRole('button', { name: /Expand/ }).first().click();
  const capacityResponse = await capacityResponsePromise;
  expect(capacityResponse.status()).toBeLessThan(300);
  const capacityPayload = await capacityResponse.json();
  expect(capacityPayload?.data?.summary?.ward_count).toBeGreaterThan(0);
  await expect(page.getByText(/High occupancy wards/i)).toBeVisible();

  const receptionAppointmentsResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/appointments')
      && url.searchParams.get('date') === today
      && url.searchParams.get('limit') === '50'
      && response.request().method() === 'GET';
  });
  const receptionPatientsResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/patients')
      && url.searchParams.get('limit') === '10'
      && url.searchParams.get('status') === 'active'
      && response.request().method() === 'GET';
  });
  const receptionBillingResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/billing/dashboard-summary')
      && response.request().method() === 'GET'
  ));
  await page.goto('/dashboards/reception');
  const [
    receptionAppointmentsResponse,
    receptionPatientsResponse,
    receptionBillingResponse,
  ] = await Promise.all([
    receptionAppointmentsResponsePromise,
    receptionPatientsResponsePromise,
    receptionBillingResponsePromise,
  ]);
  expect(receptionAppointmentsResponse.status()).toBeLessThan(300);
  expect(receptionPatientsResponse.status()).toBeLessThan(300);
  expect(receptionBillingResponse.status()).toBeLessThan(300);
  const receptionAppointmentsPayload = await receptionAppointmentsResponse.json();
  expect(v2DataList(receptionAppointmentsPayload).some((appointment) => appointment.id === appointmentId)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Reception Dashboard' })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();

  const providerWorkResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v2/care-areas/my-work'
      && response.request().method() === 'GET'
  ));
  await page.goto('/dashboard/provider');
  expect((await providerWorkResponsePromise).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'My Work', exact: true })).toBeVisible();

  const inpatientWardBoardResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/wards/board')
      && url.searchParams.get('limit') === '20'
      && response.request().method() === 'GET';
  });
  const inpatientDischargesResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/discharges')
      && url.searchParams.get('limit') === '20'
      && response.request().method() === 'GET';
  });
  const inpatientTasksResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/nursing/tasks')
      && url.searchParams.get('limit') === '20'
      && response.request().method() === 'GET';
  });
  await page.goto('/dashboards/inpatient');
  const [
    inpatientWardBoardResponse,
    inpatientDischargesResponse,
    inpatientTasksResponse,
  ] = await Promise.all([
    inpatientWardBoardResponsePromise,
    inpatientDischargesResponsePromise,
    inpatientTasksResponsePromise,
  ]);
  expect(inpatientWardBoardResponse.status()).toBeLessThan(300);
  expect(inpatientDischargesResponse.status()).toBeLessThan(300);
  expect(inpatientTasksResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: 'Inpatient Dashboard' })).toBeVisible();
  await expect(page.getByText('Ward preview', { exact: true })).toBeVisible();
  await expect(page.getByText('Discharge records', { exact: true })).toBeVisible();

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 referrals create inbox sent SLA and waitlist workflows use generated endpoints', async ({ page }) => {
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

  const patientName = uniquePatientName('Referral');
  const patientPayload = await postV2FromBrowser(page, '/api/v2/patients', {
    first_name: 'Playwright',
    last_name: patientName.replace('Playwright ', ''),
    date_of_birth: '1989-08-18',
    sex: 'female',
  });
  const patientId = patientPayload?.data?.id;
  expect(patientId).toBeTruthy();

  await page.goto(`/patients/${patientId}/chronicle`);
  await expect(page.getByRole('heading', { name: 'Team-based access required' })).toBeVisible();
  await expect(page.getByText(/This patient record is protected by team-based access controls/)).toBeVisible();
  await expect(page.getByPlaceholder('Search notes, prescriptions...')).toHaveCount(0);

  const createReferralPayload = await postV2FromBrowser(page, '/api/v2/referrals', {
    patient_id: patientId,
    to_service: 'cardiology',
    priority: 'urgent',
    reason: 'Playwright Rust V2 referral smoke review',
  });
  const referralId = createReferralPayload?.data?.id;
  expect(referralId).toBeTruthy();
  const referralDetailPayload = await getV2FromBrowser(page, `/api/v2/referrals/${referralId}`);
  expect(referralDetailPayload?.data?.id).toBe(referralId);

  const waitlistPayload = await postV2FromBrowser(page, '/api/v2/referrals/clinic-waitlist', {
    patient_id: patientId,
    service: 'cardiology',
    priority: 'urgent',
  });
  expect(waitlistPayload?.data?.id).toBeTruthy();
  expect(waitlistPayload?.data?.status).toBe('waiting');

  const inboxResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/referrals')
      && url.searchParams.get('limit') === '50'
      && response.request().method() === 'GET';
  });
  const slaDashboardResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/referrals/sla-dashboard')
      && response.request().method() === 'GET'
  ));
  const waitlistSummaryResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/referrals/clinic-waitlist')
      && url.searchParams.get('limit') === '50'
      && response.request().method() === 'GET';
  });
  await page.goto('/referrals/inbox');
  const [
    inboxResponse,
    slaDashboardResponse,
    waitlistSummaryResponse,
  ] = await Promise.all([
    inboxResponsePromise,
    slaDashboardResponsePromise,
    waitlistSummaryResponsePromise,
  ]);
  expect(inboxResponse.status()).toBeLessThan(300);
  expect(slaDashboardResponse.status()).toBeLessThan(300);
  expect(waitlistSummaryResponse.status()).toBeLessThan(300);

  await expect(page.getByRole('heading', { name: 'Referral Inbox' })).toBeVisible();
  await page.getByPlaceholder('Search by patient name, MRN, referral number, or reason...').fill(patientName);
  const inboxReferralCard = page.locator('.animate-chronicle-enter').filter({ hasText: patientName }).first();
  await expect(inboxReferralCard).toBeVisible();
  await expect(inboxReferralCard).toContainText('Pending Review');
  await expect(page.getByText(/\d+ Waitlist/).first()).toBeVisible();

  const acceptReferralResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/referrals/${referralId}/accept`)
      && response.request().method() === 'POST'
  ));
  await inboxReferralCard.getByRole('button', { name: 'Accept' }).click();
  await page.getByLabel(/Acceptance Notes/i).fill('Accepted from Playwright Rust V2 smoke');
  await page.getByRole('dialog').getByRole('button', { name: 'Accept Referral' }).click();
  const acceptReferralResponse = await acceptReferralResponsePromise;
  expect(acceptReferralResponse.status()).toBeLessThan(300);
  expect(acceptReferralResponse.request().postDataJSON()).toEqual({
    acceptance_notes: 'Accepted from Playwright Rust V2 smoke',
  });
  await expect(inboxReferralCard).toContainText('Accepted');

  const sentResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/referrals')
      && url.searchParams.get('limit') === '50'
      && response.request().method() === 'GET';
  });
  const sentSlaDashboardResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/referrals/sla-dashboard')
      && response.request().method() === 'GET'
  ));
  await page.goto('/referrals/sent');
  const sentResponse = await sentResponsePromise;
  const sentSlaDashboardResponse = await sentSlaDashboardResponsePromise;
  expect(sentResponse.status()).toBeLessThan(300);
  expect(sentSlaDashboardResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: 'Sent Referrals' })).toBeVisible();
  await page.getByPlaceholder('Search by patient name, MRN, department, or reason...').fill(patientName);
  const sentReferralCard = page.locator('.animate-chronicle-enter').filter({ hasText: patientName }).first();
  await expect(sentReferralCard).toBeVisible();

  const slaStateResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/referrals/${referralId}/sla-state`)
      && response.request().method() === 'GET'
  ));
  await sentReferralCard.getByRole('button', { name: 'View Details' }).click();
  const slaStateResponse = await slaStateResponsePromise;
  expect(slaStateResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('dialog').getByText('SLA Status')).toBeVisible();

  const offerNextResponse = await postV2FromBrowser(page, '/api/v2/referrals/clinic-waitlist/offer-next', {
    service: 'cardiology',
  });
  expect(offerNextResponse?.data?.status).toBe('offered');
  expect(offerNextResponse?.data?.patient_id).toBe(patientId);

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 consent grant stays inside patient context and uses generated consents endpoint', async ({ page }) => {
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

  const patientName = uniquePatientName('Consent');
  const patientPayload = await postV2FromBrowser(page, '/api/v2/patients', {
    first_name: 'Playwright',
    last_name: patientName.replace('Playwright ', ''),
    date_of_birth: '1992-04-23',
    sex: 'female',
  });
  const patientId = patientPayload?.data?.id;
  expect(patientId).toBeTruthy();

  await startClinicalFixture(page, patientId);
  await page.goto(`/patients/${patientId}/chronicle`);
  await expect(page.getByRole('heading', { name: patientName })).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Share Record' }).click();
  await expect(page.getByRole('heading', { name: 'Cross-Facility Share' })).toBeVisible();
  await expect(page.getByText('Consent Grant').first()).toBeVisible();
  await expect(page.getByText('Referral Request')).toHaveCount(0);
  await expect(page.getByText('Access Token')).toHaveCount(0);
  await expect(page.getByText('Step 1 of 1')).toBeVisible();

  await page.getByPlaceholder('E.g. REGIONAL-01').fill('KATH');
  await page.getByPlaceholder('Document the patient consent discussion...').fill(
    'Playwright Rust V2 consent grant smoke',
  );
  await page.getByPlaceholder('Leave blank for no expiration').fill('7');

  const consentResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/consents') &&
    response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Grant Consent' }).click();
  const consentResponse = await consentResponsePromise;
  expect(consentResponse.status()).toBeLessThan(300);
  const consentBody = consentResponse.request().postDataJSON();
  expect(consentBody).toEqual(expect.objectContaining({
    patient_id: patientId,
    scope: 'referral_coordination',
    purpose: 'Playwright Rust V2 consent grant smoke',
  }));
  expect(consentBody.expires_at).toEqual(expect.any(String));
  const consentPayload = await consentResponse.json();
  expect(consentPayload?.data?.status).toBe('active');

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 registration starts with identity lookup and keeps creation disabled until lookup', async ({ page }) => {
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

  await expect(page.getByRole('heading', { name: 'Find or Register Patient', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for Existing Patient' })).toBeDisabled();
  await expect(page.getByLabel('MRN / Hospital Number', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue New Registration|Register New Distinct Patient/ })).toHaveCount(0);

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 patient registration completes identity lookup and opens the administrative profile', async ({ page }) => {
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

  await expectMobileViewportFits(page);
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
    const nextButton = page.getByRole('button', { name: 'Next', exact: true });
    if (!(await nextButton.isVisible({ timeout: 500 }).catch(() => false))) {
      break;
    }
    await nextButton.click();
  }

  const response = await updatePatientResponse;
  expect(response.status()).toBeLessThan(300);
  await expect(page).toHaveURL(patientDetailRoutePattern);
  await expect(page.getByRole('heading', { name: 'Playwright Updated' })).toBeVisible();

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 patient registry searches real patients and opens an owned clinical record', async ({ page }) => {
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
  const firstName = 'Registry';
  const lastName = `Search${suffix}`;
  const createdPatientPayload = await postV2FromBrowser(page, '/api/v2/patients', {
    first_name: firstName,
    last_name: lastName,
    date_of_birth: '1990-01-15',
    sex: 'female',
  });
  const patientId = createdPatientPayload?.data?.id;
  expect(patientId).toBeTruthy();
  await startClinicalFixture(page, patientId);

  await page.goto('/patients');
  await expect(page.getByRole('heading', { name: 'Patient Directory' })).toBeVisible();

  const searchResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/patients/search')
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.search === lastName;
  });
  await page.getByPlaceholder('Search by name, MRN, or NHIS ID...').fill(lastName);
  const searchResponse = await searchResponsePromise;
  expect(searchResponse.status()).toBeLessThan(300);

  const resultRow = page.getByRole('row', { name: new RegExp(`${firstName} ${lastName}`, 'i') }).first();
  await expect(resultRow).toBeVisible();
  await expect(resultRow).toContainText('Registered');

  const detailResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v2/patients/${patientId}/chronicle`
      && response.request().method() === 'GET'
  ));
  await resultRow.click();
  const detailResponse = await detailResponsePromise;
  expect(detailResponse.status()).toBeLessThan(300);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/chronicle$`));
  await expect(page.getByRole('heading', { name: `${firstName} ${lastName}` })).toBeVisible();

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 my patients page renders context patients from the generated endpoint', async ({ page }) => {
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
  const fixturePatient = await postV2FromBrowser(page, '/api/v2/patients', {
    first_name: 'Context',
    last_name: uniquePatientName('Care').replace('Playwright ', ''),
    date_of_birth: '1987-03-12',
    sex: 'female',
  });
  await startClinicalFixture(page, fixturePatient.data.id);

  const contextResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith('/api/v2/patients/context')
      && response.request().method() === 'GET'
  ));
  await page.goto('/patients/my-patients');
  const contextResponse = await contextResponsePromise;
  expect(contextResponse.status()).toBeLessThan(300);

  const contextPayload = await contextResponse.json();
  const contextPatients = v2DataList(contextPayload);
  expect(contextPatients.length).toBeGreaterThan(0);
  const contextPatient = contextPatients.find((patient) => patient.id === fixturePatient.data.id);
  expect(contextPatient?.id).toBeTruthy();
  expect(contextPatient?.display_name).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'My Patients' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Registry' })).toBeVisible();

  const patientRow = page.getByRole('row').filter({ hasText: contextPatient.display_name }).first();
  await expect(patientRow).toBeVisible();
  if (contextPatient.patient_code) {
    await expect(patientRow).toContainText(contextPatient.patient_code);
  }
  await expect(patientRow).toContainText('Context');

  const detailResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v2/patients/${contextPatient.id}/chronicle`
      && response.request().method() === 'GET'
  ));
  await patientRow.click();
  const detailResponse = await detailResponsePromise;
  expect(detailResponse.status()).toBeLessThan(300);
  await expect(page).toHaveURL(new RegExp(`/patients/${contextPatient.id}/chronicle$`));

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 pharmacy dispensing surface calls generated dispenses without surfacing completed work', async ({ page }) => {
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
  const patientPayload = await postV2FromBrowser(page, '/api/v2/patients', {
    first_name: 'Pharmacy',
    last_name: `Dispense${suffix}`,
    date_of_birth: '1985-02-20',
    sex: 'female',
  });
  const patientId = patientPayload?.data?.id;
  expect(patientId).toBeTruthy();

  const itemsPayload = await getV2FromBrowser(page, '/api/v2/inventory/items?limit=100');
  const locationsPayload = await getV2FromBrowser(page, '/api/v2/inventory/storage-locations?limit=100');
  const inventoryItems = v2DataList(itemsPayload);
  const locations = v2DataList(locationsPayload);
  const stockItem = inventoryItems.find((item) => !item.controlled && /paracetamol/i.test(item.name))
    || inventoryItems.find((item) => !item.controlled);
  const pharmacyLocation = locations.find((location) => /pharmacy|dispensary/i.test(location.name))
    || locations[0];
  expect(stockItem?.id).toBeTruthy();
  expect(stockItem?.name).toBeTruthy();
  expect(pharmacyLocation?.id).toBeTruthy();

  await postV2FromBrowser(page, '/api/v2/inventory/stock-batches', {
    item_id: stockItem.id,
    location_id: pharmacyLocation.id,
    batch_number: `PWD-${suffix}`,
    expires_on: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    quantity_received: 6,
  });

  const dispensePayload = await postV2FromBrowser(page, '/api/v2/pharmacy/dispenses', {
    patient_id: patientId,
    item_id: stockItem.id,
    location_id: pharmacyLocation.id,
    quantity: 2,
  });
  const dispenseId = dispensePayload?.data?.id;
  expect(dispenseId).toBeTruthy();
  expect(dispensePayload?.data?.status).toBe('dispensed');

  const queueResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/pharmacy/dispensing-queue')
      && url.searchParams.get('limit') === '50'
      && url.searchParams.get('status') === 'pending'
      && response.request().method() === 'GET';
  });

  await page.goto('/pharmacy/dispensing');
  const queueResponse = await queueResponsePromise;
  expect(queueResponse.status()).toBeLessThan(300);
  const queuePayload = await queueResponse.json();
  expect(v2DataList(queuePayload).some((row) => row.patient_id === patientId)).toBe(false);

  const pharmacyMain = page.locator('main');
  await expect(page.getByRole('heading', { name: 'Pharmacy Dispensing' })).toBeVisible();
  await expect(
    pharmacyMain.getByText(/Rust V2 dispensing is available per medication row once the prescription is linked to an inventory item/i),
  ).toBeVisible();
  await expect(pharmacyMain.getByRole('heading', { name: 'Queue Empty' })).toBeVisible();
  await expect(pharmacyMain.getByText(stockItem.name, { exact: true })).toHaveCount(0);
  await expect(pharmacyMain.getByRole('button', { name: /^Dispense$/i })).toHaveCount(0);
  await expect(pharmacyMain.getByRole('button', { name: /Dispense Selected/i })).toHaveCount(0);
  await expect(pharmacyMain.getByRole('checkbox')).toHaveCount(0);

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 billing invoice creation detail and manual payment use generated endpoints', async ({ page }) => {
  test.setTimeout(60_000);
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
  const patientFirstName = 'Billing';
  const patientLastName = `Invoice${suffix}`;
  const patientPayload = await postV2FromBrowser(page, '/api/v2/patients', {
    first_name: patientFirstName,
    last_name: patientLastName,
    date_of_birth: '1992-04-10',
    sex: 'female',
  });
  const patientId = patientPayload?.data?.id;
  expect(patientId).toBeTruthy();

  const servicesPayload = await getV2FromBrowser(page, '/api/v2/billing/service-catalog?limit=100&is_active=true');
  const billableServices = v2DataList(servicesPayload);
  const service = billableServices.find((item) => item.active_price_id || item.service_price_id)
    || billableServices[0];
  const servicePriceId = service?.active_price_id || service?.service_price_id;
  expect(service?.id).toBeTruthy();
  expect(service?.name).toBeTruthy();
  expect(servicePriceId).toBeTruthy();

  const serviceCatalogResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/billing/service-catalog')
      && response.request().method() === 'GET';
  });
  await page.goto(`/billing/invoices/new?patient=${patientId}`);
  await expect(page.getByRole('heading', { name: /Create Invoice/i })).toBeVisible();
  await serviceCatalogResponsePromise;
  await expect(page.getByText(`${patientFirstName} ${patientLastName}`).first()).toBeVisible();

  await selectByVisibleText(
    page,
    page.getByRole('combobox').filter({ hasText: /Select from service catalog/i }).first(),
    service.name,
  );
  await page.locator('input[type="number"]').first().fill('2');
  await page.getByPlaceholder('Any additional notes for this invoice...').fill('Rust V2 billing smoke invoice.');

  const createInvoiceResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/billing/invoices')
      && response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Create Invoice' }).click();

  const createInvoiceResponse = await createInvoiceResponsePromise;
  expect(createInvoiceResponse.status()).toBeLessThan(300);
  expect(createInvoiceResponse.request().postDataJSON()).toEqual({
    patient_id: patientId,
    service_price_id: servicePriceId,
    quantity: 2,
  });
  const invoicePayload = await createInvoiceResponse.json();
  const invoiceId = invoicePayload?.data?.id;
  const invoiceNumber = invoicePayload?.data?.invoice_number;
  const patientCode = invoicePayload?.data?.patient_code;
  const invoiceBalanceMinor = invoicePayload?.data?.balance_minor;
  expect(invoiceId).toBeTruthy();
  expect(invoiceNumber).toBeTruthy();
  expect(patientCode).toBeTruthy();
  expect(invoiceBalanceMinor).toBeGreaterThan(0);

  await expect(page).toHaveURL(new RegExp(`/billing/invoices/${invoiceId}$`));
  await expect(page.getByRole('heading', { name: new RegExp(escapeRegExp(invoiceNumber)) })).toBeVisible();
  await expect(page.getByText(patientCode).first()).toBeVisible();
  const recordPaymentButton = page.getByRole('button', { name: 'Record Payment', exact: true });
  await expect(recordPaymentButton).toBeVisible();

  const detailResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/billing/invoices/${invoiceId}`)
      && response.request().method() === 'GET'
  ));
  await page.reload();
  const detailResponse = await detailResponsePromise;
  expect(detailResponse.status()).toBeLessThan(300);

  await recordPaymentButton.click();
  const paymentPanel = page.locator('div.fixed.inset-y-0.right-0').filter({ hasText: invoiceNumber });
  await expect(paymentPanel).toHaveClass(/translate-x-0/);
  await selectByVisibleText(
    page,
    paymentPanel.getByRole('combobox').filter({ hasText: /^Cash$/i }).first(),
    'Bank Transfer',
  );
  await expect(paymentPanel.getByRole('button', { name: 'Open Session' })).toHaveCount(0);
  await paymentPanel.getByLabel(/Reference Number/i).fill(`PW-PAY-${suffix}`);

  const paymentResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/billing/payments')
      && response.request().method() === 'POST'
  ));

  await paymentPanel.getByRole('button', { name: /Record Payment \(Manual\)/i }).click();

  const paymentResponse = await paymentResponsePromise;
  expect(paymentResponse.status()).toBeLessThan(300);
  expect(paymentResponse.request().postDataJSON()).toEqual({
    invoice_id: invoiceId,
    amount_minor: invoiceBalanceMinor,
    method: 'bank_transfer',
    cash_session_id: null,
  });
  const paymentPayload = await paymentResponse.json();
  const paymentId = paymentPayload?.data?.id;
  const receiptNumber = paymentPayload?.data?.receipt_number;
  expect(paymentId).toBeTruthy();
  expect(receiptNumber).toBeTruthy();
  await expect(paymentPanel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record Payment', exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Paid$/i).first()).toBeVisible();

  const invoiceListResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/billing/invoices')
      && response.request().method() === 'GET';
  });
  await page.goto('/billing/invoices');
  const invoiceListResponse = await invoiceListResponsePromise;
  expect(invoiceListResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  await expect(page.getByText(invoiceNumber).first()).toBeVisible();

  const paymentsResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/billing/payments')
      && response.request().method() === 'GET';
  });
  await page.goto('/billing/payments');
  const paymentsResponse = await paymentsResponsePromise;
  expect(paymentsResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: /Payment History/i })).toBeVisible();
  await expect(page.getByText(receiptNumber).first()).toBeVisible();
  await expect(page.getByText(/Bank/i).first()).toBeVisible();

  const cashInvoice = await postV2FromBrowser(page, '/api/v2/billing/invoices', {
    patient_id: patientId,
    service_price_id: servicePriceId,
    quantity: 1,
  });
  expect(cashInvoice.data.balance_minor).toBeGreaterThan(0);
  await page.goto(`/billing/invoices/${cashInvoice.data.id}`);
  const currentSessionResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v2/billing/cash-sessions'
      && url.searchParams.get('status') === 'open'
      && response.request().method() === 'GET';
  });
  await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
  const currentSessionResponse = await currentSessionResponsePromise;
  expect(currentSessionResponse.ok()).toBe(true);
  let cashSessionId = v2DataList(await currentSessionResponse.json())[0]?.id;
  const cashPanel = page.locator('div.fixed.inset-y-0.right-0').filter({ hasText: cashInvoice.data.invoice_number });
  await expect(cashPanel).toHaveClass(/translate-x-0/);
  if (!cashSessionId) {
    const openSessionResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/v2/billing/cash-sessions'
        && response.request().method() === 'POST'
    ));
    await cashPanel.getByLabel('Opening Float (GHS)').fill('0');
    await cashPanel.getByRole('button', { name: 'Open Session', exact: true }).click();
    const openSessionResponse = await openSessionResponsePromise;
    expect(openSessionResponse.ok()).toBe(true);
    cashSessionId = (await openSessionResponse.json()).data.id;
  }
  expect(cashSessionId).toBeTruthy();
  await expect(cashPanel.getByRole('button', { name: 'Open Session', exact: true })).toHaveCount(0);
  const cashPaymentResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v2/billing/payments'
      && response.request().method() === 'POST'
  ));
  await cashPanel.getByRole('button', { name: /Record Payment \(Manual\)/i }).click();
  const cashPaymentResponse = await cashPaymentResponsePromise;
  expect(cashPaymentResponse.ok()).toBe(true);
  expect(cashPaymentResponse.request().postDataJSON()).toEqual({
    invoice_id: cashInvoice.data.id,
    amount_minor: cashInvoice.data.balance_minor,
    method: 'cash',
    cash_session_id: cashSessionId,
  });
  await expect(cashPanel).toHaveCount(0);
  await expect(page.getByText(/^Paid$/i).first()).toBeVisible();

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 admin organization staff and audit workflows use generated endpoints', async ({ page }) => {
  test.setTimeout(60_000);
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
  const orgCode = `PWDADM${suffix.slice(-6)}`;
  const orgName = `Playwright Admin Department ${suffix}`;

  const orgTreeResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/admin/org-units')
      && response.request().method() === 'GET';
  });
  await page.goto('/admin/organization');
  const orgTreeResponse = await orgTreeResponsePromise;
  expect(orgTreeResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: 'Organization' })).toBeVisible();

  await page.getByRole('button', { name: /Add Unit/i }).click();
  await expect(page.getByRole('heading', { name: 'Create Unit' })).toBeVisible();
  await selectByVisibleText(
    page,
    page.getByRole('combobox').filter({ hasText: /Select unit type/i }).first(),
    'Department',
  );
  await page.getByRole('textbox', { name: /Code/i }).fill(orgCode);
  await page.getByRole('textbox', { name: /Short Name/i }).fill(`PW ${suffix.slice(-4)}`);
  await page.getByRole('textbox', { name: /Full Name/i }).fill(orgName);

  const createOrgResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/admin/org-units')
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Create Unit' }).click();

  const createOrgResponse = await createOrgResponsePromise;
  expect(createOrgResponse.status()).toBeLessThan(300);
  expect(createOrgResponse.request().postDataJSON()).toEqual({
    code: orgCode,
    name: orgName,
    unit_type: 'department',
    parent_unit_id: null,
  });
  const createdOrgPayload = await createOrgResponse.json();
  const createdOrgUnit = createdOrgPayload?.data;
  expect(createdOrgUnit?.id).toBeTruthy();
  expect(createdOrgUnit?.name).toBe(orgName);
  await expect(page.locator('div.fixed.inset-y-0.right-0').filter({ hasText: 'Create Unit' })).toHaveClass(/translate-x-full/);

  const departmentsPayload = await getV2FromBrowser(page, '/api/v2/admin/org-units?unit_type=department&is_active=true&limit=100');
  const availableDepartments = v2DataList(departmentsPayload);
  const staffDepartment = availableDepartments.find((department) => department.id === createdOrgUnit.id)
    || availableDepartments.find((department) => department.name === orgName)
    || availableDepartments[0];
  expect(staffDepartment?.name).toBeTruthy();

  const staffFirstName = 'Admin';
  const staffLastName = `Staff${suffix}`;
  const staffDisplayName = `${staffFirstName} ${staffLastName}`;
  const staffEmail = `playwright.staff.${suffix.toLowerCase()}@example.test`;
  const initialPosition = 'Front Desk Officer';
  const updatedPosition = 'Senior Front Desk Officer';

  const departmentOptionsResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/admin/org-units')
      && url.searchParams.get('unit_type') === 'department'
      && response.request().method() === 'GET';
  });
  await page.goto('/staff/create');
  const departmentOptionsResponse = await departmentOptionsResponsePromise;
  expect(departmentOptionsResponse.status()).toBeLessThan(300);

  await expect(page.getByRole('heading', { name: 'Add Staff Member' })).toBeVisible();
  await page.getByPlaceholder('First name').fill(staffFirstName);
  await page.getByPlaceholder('Last name').fill(staffLastName);
  await page.getByPlaceholder('Email address').fill(staffEmail);
  await pickVisibleCalendarDay(page, 'Date of Birth', '10');
  await selectByVisibleText(
    page,
    page.getByRole('combobox').filter({ hasText: /Select user type/i }).first(),
    'Receptionist',
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(page.getByPlaceholder('Employee ID')).toHaveCount(0);
  await selectByVisibleText(
    page,
    page.getByRole('combobox').filter({ hasText: /Select department|No departments configured|Loading departments/i }).first(),
    staffDepartment.name,
  );
  await page.getByPlaceholder('Position').fill(initialPosition);
  await pickVisibleCalendarDay(page, 'Hire Date', '11');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(page.getByPlaceholder('Temporary password')).toHaveCount(0);
  const contactNextButton = page.getByRole('button', { name: 'Next', exact: true });
  await expect(contactNextButton).toBeVisible();
  await contactNextButton.click();
  await expect(page.getByText('Temporary Password:')).toHaveCount(0);

  const createStaffResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/admin/staff')
      && response.request().method() === 'POST'
  ));
  const createStaffButton = page.getByRole('button', { name: 'Create Staff Member' });
  await expect(createStaffButton).toBeVisible();
  await createStaffButton.click();

  const createStaffResponse = await createStaffResponsePromise;
  const createStaffBody = createStaffResponse.request().postDataJSON();
  expect(createStaffBody).toMatchObject({
    email: staffEmail,
    display_name: staffDisplayName,
    department: staffDepartment.name,
    position: initialPosition,
  });
  expect(createStaffBody).not.toHaveProperty('temporary_password');
  expect(createStaffBody).not.toHaveProperty('password');
  expect(createStaffBody).not.toHaveProperty('employee_id');
  expect(createStaffBody).not.toHaveProperty('date_of_birth');
  expect(createStaffBody.hire_date).toMatch(/^\d{4}-\d{2}-11$/);

  const createdStaffPayload = await createStaffResponse.json();
  let staffId;
  if (!adminPasskeyEnrolled || !staffSetupDeliveryEnabled) {
    if (!adminPasskeyEnrolled) {
      expect(createStaffResponse.status()).toBe(403);
      expect(createdStaffPayload?.error).toMatchObject({
        code: 'passkey_required',
        message: 'Passkey enrollment is required for this privileged action.',
      });
      await expect(page.getByText('Passkey enrollment is required for this privileged action.').first()).toBeVisible();
    } else {
      expect(createStaffResponse.status()).toBe(409);
      expect(createdStaffPayload?.error?.code).toBe('staff_account_setup_delivery_unavailable');
    }
    await expect(page).toHaveURL(/\/staff\/create$/);
    const staffAfterAttempt = await getV2FromBrowser(page, `/api/v2/admin/staff?search=${encodeURIComponent(staffEmail)}`);
    expect(v2DataList(staffAfterAttempt).some((staff) => staff.email === staffEmail)).toBe(false);
  } else {
    expect(createStaffResponse.status()).toBeLessThan(300);
    staffId = createdStaffPayload?.data?.id;
    expect(staffId).toBeTruthy();
    const employeeId = createdStaffPayload?.data?.employee_id;
    expect(employeeId).toBeTruthy();
    expect(createdStaffPayload?.data).not.toHaveProperty('setup_token');
    await expect(page).toHaveURL(new RegExp(`/staff/${staffId}$`));
    await expect(page.getByRole('heading', { name: staffDisplayName })).toBeVisible();
    await expect(page.getByText(employeeId).first()).toBeVisible();
    await expect(page.getByText(staffDepartment.name).first()).toBeVisible();
    await expect(page.getByText(initialPosition).first()).toBeVisible();
    await expect(page.getByText(staffEmail).first()).toBeVisible();

    await page.getByRole('button', { name: /Edit Profile/i }).click();
    await page.getByLabel('Position').fill(updatedPosition);
    const updateStaffResponsePromise = page.waitForResponse((response) => (
      response.url().endsWith(`/api/v2/admin/staff/${staffId}`)
        && response.request().method() === 'PATCH'
    ));
    await page.getByRole('button', { name: /^Save$/ }).click();
    const updateStaffResponse = await updateStaffResponsePromise;
    expect(updateStaffResponse.status()).toBeLessThan(300);
    expect(updateStaffResponse.request().postDataJSON()).toMatchObject({
      department: staffDepartment.name,
      position: updatedPosition,
    });
    await expect(page.getByText(updatedPosition).first()).toBeVisible();
  }

  const auditListResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/admin/audit-events')
      && response.request().method() === 'GET';
  });
  await page.goto('/admin/audit-logs');
  const auditListResponse = await auditListResponsePromise;
  expect(auditListResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: /Audit Logs/i })).toBeVisible();

  const auditSearchResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v2/admin/audit-events/search'
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.search === 'staff';
  });
  await page.getByLabel('Search logs by description, user, or resource').fill('staff');
  const auditSearchResponse = await auditSearchResponsePromise;
  expect(auditSearchResponse.status()).toBeLessThan(300);
  const auditSearchPayload = await auditSearchResponse.json();
  expect(Array.isArray(auditSearchPayload?.data)).toBe(true);
  if (adminPasskeyEnrolled && staffSetupDeliveryEnabled) {
    expect(v2DataList(auditSearchPayload).some((event) => (
      event.resource_id === staffId && /^admin\.staff\./i.test(event.event_type || '')
    ))).toBe(true);
    await expect(page.getByText(/Admin Staff/i).first()).toBeVisible();
  }

  await expectMobileViewportFits(page);
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

  await expectMobileViewportFits(page);
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
    new URL(response.url()).pathname === `/api/v2/scheduling/appointments/${appointmentId}/arrive` &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Check In' }).click();

  const response = await checkInResponse;
  expect(response.status()).toBeLessThan(300);
  expect(response.request().postDataJSON()).toHaveProperty('clinic_id');
  const arrivedVisit = (await response.json()).data;
  expect(arrivedVisit).toMatchObject({ appointment_id: appointmentId, status: 'waiting' });
  expect(arrivedVisit.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(arrivedVisit.clinic_id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText(/^Arrived$/i).first()).toBeVisible();
  await expect(page.getByRole('complementary').getByText(/^Arrived$/i).locator('..')).toContainText('Current');
  await expect(page.getByRole('button', { name: 'Check In', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel Appointment' })).toHaveCount(0);

  await expectMobileViewportFits(page);
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
  await page.getByLabel('Cancellation reason').fill('Patient requested cancellation during Rust V2 smoke.');

  const cancelResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/v2/appointments/${appointmentId}/cancel`) &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Confirm Cancellation' }).click();

  const response = await cancelResponse;
  expect(response.status()).toBeLessThan(300);
  expect(response.request().postDataJSON()).toEqual({
    reason: 'Patient requested cancellation during Rust V2 smoke.',
  });
  await expect(page.getByText(/^Cancelled$/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check In' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel Appointment' })).toHaveCount(0);

  await expectMobileViewportFits(page);
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

  await expectMobileViewportFits(page);
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

  await expectMobileViewportFits(page);
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
    new URL(response.url()).pathname === `/api/v2/scheduling/appointments/${appointmentId}/arrive` &&
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
    .locator('.group.relative')
    .filter({ hasText: patientName })
    .filter({ hasText: 'Room Patient' })
    .first();
  await expect(waitingCard).toBeVisible();

  const callResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/v2/visits/${visitId}/call`) &&
    response.request().method() === 'POST'
  ));

  await waitingCard.getByRole('button', { name: 'Room Patient', exact: true }).click();

  const response = await callResponse;
  expect(response.status()).toBeLessThan(300);

  const calledCard = page
    .locator('.group.relative')
    .filter({ hasText: patientName })
    .filter({ hasText: 'Start Consultation' })
    .first();
  await expect(page.getByText(/Called/i).first()).toBeVisible();
  await expect(calledCard).toBeVisible();

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 triage assigns staff and completes an emergency assessment through the UI', async ({ page }) => {
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
  const patientIdentity = {
    first_name: 'Playwright',
    last_name: patientName.replace('Playwright ', ''),
    date_of_birth: '1990-01-15',
    sex: 'female',
  };
  const creation = await postV2FromBrowserRaw(page, '/api/v2/patients', patientIdentity);
  let patientPayload = creation.payload;
  if (creation.status === 409 && creation.payload?.error?.code === 'patient_duplicate_review_required') {
    const lookupId = creation.payload.error.details?.lookup_id;
    expect(lookupId).toBeTruthy();
    patientPayload = await postV2FromBrowser(page, '/api/v2/patients', {
      ...patientIdentity,
      duplicate_review: {
        lookup_id: lookupId,
        decision: 'new_distinct_patient',
        reason_code: 'different_person_confirmed',
        reason_note: 'Synthetic end-to-end fixture; intentionally distinct test identity.',
      },
    });
  } else {
    expect(creation.ok).toBe(true);
  }
  const patientId = patientPayload?.data?.id;
  expect(patientId).toBeTruthy();
  const visitPayload = await postV2FromBrowser(page, '/api/v2/visits/check-in', {
    patient_id: patientId,
  });
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
    .locator('.group.relative')
    .filter({ hasText: patientName })
    .first();
  await expect(waitingCard).toBeVisible();

  const directoryResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v2/staff/directory'
      && response.request().method() === 'GET'
  ));
  await waitingCard.getByRole('button', { name: 'Assign staff', exact: true }).click();
  const directoryResponse = await directoryResponsePromise;
  expect(directoryResponse.ok()).toBe(true);
  const assignee = v2DataList(await directoryResponse.json())[0];
  expect(assignee?.user_id).toMatch(/^[0-9a-f-]{36}$/);
  const assignmentDialog = page.getByRole('dialog', { name: 'Assign Triage Staff' });
  await assignmentDialog.getByRole('combobox', { name: 'Staff member *' }).click();
  await page.getByRole('option', { name: new RegExp(escapeRegExp(assignee.display_name)) }).click();
  const assignmentResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/triage/${triageId}/assign`)
      && response.request().method() === 'POST'
  ));
  await assignmentDialog.getByRole('button', { name: 'Assign Staff', exact: true }).click();
  const assignmentResponse = await assignmentResponsePromise;
  expect(assignmentResponse.status()).toBeLessThan(300);
  expect(assignmentResponse.request().postDataJSON().assigned_to_user_id).toBe(assignee.user_id);

  await page.getByRole('tab', { name: 'Assigned', exact: true }).click();
  const assignedCard = page.locator('.group.relative').filter({ hasText: patientName }).first();
  await expect(assignedCard).toBeVisible();
  await assignedCard.getByRole('button', { name: 'Assess', exact: true }).click();
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
    .locator('.group.relative')
    .filter({ hasText: patientName })
    .first();
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Assessment completed/ })).toBeVisible();
  await expect(triagedCard).toBeVisible();
  await expect(triagedCard.getByRole('button', { name: /Assess|Assign staff|Reassign staff|Cancel/, exact: true })).toHaveCount(0);

  await expectMobileViewportFits(page);
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
  await expect(page).toHaveURL((url) => (
    url.pathname === `/patients/${patientId}/chronicle`
      && url.searchParams.get('visit') === encounterId
  ));
  await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible();
  await expect(page.getByText(/Hypertension|Diabetes|Lisinopril|Metformin/, { exact: true })).toHaveCount(0);

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

  await expectMobileViewportFits(page);
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
  await expect(page.getByRole('region', { name: 'Report controls' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Report' })).toBeVisible();

  await expectMobileViewportFits(page);
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
    return url.pathname.endsWith('/api/v2/wards/board/search')
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.patient_id === patientId
      && response.request().postDataJSON()?.ward_id === wardId;
  });

  await page.goto(`/wards/${wardId}/board?patient=${patientId}`);

  const boardResponse = await boardResponsePromise;
  expect(boardResponse.status()).toBeLessThan(300);
  await expect(page.getByRole('heading', { name: wardPayload.data.name, exact: true })).toBeVisible();
  await expect(page.getByText(patientName).first()).toBeVisible();

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 admission and discharge clearances complete the inpatient movement flow through the UI', async ({ page }) => {
  test.setTimeout(120_000);
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

  const encounter = await postV2FromBrowser(page, '/api/v2/encounters', {
    patient_id: patientId,
    encounter_type: 'outpatient',
  });
  expect(encounter.data.id).toBeTruthy();
  const summaryTemplateTitle = `AAA Synthetic discharge summary ${Date.now()}`;
  await postV2FromBrowser(page, '/api/v2/clinical/note-templates', {
    title: summaryTemplateTitle,
    note_type: 'doctor_note',
    body_template: JSON.stringify([{ name: 'Summary', type: 'text', required: true, placeholder: 'Enter synthetic discharge summary' }]),
  });

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
    encounter_id: encounter.data.id,
  });
  const admissionCaseId = admissionCasePayload?.data?.id;
  expect(admissionCaseId).toBeTruthy();

  const initialQueueResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v2/admissions/cases'
      && response.request().method() === 'GET'
      && !url.searchParams.get('cursor');
  });
  await page.goto('/admissions/requests');
  await expect(page.getByRole('heading', { name: 'Admission Requests' })).toBeVisible();
  const initialQueueResponse = await initialQueueResponsePromise;
  expect(initialQueueResponse.ok()).toBe(true);
  let queuePage = await initialQueueResponse.json();
  for (let pageNumber = 1; !v2DataList(queuePage).some((item) => item.id === admissionCaseId) && pageNumber < 10; pageNumber += 1) {
    const cursor = queuePage.page?.next_cursor;
    expect(queuePage.page?.has_next).toBe(true);
    expect(cursor).toBeTruthy();
    const nextQueueResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/v2/admissions/cases'
        && response.request().method() === 'GET'
        && url.searchParams.get('cursor') === cursor
        && url.searchParams.get('limit') === '25';
    });
    const pagination = page.getByRole('navigation', { name: 'Admission cases pagination' });
    await pagination.getByRole('button', { name: 'Next page', exact: true }).click();
    const nextQueueResponse = await nextQueueResponsePromise;
    expect(nextQueueResponse.ok()).toBe(true);
    queuePage = await nextQueueResponse.json();
  }
  expect(v2DataList(queuePage).some((item) => item.id === admissionCaseId)).toBe(true);
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

  await page.waitForURL((url) => (
    url.searchParams.get('view') === 'discharge'
      && url.searchParams.get('patient') === patientId
      && url.searchParams.get('case') === dischargeId
  ));
  const dischargePath = `/wards/${wardId}/board?view=discharge&patient=${patientId}&case=${dischargeId}`;
  const clearancePanel = page.getByRole('region', { name: 'Discharge workflow', exact: true });
  await expect(clearancePanel).toBeVisible();
  await expect(clearancePanel.getByRole('button', { name: 'Finalize discharge', exact: true })).toBeDisabled();
  await clearancePanel.getByRole('link', { name: 'Prepare discharge summary', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/chronicle\\?`));
  await page.getByRole('button', { name: new RegExp(escapeRegExp(summaryTemplateTitle)) }).click();
  const summaryText = 'Patient clinically stable. Medication plan and follow-up reviewed before discharge.';
  await page.getByPlaceholder('Enter synthetic discharge summary').fill(summaryText);
  const createSummaryResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v2/patients/${patientId}/clinical/notes`
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Complete Note', exact: true }).click();
  const createSummaryResponse = await createSummaryResponsePromise;
  expect(createSummaryResponse.ok()).toBe(true);
  expect(createSummaryResponse.request().postDataJSON()).toMatchObject({
    note_type: 'doctor_note', title: 'Discharge Summary', encounter_id: encounter.data.id,
  });
  const summary = (await createSummaryResponse.json()).data;
  expect(summary.status).toBe('draft');
  await page.goto(dischargePath);
  await expect(clearancePanel).toBeVisible();
  await expect(clearancePanel.getByRole('button', { name: 'Finalize discharge', exact: true })).toBeDisabled();
  await clearancePanel.getByRole('button', { name: 'Review discharge summary', exact: true }).click();
  await clearancePanel.getByRole('button', { name: /^Review summary version 1 \(draft\)$/ }).click();
  await expect(clearancePanel.getByLabel('Discharge summary content', { exact: true })).toContainText(summaryText);
  const saveReviewedVersion = clearancePanel.getByRole('button', { name: 'Save reviewed version', exact: true });
  await expect(saveReviewedVersion).toBeDisabled();
  await clearancePanel.getByRole('checkbox', { name: 'I have reviewed this summary for this inpatient stay.', exact: true }).check();
  const reviewedSummaryResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v2/clinical/notes/${summary.id}/versions`
      && response.request().method() === 'POST'
  ));
  await saveReviewedVersion.click();
  const reviewedSummaryResponse = await reviewedSummaryResponsePromise;
  expect(reviewedSummaryResponse.ok()).toBe(true);
  expect(reviewedSummaryResponse.request().postDataJSON().body).toContain(summaryText);
  expect((await reviewedSummaryResponse.json()).data.version).toBe(2);

  await page.goto(dischargePath);
  await expect(clearancePanel).toBeVisible();
  await expect(clearancePanel.getByRole('button', { name: 'Finalize discharge', exact: true })).toBeDisabled();
  await clearancePanel.getByLabel('Patient education', { exact: true }).fill('Medication instructions and red flags reviewed with the synthetic patient.');
  await clearancePanel.getByLabel('Discharge instructions', { exact: true }).fill('Return immediately if symptoms worsen and attend the scheduled follow-up.');
  const releaseResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v2/discharges/${dischargeId}/nursing-release`
      && response.request().method() === 'POST'
  ));
  await clearancePanel.getByRole('button', { name: 'Record nursing release', exact: true }).click();
  const releaseResponse = await releaseResponsePromise;
  expect(releaseResponse.ok()).toBe(true);
  expect(releaseResponse.request().postDataJSON()).toMatchObject({
    education: 'Medication instructions and red flags reviewed with the synthetic patient.',
    instructions: 'Return immediately if symptoms worsen and attend the scheduled follow-up.',
  });
  await expect(clearancePanel.getByRole('button', { name: 'Finalize discharge', exact: true })).toBeEnabled();
  await clearancePanel.getByRole('button', { name: 'Finalize discharge', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Finalize this discharge?' });
  await expect(confirmation).toContainText('releases the occupied bed for cleaning');
  const finalizeResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v2/discharges/${dischargeId}/complete`
      && response.request().method() === 'POST'
  ));
  await confirmation.getByRole('button', { name: 'Confirm discharge', exact: true }).click();
  const finalizeResponse = await finalizeResponsePromise;
  expect(finalizeResponse.ok()).toBe(true);
  expect((await finalizeResponse.json()).data.status).toBe('completed');
  const closedAdmission = await getV2FromBrowser(page, `/api/v2/admissions/cases/${admissionCaseId}`);
  expect(closedAdmission.data.status).toBe('discharged');
  const beds = v2DataList(await getV2FromBrowser(page, `/api/v2/wards/${wardId}/beds`));
  expect(beds.find((bed) => bed.id === bedPayload.data.id)?.status).toBe('cleaning');

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 Ward Board completes nursing tasks and the handoff API records completion', async ({ page }) => {
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
    due_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    assigned_to_user_id: null,
  });
  const taskId = taskPayload?.data?.id;
  expect(taskId).toBeTruthy();

  await page.goto(`/wards/${wardId}/board?view=my-work&patient=${patientId}`);
  await expect(page.getByRole('heading', { name: wardPayload.data.name, exact: true })).toBeVisible();
  const patientRow = page.getByRole('row', { name: `Open ward-board details for ${patientName}` });
  await expect(patientRow).toBeVisible();
  await patientRow.click();
  const patientPanel = page.getByRole('dialog', { name: patientName, exact: true });
  await expect(patientPanel).toBeVisible();
  const taskRow = patientPanel.getByRole('row').filter({ hasText: /observation/i });
  await expect(taskRow).toContainText('pending');

  const completeTaskResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v2/nursing/tasks/${taskId}/complete`
      && response.request().method() === 'POST'
  ));
  await taskRow.getByRole('button', { name: 'Complete', exact: true }).click();
  const completeTaskResponse = await completeTaskResponsePromise;
  expect(completeTaskResponse.ok()).toBe(true);
  expect((await completeTaskResponse.json()).data.status).toBe('completed');

  // Structured handoff authoring has no active standalone UI. Preserve its
  // server boundary checks without navigating the removed legacy page.
  const staff = v2DataList(await getV2FromBrowser(page, '/api/v2/admin/staff?limit=100'));
  const receivingNurse = staff.find((member) => member.is_active && /nurse/i.test(member.position));
  expect(receivingNurse?.user_id).toBeTruthy();
  const handoff = await postV2FromBrowser(page, '/api/v2/nursing/handoffs', {
    ward_id: wardId,
    to_user_id: receivingNurse.user_id,
    shift_label: `Synthetic browser handoff ${suffix}`,
  });
  expect(handoff.data.status).toBe('draft');
  const completedHandoff = await postV2FromBrowser(page, `/api/v2/nursing/handoffs/${handoff.data.id}/complete`, {});
  expect(completedHandoff.data.status).toBe('completed');
  expect(completedHandoff.data.to_user_id).toBe(receivingNurse.user_id);

  await expectMobileViewportFits(page);
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

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'SOAP', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review Template', exact: true })).toBeVisible();

  const createTemplateResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/clinical/note-templates') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Create Template' }).click();

  const createTemplateResponse = await createTemplateResponsePromise;
  expect(createTemplateResponse.status()).toBeLessThan(300);
  const createTemplatePayload = await createTemplateResponse.json();
  expect(createTemplatePayload?.data?.title).toBe(templateTitle);
  expect(createTemplatePayload?.data?.note_type).toBe('doctor_note');

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
  expect(noteRequestBody.note_type).toBe('doctor_note');
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

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 patient Chronicle grants and ends audited emergency access through the UI', async ({ page }) => {
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

  const patientName = uniquePatientName('Chronicle');
  const patientPayload = await postV2FromBrowser(page, '/api/v2/patients', {
    first_name: 'Playwright',
    last_name: patientName.replace('Playwright ', ''),
    date_of_birth: '1989-08-18',
    sex: 'female',
  });
  const patientId = patientPayload?.data?.id;
  expect(patientId).toBeTruthy();

  await page.goto(`/patients/${patientId}/chronicle`);
  await expect(page.getByRole('heading', { name: 'Team-based access required' })).toBeVisible();
  await expect(page.getByText(/This patient record is protected by team-based access controls/)).toBeVisible();
  await expect(page.getByPlaceholder('Search notes, prescriptions...')).toHaveCount(0);

  let grantRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/v2/patients/${patientId}/break-glass`) {
      grantRequests += 1;
    }
  });
  await page.getByRole('button', { name: 'Request Break-Glass Access', exact: true }).click();
  const accessDialog = page.getByRole('dialog', { name: 'Temporary clinical access required' });
  await expect(accessDialog.getByRole('button', { name: 'Grant Access', exact: true })).toBeDisabled();
  await accessDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(accessDialog).toBeHidden();
  expect(grantRequests).toBe(0);
  await page.getByRole('button', { name: 'Request Break-Glass Access', exact: true }).click();
  const reason = 'Synthetic urgent clinical continuity review for browser verification.';
  await accessDialog.getByLabel('Reason for access', { exact: true }).fill(reason);
  await accessDialog.getByRole('checkbox', { name: 'I confirm this access is required for urgent clinical care and will be audited.' }).check();
  const grantResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v2/patients/${patientId}/break-glass`
      && response.request().method() === 'POST'
  ));
  await accessDialog.getByRole('button', { name: 'Grant Access', exact: true }).click();
  const grantResponse = await grantResponsePromise;
  expect(grantResponse.ok()).toBe(true);
  expect(grantRequests).toBe(1);
  expect(grantResponse.request().postDataJSON()).toEqual({ category: 'urgent_clinical_continuity', reason_text: reason });
  const grant = (await grantResponse.json()).data;
  expect(grant.patient_id).toBe(patientId);
  expect(Date.parse(grant.expires_at)).toBeGreaterThan(Date.now());
  await expect(page.getByRole('heading', { name: patientName })).toBeVisible();

  // Access remains server-authoritative across a full browser restore.
  await page.reload();
  await expect(page.getByRole('heading', { name: patientName })).toBeVisible();

  const endResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v2/patients/${patientId}/break-glass/end`
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'End emergency access', exact: true }).click();
  const endResponse = await endResponsePromise;
  expect(endResponse.ok()).toBe(true);
  expect((await endResponse.json()).data.ended_count).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('heading', { name: 'Team-based access required' })).toBeVisible();
  await expect(page.getByPlaceholder('Search notes, prescriptions...')).toHaveCount(0);

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 laboratory catalog order result workflow uses real specimen ids', async ({ page }) => {
  test.setTimeout(90_000);
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

  const catalogPayload = await getV2FromBrowser(page, '/api/v2/laboratory/test-catalog');
  const labTest = catalogPayload?.data?.find((item) => item.code === 'FBC') || catalogPayload?.data?.[0];
  expect(labTest?.id).toBeTruthy();
  expect(labTest?.name).toBeTruthy();

  await page.goto('/laboratory/catalog');
  await expect(page.getByRole('heading', { name: 'Lab Catalog' })).toBeVisible();
  await expect(page.getByText(labTest.name).first()).toBeVisible();

  const patientName = uniquePatientName('Lab');
  const patientId = await createSmokePatient(page, {
    firstName: 'Playwright',
    lastName: patientName.replace('Playwright ', ''),
  });
  expect(patientId).toBeTruthy();

  await startClinicalFixture(page, patientId);
  await page.goto(`/patients/${patientId}/chronicle`);
  await expect(page.getByRole('heading', { name: patientName })).toBeVisible();
  await page.getByRole('button', { name: 'Order Labs' }).first().click();
  await expect(page.getByRole('heading', { name: 'Order Labs' })).toBeVisible();
  await page.getByLabel('Search tests and panels').fill(labTest.name);
  const labCheckbox = page.getByRole('checkbox', { name: new RegExp(labTest.name, 'i') }).first();
  await labCheckbox.focus();
  await labCheckbox.press('Space');
  await expect(labCheckbox).toBeChecked();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel(/Clinical Indication/i).fill('Playwright Rust V2 laboratory smoke order');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  const createOrderResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/laboratory/orders') &&
    response.request().method() === 'POST'
  ));
  const submitOrderResponsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/v2/laboratory/orders/') &&
    response.url().endsWith('/submit') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: 'Submit Order' }).click();

  const createOrderResponse = await createOrderResponsePromise;
  expect(createOrderResponse.status()).toBeLessThan(300);
  const createOrderPayload = await createOrderResponse.json();
  const orderId = createOrderPayload?.data?.id;
  const orderNumber = createOrderPayload?.data?.order_number || orderId.slice(0, 8).toUpperCase();
  expect(orderId).toBeTruthy();
  expect(createOrderResponse.request().postDataJSON()).toEqual(expect.objectContaining({
    patient_id: patientId,
    test_ids: [labTest.id],
    priority: 'routine',
  }));

  const submitOrderResponse = await submitOrderResponsePromise;
  expect(submitOrderResponse.status()).toBeLessThan(300);

  await page.goto('/laboratory/orders');
  await expect(page.getByRole('heading', { name: 'Lab Orders' })).toBeVisible();
  await expect(page.getByText(orderNumber).first()).toBeVisible();

  await page.goto('/laboratory/dashboard');
  await expect(page.getByRole('heading', { name: 'Laboratory Worklist' })).toBeVisible();
  const orderedArticle = page.locator('article').filter({ hasText: orderNumber }).first();
  await expect(orderedArticle).toBeVisible();
  await orderedArticle.getByRole('button', { name: 'Collect Specimen' }).click();
  await expect(page.getByRole('heading', { name: 'Collect Specimen' })).toBeVisible();
  await page.getByRole('combobox').filter({ hasText: /Select specimen type/i }).click();
  await page.getByRole('option', { name: 'Blood' }).click();
  await page.getByRole('combobox').filter({ hasText: /Select container type/i }).click();
  await page.getByRole('option', { name: /Red Top/i }).click();

  const createSpecimenResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/laboratory/specimens') &&
    response.request().method() === 'POST'
  ));
  const collectOrderResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/laboratory/orders/${orderId}/collect`) &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('dialog').getByRole('button', { name: 'Collect Specimen' }).click();

  const createSpecimenResponse = await createSpecimenResponsePromise;
  expect(createSpecimenResponse.status()).toBeLessThan(300);
  const createSpecimenPayload = await createSpecimenResponse.json();
  const specimenId = createSpecimenPayload?.data?.id;
  expect(specimenId).toBeTruthy();
  expect(createSpecimenResponse.request().postDataJSON()).toEqual(expect.objectContaining({
    order_id: orderId,
    specimen_type: 'blood',
  }));

  const collectOrderResponse = await collectOrderResponsePromise;
  expect(collectOrderResponse.status()).toBeLessThan(300);
  const collectOrderPayload = await collectOrderResponse.json();
  expect(collectOrderPayload?.data?.specimens?.[0]?.id).toBe(specimenId);

  await page.getByRole('tab', { name: /Collected/ }).click();
  const collectedArticle = page.locator('article').filter({ hasText: orderNumber }).first();
  await expect(collectedArticle).toBeVisible();

  const startProcessingResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/laboratory/orders/${orderId}/start-processing`) &&
    response.request().method() === 'POST'
  ));

  await collectedArticle.getByRole('button', { name: 'Start Processing' }).click();
  await expect(page.getByRole('heading', { name: 'Start Processing' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Start Processing' }).click();

  const startProcessingResponse = await startProcessingResponsePromise;
  expect(startProcessingResponse.status()).toBeLessThan(300);
  const startProcessingPayload = await startProcessingResponse.json();
  expect(startProcessingPayload?.data?.specimens?.[0]?.id).toBe(specimenId);

  await page.getByRole('tab', { name: /^Processing/ }).click();
  const processingArticle = page.locator('article').filter({ hasText: orderNumber }).first();
  await expect(processingArticle).toBeVisible();
  await processingArticle.getByRole('button', { name: 'Enter Results' }).click();
  await expect(page.getByRole('heading', { name: 'Enter Lab Results' })).toBeVisible();
  await page.getByLabel(new RegExp(`Result value for ${labTest.name}`, 'i')).fill('12.4');

  const bulkCreateResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/laboratory/results/bulk') &&
    response.request().method() === 'POST'
  ));

  await page.getByRole('button', { name: /Save 1 Result/i }).click();

  const bulkCreateResponse = await bulkCreateResponsePromise;
  expect(bulkCreateResponse.status()).toBeLessThan(300);
  expect(bulkCreateResponse.request().postDataJSON()).toEqual(expect.objectContaining({
    order_id: orderId,
    specimen_id: specimenId,
  }));

  await page.goto('/laboratory/results');
  await expect(page.getByRole('heading', { name: 'Lab Results' })).toBeVisible();
  await expect(page.getByText(orderNumber).first()).toBeVisible();

  await page.goto('/laboratory/dashboard');
  await page.getByRole('tab', { name: /Pending Verification/ }).click();
  const verificationArticle = page.locator('article').filter({ hasText: orderNumber }).first();
  await expect(verificationArticle).toBeVisible();

  const bulkVerifyResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/laboratory/results/bulk-verify') &&
    response.request().method() === 'POST'
  ));

  await verificationArticle.getByRole('button', { name: 'Verify All' }).click();

  const bulkVerifyResponse = await bulkVerifyResponsePromise;
  expect(bulkVerifyResponse.status()).toBeLessThan(300);
  expect(bulkVerifyResponse.request().postDataJSON()).toEqual(expect.objectContaining({
    order_id: orderId,
  }));

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});

test('Rust V2 inventory stock procurement and controlled workflows use generated endpoints', async ({ page }) => {
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

  const itemsPayload = await getV2FromBrowser(page, '/api/v2/inventory/items?limit=100');
  const locationsPayload = await getV2FromBrowser(page, '/api/v2/inventory/storage-locations?limit=100');
  const suppliersPayload = await getV2FromBrowser(page, '/api/v2/inventory/suppliers?limit=100');

  const inventoryItems = v2DataList(itemsPayload);
  const locations = v2DataList(locationsPayload);
  const suppliers = v2DataList(suppliersPayload);
  const stockItem = inventoryItems.find((item) => !item.controlled && /paracetamol/i.test(item.name))
    || inventoryItems.find((item) => !item.controlled);
  const controlledItem = inventoryItems.find((item) => item.controlled && /morphine/i.test(item.name))
    || inventoryItems.find((item) => item.controlled);
  const receivingLocation = locations.find((location) => /pharmacy|dispensary/i.test(location.name))
    || locations[0];
  const supplier = suppliers.find((entry) => /acme/i.test(entry.name)) || suppliers[0];

  expect(stockItem?.id).toBeTruthy();
  expect(controlledItem?.id).toBeTruthy();
  expect(receivingLocation?.id).toBeTruthy();
  expect(supplier?.id).toBeTruthy();

  const suffix = Date.now().toString(36).toUpperCase();
  const batchNumber = `PW-${suffix}`;
  const stockBatchPayload = await postV2FromBrowser(page, '/api/v2/inventory/stock-batches', {
    item_id: stockItem.id,
    location_id: receivingLocation.id,
    batch_number: batchNumber,
    expires_on: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    quantity_received: 17,
  });
  expect(stockBatchPayload?.data).toMatchObject({
    batch_number: batchNumber,
    quantity_on_hand: 17,
  });
  const itemStockPayload = await getV2FromBrowser(page, `/api/v2/inventory/items/${stockItem.id}/stock-by-location`);
  const expectedLocationStock = v2DataList(itemStockPayload)
    .find((row) => row.location_id === receivingLocation.id)
    ?.quantity_on_hand;
  expect(expectedLocationStock).toBeGreaterThanOrEqual(17);

  await page.goto(`/inventory/items/${stockItem.id}?tab=batches`);
  await expect(page.getByRole('heading', { name: new RegExp(escapeRegExp(stockItem.name), 'i') })).toBeVisible();
  const batchRow = page.getByRole('row').filter({ hasText: batchNumber }).first();
  await expect(batchRow).toBeVisible();
  await expect(batchRow).toContainText('17');

  await page.getByRole('tab', { name: 'Stock by Location' }).click();
  const locationRow = page.getByRole('row').filter({ hasText: receivingLocation.name }).first();
  await expect(locationRow).toBeVisible();
  await expect(locationRow).toContainText(String(expectedLocationStock));

  await page.getByRole('tab', { name: 'Movements' }).click();
  await expect(page.getByText('Receipt').first()).toBeVisible();
  await expect(page.getByText('+17').first()).toBeVisible();

  await page.goto('/inventory/purchase-orders');
  await expect(page.getByRole('heading', { name: 'Purchase Orders', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New PO' }).first().click();
  const poDialog = page.getByRole('dialog', { name: /New Purchase Order/i });
  await expect(poDialog).toBeVisible();
  await selectByVisibleText(
    page,
    poDialog.getByRole('combobox').filter({ hasText: /Select supplier/i }),
    supplier.name,
  );
  await selectByVisibleText(
    page,
    poDialog.getByRole('combobox').filter({ hasText: /Select item/i }),
    stockItem.name,
  );
  await poDialog.getByPlaceholder('Qty').fill('3');
  await poDialog.getByPlaceholder('Price').fill('1.50');

  const createPoResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/inventory/purchase-orders') &&
    response.request().method() === 'POST'
  ));

  await poDialog.getByRole('button', { name: 'Create PO' }).click();

  const createPoResponse = await createPoResponsePromise;
  expect(createPoResponse.status()).toBeLessThan(300);
  expect(createPoResponse.request().postDataJSON()).toEqual({
    supplier_name: supplier.name,
  });
  const poPayload = await createPoResponse.json();
  const purchaseOrderId = poPayload?.data?.id;
  expect(purchaseOrderId).toBeTruthy();

  await page.goto(`/inventory/purchase-orders/${purchaseOrderId}`);
  await expect(page.getByText(supplier.name).first()).toBeVisible();

  const approvePoResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/inventory/purchase-orders/${purchaseOrderId}/approve`) &&
    response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Approve' }).click();
  const approvePoResponse = await approvePoResponsePromise;
  expect(approvePoResponse.status()).toBeLessThan(300);
  await expect(page.getByText(/^Approved$/i).first()).toBeVisible();

  await page.getByRole('button', { name: 'Send to Supplier' }).click();
  const sendDialog = page.getByRole('dialog', { name: 'Send to Supplier' });
  await expect(sendDialog).toBeVisible();
  const sendPoResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/inventory/purchase-orders/${purchaseOrderId}/send`) &&
    response.request().method() === 'POST'
  ));
  await sendDialog.getByRole('button', { name: 'Send to Supplier' }).click();
  const sendPoResponse = await sendPoResponsePromise;
  expect(sendPoResponse.status()).toBeLessThan(300);
  await expect(page.getByText(/^Sent to Supplier$/i).first()).toBeVisible();

  await page.goto(`/inventory/grns?action=create&po=${purchaseOrderId}`);
  const grnDialog = page.getByRole('dialog', { name: /New Goods Received Note/i });
  await expect(grnDialog).toBeVisible();
  await selectByVisibleText(
    page,
    grnDialog.getByRole('combobox').filter({ hasText: /Select location/i }),
    receivingLocation.name,
  );
  await selectByVisibleText(
    page,
    grnDialog.getByRole('combobox').filter({ hasText: /Select item/i }),
    stockItem.name,
  );
  await grnDialog.getByPlaceholder('Qty').fill('3');
  await grnDialog.getByPlaceholder('Batch #').fill(`GRN-${suffix}`);

  const createGrnResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/v2/inventory/goods-received-notes') &&
    response.request().method() === 'POST'
  ));

  await grnDialog.getByRole('button', { name: 'Create GRN' }).click();

  const createGrnResponse = await createGrnResponsePromise;
  expect(createGrnResponse.status()).toBeLessThan(300);
  expect(createGrnResponse.request().postDataJSON()).toEqual({
    purchase_order_id: purchaseOrderId,
  });
  const grnPayload = await createGrnResponse.json();
  const grnId = grnPayload?.data?.id;
  expect(grnId).toBeTruthy();

  await page.goto(`/inventory/grns/${grnId}`);
  await expect(page.getByText(supplier.name).first()).toBeVisible();

  const inspectGrnResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/inventory/goods-received-notes/${grnId}/inspect`) &&
    response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Start Inspection' }).click();
  const inspectGrnResponse = await inspectGrnResponsePromise;
  expect(inspectGrnResponse.status()).toBeLessThan(300);
  await expect(page.getByText(/^Inspecting$/i).first()).toBeVisible();

  await page.getByRole('button', { name: 'Accept & Update Stock' }).click();
  const acceptDialog = page.getByRole('dialog', { name: 'Accept GRN & Update Stock' });
  await expect(acceptDialog).toBeVisible();
  const acceptGrnResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/v2/inventory/goods-received-notes/${grnId}/accept`) &&
    response.request().method() === 'POST'
  ));
  await acceptDialog.getByRole('button', { name: 'Accept & Update Stock' }).click();
  const acceptGrnResponse = await acceptGrnResponsePromise;
  expect(acceptGrnResponse.status()).toBeLessThan(300);
  await expect(page.getByText(/^Accepted$/i).first()).toBeVisible();

  const controlledReceiptAttempt = await postV2FromBrowserRaw(page, '/api/v2/pharmacy/controlled-substances/register', {
    item_id: controlledItem.id,
    location_id: receivingLocation.id,
    movement_type: 'receipt',
    quantity_delta: 20,
    witness_user_id: null,
  });
  expect(controlledReceiptAttempt.status).toBe(403);
  expect(controlledReceiptAttempt.payload?.error?.code).toBe('passkey_required');

  await page.goto('/inventory/controlled');
  await expect(page.getByRole('heading', { name: 'Controlled Substances' })).toBeVisible();
  await expect(page.getByText(/Passkey|Controlled substances/i).first()).toBeVisible();

  await expectMobileViewportFits(page);
  expect(failures).toEqual([]);
});
