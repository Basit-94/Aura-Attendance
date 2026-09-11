import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 300 * 1000,
  expect: {
    timeout: 60 * 1000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,
    channel: 'chrome',
    viewport: null,
    launchOptions: {
      slowMo: 600,
      args: ['--start-maximized'],
    },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        channel: 'chrome',
        viewport: null,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60 * 1000,
  },
});
