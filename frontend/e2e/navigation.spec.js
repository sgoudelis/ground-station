/**
 * E2E tests for navigation functionality
 */

import { test, expect } from '@playwright/test';

test.describe('Navigation State', () => {
  test('groups System pages and keeps maintenance navigation in sync', async ({ page }) => {
    await page.goto('/admin/system/general');
    await expect(page.getByRole('tab', { name: 'General', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /toggle drawer/i }).click();
    const sidebar = page.getByRole('navigation', { name: 'Desktop navigation', exact: true });
    await expect(sidebar.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await sidebar.getByRole('button', { name: 'Feedback', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/system\/feedback$/);
    await expect(page.getByRole('tab', { name: 'Feedback', exact: true })).toHaveAttribute('aria-selected', 'true');

    await sidebar.getByRole('button', { name: 'Maintenance', exact: true }).click();
    await sidebar.getByRole('button', { name: 'Sessions', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/system\/maintenance\/sessions$/);
    await expect(page.getByRole('tab', { name: 'Sessions', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/system\/maintenance\/diagnostics$/);
    await expect(sidebar.getByRole('button', { name: 'Diagnostics', exact: true })).toHaveClass(/Mui-selected/);
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'Sessions', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Sessions', exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: /toggle drawer/i }).click();
    await sidebar.getByRole('button', { name: 'About', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/system\/about$/);
    await expect(page.getByRole('tablist')).toHaveCount(0);
  });

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
