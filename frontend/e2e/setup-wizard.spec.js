/**
 * E2E tests for the first-time setup wizard.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { storageStatePath } from './auth-state.js';
import { E2E_ADMIN_PASSWORD } from './auth-constants.js';

const SETUP_COORDINATES = {
  latitude: '37.9838',
  longitude: '23.7275',
};

const getSetupDialog = (page) => page.getByRole('dialog').filter({
  hasText: /ground station setup/i,
}).first();

const openSetupWizard = async (page) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // First-time setup flow only renders when backend reports setup_required=true.
  const authStatusResponse = await page.request.get('/api/auth/status');
  const authStatus = await authStatusResponse.json();
  expect(
    Boolean(authStatus?.setup_required),
    'Setup wizard tests require a fresh backend temp DB (setup_required=true).',
  ).toBe(true);

  const setupDialog = getSetupDialog(page);
  await expect(setupDialog).toBeVisible({ timeout: 20000 });
  await expect(setupDialog.getByRole('heading', { name: /restore existing backup/i })).toBeVisible();
  return setupDialog;
};

const fillCoordinatesInWizard = async (page, setupDialog) => {
  await setupDialog.getByRole('button', { name: /enter coordinates/i }).click();

  const coordinatesDialog = page.getByRole('dialog').filter({
    has: page.getByRole('button', { name: /apply coordinates/i }),
  }).first();
  await expect(coordinatesDialog).toBeVisible();
  await coordinatesDialog.getByLabel(/latitude/i).fill(SETUP_COORDINATES.latitude);
  await coordinatesDialog.getByLabel(/longitude/i).fill(SETUP_COORDINATES.longitude);
  await coordinatesDialog.getByRole('button', { name: /apply coordinates/i }).click();
  await expect(coordinatesDialog).toBeHidden({ timeout: 10000 });
};

const advanceToAdminStep = async (setupDialog) => {
  const nextButton = setupDialog.getByRole('button', { name: /^next$/i });
  await expect(nextButton).toBeEnabled();
  await nextButton.click();
  await expect(setupDialog.getByRole('heading', { name: /create administrator account/i })).toBeVisible();
};

const advanceToReviewStep = async (page, setupDialog, { username, password }) => {
  const nextButton = setupDialog.getByRole('button', { name: /^next$/i });

  await advanceToAdminStep(setupDialog);

  await setupDialog.getByLabel(/^username\b/i).fill(username);
  await setupDialog.getByLabel(/^password\b/i).fill(password);
  await setupDialog.getByLabel(/confirm password/i).fill(password);
  await nextButton.click();

  await expect(setupDialog.getByRole('heading', { name: /^station identity$/i })).toBeVisible();
  await nextButton.click();

  await expect(setupDialog.getByText(/click on the map to set your ground station location/i)).toBeVisible();
  await fillCoordinatesInWizard(page, setupDialog);
  await expect(nextButton).toBeEnabled();
  await nextButton.click();

  await expect(setupDialog.getByRole('heading', { name: /review configuration/i })).toBeVisible();
  await expect(
    setupDialog.getByRole('button', { name: /save and continue|save location/i }),
  ).toBeVisible();
};

test.describe('Setup Wizard', () => {
  test.describe.configure({ mode: 'serial' });

  test('renders expected step progression and admin validation errors', async ({ page }) => {
    const setupDialog = await openSetupWizard(page);

    await expect(setupDialog.getByText(/create admin user/i).first()).toBeVisible();
    await expect(setupDialog.getByText(/^station identity$/i).first()).toBeVisible();
    await expect(setupDialog.getByText(/^location$/i).first()).toBeVisible();
    await expect(setupDialog.getByText(/^review$/i).first()).toBeVisible();
    await expect(setupDialog.getByText(/finalize setup/i).first()).toBeVisible();

    await advanceToAdminStep(setupDialog);

    const nextButton = setupDialog.getByRole('button', { name: /^next$/i });
    await nextButton.click();
    await expect(setupDialog.getByText(/username is required/i)).toBeVisible();

    await setupDialog.getByLabel(/^username\b/i).fill(`wizard-admin-${Date.now()}`);
    await setupDialog.getByLabel(/^password\b/i).fill('short');
    await setupDialog.getByLabel(/confirm password/i).fill('short');
    await nextButton.click();
    await expect(setupDialog.getByText(/password must be at least 8 characters long/i)).toBeVisible();

    await setupDialog.getByLabel(/^password\b/i).fill(E2E_ADMIN_PASSWORD);
    await setupDialog.getByLabel(/confirm password/i).fill('GroundStation#456');
    await nextButton.click();
    await expect(setupDialog.getByText(/passwords do not match/i)).toBeVisible();

    await setupDialog.getByLabel(/confirm password/i).fill(E2E_ADMIN_PASSWORD);
    await nextButton.click();
    await expect(setupDialog.getByRole('heading', { name: /^station identity$/i })).toBeVisible();

    await nextButton.click();
    await expect(setupDialog.getByText(/click on the map to set your ground station location/i)).toBeVisible();

    await fillCoordinatesInWizard(page, setupDialog);
    await expect(nextButton).toBeEnabled();
    await nextButton.click();
    await expect(setupDialog.getByRole('heading', { name: /review configuration/i })).toBeVisible();
  });

  test('finalize state reflects failed admin creation, then enables completion after retry', async ({ page }) => {
    const setupDialog = await openSetupWizard(page);

    const wizardUsername = `wizard-admin-${Date.now()}`;
    const wizardPassword = E2E_ADMIN_PASSWORD;

    await advanceToReviewStep(page, setupDialog, {
      username: wizardUsername,
      password: wizardPassword,
    });

    const setupAdminUrl = '**/api/auth/setup-admin';
    let failNextSetupAdmin = true;
    await page.route(setupAdminUrl, async (route) => {
      // Force one transient failure for the setup-admin call so the checklist
      // can render "Admin user creation" as failed without relying on backend
      // validation internals.
      if (failNextSetupAdmin) {
        failNextSetupAdmin = false;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: 'Injected admin creation failure for E2E retry coverage.',
          }),
        });
        return;
      }
      await route.continue();
    });

    const saveAndContinueButton = setupDialog.getByRole('button', {
      name: /save and continue|save location/i,
    });
    await expect(saveAndContinueButton).toBeEnabled();
    await saveAndContinueButton.click();

    await expect(setupDialog.getByText(/setup checklist/i)).toBeVisible({ timeout: 30000 });
    await expect(setupDialog.getByText(/^background task status$/i)).toBeVisible();
    await expect(setupDialog.getByText(/^orbital data sync$/i)).toBeVisible();
    await expect(setupDialog.getByText(/^soapysdr detection$/i)).toBeVisible();

    await expect(setupDialog).toContainText(/identity and location setup/i);
    await expect(setupDialog).toContainText(/identity and location setup[\s\S]*done/i);
    await expect(setupDialog).toContainText(/administrator account created/i);
    await expect(setupDialog).toContainText(/administrator account created[\s\S]*failed/i);

    const completeSetupButton = setupDialog.getByRole('button', { name: /^complete setup$/i });
    await expect(completeSetupButton).toBeDisabled();

    const backButton = setupDialog.getByRole('button', { name: /^back$/i });
    await backButton.click();
    await expect(setupDialog.getByRole('heading', { name: /review configuration/i })).toBeVisible();

    await saveAndContinueButton.click();

    await expect(setupDialog.getByText(/setup checklist/i)).toBeVisible({ timeout: 30000 });
    await expect(setupDialog).toContainText(/administrator account created/i);
    await expect(setupDialog).toContainText(/administrator account created[\s\S]*done/i);
    await expect(completeSetupButton).toBeEnabled({ timeout: 30000 });

    await completeSetupButton.click();

    const dialogClosed = await setupDialog.waitFor({ state: 'hidden', timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (!dialogClosed) {
      await expect(page.getByRole('main').first()).toBeVisible({ timeout: 30000 });
    }

    // Persist auth for dependent E2E projects in the same Playwright invocation.
    await fs.promises.mkdir(path.dirname(storageStatePath), { recursive: true });
    await page.context().storageState({ path: storageStatePath });
  });
});
