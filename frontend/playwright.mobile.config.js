import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  grep: /triage assigns|Chronicle grants|admission and discharge/,
  projects: [
    {
      name: 'chromium-touch-mobile',
      use: {
        ...base.projects[0].use,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
