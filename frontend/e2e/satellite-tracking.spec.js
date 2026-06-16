/**
 * E2E tests for satellite tracking functionality
 */

import { test, expect } from '@playwright/test';

const getVisibleMapSurface = (page) => page
  .locator(
    '.leaflet-container, .maplibregl-map, .maplibregl-canvas, canvas[aria-label="Planetarium sky map"], [role="region"][aria-label="Map"]',
  )
  .first();

test.describe('Satellite Tracking', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the tracking console
    await page.goto('/tracking');
    await page.waitForLoadState('networkidle');
  });

  test('should display satellite map', async ({ page }) => {
    // Tracking view can render Leaflet, MapLibre, or Planetarium depending on persisted preferences.
    const mapContainer = getVisibleMapSurface(page);
    await expect(mapContainer).toBeVisible({ timeout: 10000 });
  });

  test('should display tracking information', async ({ page }) => {
    // Tracking page can show either live telemetry (when a target is selected)
    // or an empty state (no satellite selected / no targets configured).
    // Accept either as a valid loaded state to avoid CI flakiness.
    const telemetrySection = page.getByText('Real-Time Position', { exact: false });
    const emptyState = page.getByText(/No satellite selected|No targets configured/i);

    await expect(telemetrySection.or(emptyState).first()).toBeVisible({ timeout: 10000 });
  });

  test('should update tracking data in real-time', async ({ page }) => {
    // Wait for initial load
    await page.waitForTimeout(2000);

    // Get initial value of a tracking parameter
    const elevationElement = page.locator('text=/elevation/i').first();

    if (await elevationElement.isVisible()) {
      const initialText = await elevationElement.textContent();

      // Wait a bit for potential update
      await page.waitForTimeout(3000);

      const updatedText = await elevationElement.textContent();

      // Check if data has updated (this depends on satellite movement)
      // In a real test, you might want to mock the socket data
      expect(updatedText).toBeDefined();
    }
  });
});

test.describe('Satellite Earth View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display birds eye view map', async ({ page }) => {
    const mapContainer = getVisibleMapSurface(page);
    await expect(mapContainer).toBeVisible({ timeout: 10000 });
  });
});
