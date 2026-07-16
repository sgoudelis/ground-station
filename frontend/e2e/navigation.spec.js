/**
 * E2E tests for navigation functionality
 */

import { test, expect } from '@playwright/test';

test.describe('Navigation State', () => {
  test('should maintain navigation state after refresh', async ({ page }) => {
    await page.goto('/admin/system/preferences');
    await page.waitForLoadState('networkidle');

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Preferences route is canonicalized to /preferences.
    await expect(page).toHaveURL(/\/preferences$/);
  });
});
