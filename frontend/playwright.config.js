/**
 * Playwright E2E test configuration.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  // Directory containing test files
  testDir: './tests/e2e',

  // Test file patterns
  testMatch: '**/*.spec.js',

  // Maximum time one test can run
  timeout: 30 * 1000,

  // Maximum time for expect() assertions
  expect: {
    timeout: 5000,
  },

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Limit parallel workers on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ...(process.env.CI ? [['github']] : []),
  ],

  // Shared settings for all projects
  use: {
    // Base URL for actions like `await page.goto('/')`
    baseURL: 'http://localhost:5173',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording
    video: 'on-first-retry',

    // Viewport size
    viewport: { width: 1280, height: 720 },

    // Browser options
    headless: true,

    // Slow down actions for debugging (set to 0 for normal speed)
    // slowMo: 100,

    // Navigation timeout
    navigationTimeout: 30000,

    // Action timeout
    actionTimeout: 15000,
  },

  // Configure projects for major browsers
  projects: [
    // Desktop Chrome
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },

    // Desktop Firefox (uncomment if needed)
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //   },
    // },

    // Desktop Safari (uncomment if needed)
    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //   },
    // },

    // Mobile Chrome (for responsive testing)
    // {
    //   name: 'Mobile Chrome',
    //   use: {
    //     ...devices['Pixel 5'],
    //   },
    // },
  ],

  // Web server to start before tests
  webServer: [
    // Frontend dev server
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    // Uncomment if you need to run backend too
    // {
    //   command: 'cd ../backend && python manage.py runserver',
    //   url: 'http://localhost:8000/api/',
    //   reuseExistingServer: !process.env.CI,
    //   timeout: 120 * 1000,
    // },
  ],

  // Output folder for test artifacts
  outputDir: 'test-results',
})
