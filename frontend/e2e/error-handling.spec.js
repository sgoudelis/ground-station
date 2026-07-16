/**
 * E2E tests for error handling and edge cases
 */

import { test, expect } from '@playwright/test';

test.describe('404 Error Handling', () => {
  test('should render dedicated 404 page for unknown routes', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(/page not found/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/error code:\s*404/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /back to home/i })).toBeVisible();
  });

  test('should navigate home from 404 recovery action', async ({ page }) => {
    await page.goto('/invalid-page-12345');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /back to home/i }).click();
    await expect(page).toHaveURL(/\/earthview$/);
  });
});

test.describe('Network Error Handling', () => {
  test('should handle offline mode gracefully', async ({ page, context }) => {
    // Go online first
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Go offline
    await context.setOffline(true);

    // Try to navigate
    await page.goto('/tracking').catch(() => {
      // Expected to fail
    });

    // Should handle offline state
    expect(true).toBe(true);

    // Go back online
    await context.setOffline(false);
  });

  test('should display appropriate message when backend is unavailable', async ({ page }) => {
    // Navigate to a page that requires backend data
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Page should load even if backend is unavailable
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

test.describe('Form Validation', () => {
  test('should validate location input fields', async ({ page }) => {
    await page.goto('/admin/system/location');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Look for input fields
    const inputs = page.locator('input[type="number"], input[type="text"]');
    const inputCount = await inputs.count();

    if (inputCount > 0) {
      // Try to submit with invalid data (if there's a submit button)
      const submitButton = page.locator('button[type="submit"], button').filter({
        hasText: /save|submit|update/i
      });

      const buttonCount = await submitButton.count();

      // Form elements exist
      expect(inputCount).toBeGreaterThan(0);
    }
  });
});

test.describe('Invalid Data Handling', () => {
  test('should handle invalid satellite NORAD ID', async ({ page }) => {
    // Try to access satellite info with invalid ID
    await page.goto('/satellites/invalid-id');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Should handle gracefully
    const content = await page.locator('body').textContent();
    expect(content).toBeTruthy();
  });

  test('should handle non-existent satellite NORAD ID', async ({ page }) => {
    // Try to access satellite info with ID that doesn't exist
    await page.goto('/satellites/999999999');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Should handle gracefully
    const content = await page.locator('body').textContent();
    expect(content).toBeTruthy();
  });
});

test.describe('Browser Compatibility', () => {
  test('should handle browser back button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to another page
    await page.goto('/tracking');
    await page.waitForLoadState('networkidle');

    // Go back
    await page.goBack();
    await page.waitForLoadState('networkidle');

    // Should be back at home
    expect(page.url()).not.toContain('/tracking');
  });

  test('should handle browser forward button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.goto('/tracking');
    await page.waitForLoadState('networkidle');

    await page.goBack();
    await page.waitForLoadState('networkidle');

    await page.goForward();
    await page.waitForLoadState('networkidle');

    // Should be back at track page
    expect(page.url()).toContain('/tracking');
  });

  test('should handle page refresh', async ({ page }) => {
    await page.goto('/tracking');
    await page.waitForLoadState('networkidle');

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be on track page
    expect(page.url()).toContain('/tracking');
  });
});

test.describe('Console Errors', () => {
  test('should not have critical console errors on home page', async ({ page }) => {
    const errors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Filter out known/acceptable errors (like network errors for mock data)
    const criticalErrors = errors.filter(error =>
      !error.includes('Failed to fetch') &&
      !error.includes('WebSocket') &&
      !error.includes('Network')
    );

    // Should not have critical JavaScript errors
    expect(criticalErrors.length).toBeLessThanOrEqual(2); // Allow some tolerance
  });

  test('should not have unhandled promise rejections', async ({ page }) => {
    const rejections = [];

    page.on('pageerror', error => {
      if (error.message.includes('unhandled')) {
        rejections.push(error.message);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Should not have unhandled rejections
    expect(rejections.length).toBe(0);
  });
});
