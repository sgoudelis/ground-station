/**
 * Explicit authentication flow tests for logout/login behavior.
 */

import { test, expect } from '@playwright/test';
import { E2E_ADMIN_PASSWORD } from './auth-constants.js';
import { completeLocationWizardIfVisible } from './location-helpers.js';

const getUsernameFromUserMenuButton = async (page) => {
  const userMenuButton = page.getByRole('button', { name: /open user menu for/i });
  await expect(userMenuButton).toBeVisible({ timeout: 15000 });

  const ariaLabel = String((await userMenuButton.getAttribute('aria-label')) || '');
  const username = ariaLabel.replace(/^\s*open user menu for\s*/i, '').trim();
  expect(username).not.toBe('');
  return username;
};

const detectAuthSurface = async (page, timeoutMs = 20000) => {
  const setupDialog = page.getByRole('dialog').filter({ hasText: /ground station setup/i }).first();
  const signInHeading = page.getByRole('heading', { name: /^sign in$/i });
  const main = page.getByRole('main');

  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    if (await setupDialog.isVisible().catch(() => false)) return 'setup';
    if (await signInHeading.isVisible().catch(() => false)) return 'signin';
    if (await main.isVisible().catch(() => false)) return 'main';
    await page.waitForTimeout(200);
  }
  return 'unknown';
};

const ensureAuthenticatedState = async (page) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const surface = await detectAuthSurface(page, 20000);
  if (surface === 'setup') {
    const bootstrapUsername = `auth-e2e-${Date.now()}`;
    const completed = await completeLocationWizardIfVisible(page, {
      waitForMs: 10000,
      adminUsername: bootstrapUsername,
      adminPassword: E2E_ADMIN_PASSWORD,
      completeSetup: true,
    });
    expect(completed).toBe(true);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('main')).toBeVisible({ timeout: 30000 });
    return bootstrapUsername;
  }

  if (surface === 'signin') {
    throw new Error(
      'Auth test requires either an authenticated storage state or a fresh setup wizard flow.',
    );
  }

  if (surface !== 'main') {
    throw new Error('Unable to determine current authentication surface (setup/login/main).');
  }

  await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 });
  return getUsernameFromUserMenuButton(page);
};

const logoutFromUserMenu = async (page) => {
  const userMenuButton = page.getByRole('button', { name: /open user menu/i });
  await expect(userMenuButton).toBeVisible({ timeout: 15000 });
  await userMenuButton.click();

  const logoutItem = page.getByRole('menuitem', { name: /^logout$/i });
  await expect(logoutItem).toBeVisible({ timeout: 10000 });
  await logoutItem.click();

  const logoutConfirmDialog = page.getByRole('dialog', { name: /confirm logout/i });
  const confirmVisible = await logoutConfirmDialog.isVisible().catch(() => false);
  if (confirmVisible) {
    await logoutConfirmDialog.getByRole('button', { name: /^logout$/i }).click();
  }
};

test.describe('Authentication', () => {
  test('should log out and then log back in via the Sign In form', async ({ page }) => {
    const username = await ensureAuthenticatedState(page);

    await logoutFromUserMenu(page);

    await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel(/^username\b/i)).toBeVisible();
    await expect(page.getByLabel(/^password\b/i)).toBeVisible();

    await page.getByLabel(/^username\b/i).fill(username);
    await page.getByLabel(/^password\b/i).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: /^sign in$/i })).toHaveCount(0);
  });
});
