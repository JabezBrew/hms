import { expect, test } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@hms.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const smokePatientName = process.env.E2E_SMOKE_PATIENT_NAME || 'Smoke Patient';

if (!adminPassword) {
  throw new Error('E2E_ADMIN_PASSWORD is required; no default admin password is provided.');
}

test('admin can sign in, open the patient registry, and load a patient chronicle', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();

  await page.getByLabel('Email Address').fill(adminEmail);
  await page.locator('#password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL((url) => !url.pathname.endsWith('/login'));

  await page.goto('/patients');
  await expect(page.getByRole('heading', { name: 'Patient Registry' })).toBeVisible();
  await page.getByRole('button', { name: 'All Registered' }).click();
  await page.getByRole('textbox', { name: 'Search by name, MRN, or NHIS ID' }).fill(smokePatientName);

  const patientRow = page.getByLabel(new RegExp(`Open\\s+${smokePatientName}\\s+chart`, 'i'));
  await expect(patientRow).toBeVisible();
  await patientRow.click();

  await page.waitForURL(/\/patients\/.+/);
  await expect(page.getByText(smokePatientName, { exact: false })).toBeVisible();
  await expect(page.getByPlaceholder('Search notes, prescriptions...')).toBeVisible();
});
