import {defineConfig, devices} from '@playwright/test';
import { storageStatePath } from './e2e/auth-state.js';

/**
 * Playwright E2E testing configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './e2e',

    // Maximum time one test can run
    timeout: 60 * 1000,

    // Fail the build on CI if you accidentally left test.only in the source code
    forbidOnly: !!process.env.CI,

    // Retry on CI only
    retries: process.env.CI ? 2 : 0,

    // Parallel tests
    workers: process.env.CI ? 1 : undefined,

    // Reporter configuration
    reporter: [
        ['html'],
        ['json', {outputFile: 'test-results/results.json'}],
        ['list'],
    ],

    // Shared settings for all projects
    use: {
        // Base URL for page.goto('/')
        // Use BASE_URL env var if provided (for CI with Docker), otherwise use dev server
        baseURL: process.env.BASE_URL || 'http://localhost:5173',
        // Collect trace on first retry
        trace: 'on-first-retry',

        // Take screenshot on failure
        screenshot: 'only-on-failure',

        // Record video on failure
        video: 'retain-on-failure',
    },

  // Configure projects for major browsers
  projects: [
    {
      name: 'setup-wizard',
      testMatch: '**/setup-wizard.spec.js',
      workers: 1,
      retries: 0,
      use: {
        ...devices['Desktop Chrome'],
        storageState: undefined,
      },
    },
    {
      name: 'chromium',
      dependencies: ['setup-wizard'],
      testIgnore: ['**/setup-wizard.spec.js', '**/auth.spec.js'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: storageStatePath,
      },
    },
    {
      name: 'auth-flow',
      dependencies: ['chromium'],
      testMatch: '**/auth.spec.js',
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        storageState: storageStatePath,
      },
    },
    // // Mobile viewports
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },
  ],

    // Run dev server before tests (only for local development, not CI)
    webServer: process.env.BASE_URL ? undefined : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
