import { expect, test } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'owner@hms.local';
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

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
  await page.getByRole('combobox').filter({ hasText: /Select department/i }).click();
  await expect(page.getByRole('option', { name: 'Outpatient Department' })).toBeVisible();
  await page.getByRole('option', { name: 'Outpatient Department' }).click();
  await expect(page.getByText(/Registration will continue under the selected department/i)).toBeVisible();

  expect(failures).toEqual([]);
});
