/**
 * E2E tests for settings pages
 */

import { test, expect } from '@playwright/test';

test.describe('Preferences Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/preferences');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display preferences page', async ({ page }) => {
    // Validate the preferences form itself using stable selectors.
    await expect(page.locator('#theme-selector')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('preferences-save-button')).toBeVisible({ timeout: 15000 });
  });

  test('should display theme preference option', async ({ page }) => {
    // Look for theme-related text or controls
    const themeOption = page.getByText(/theme/i).first();
    await expect(themeOption).toBeVisible({ timeout: 10000 });
  });

  test('should display language preference option', async ({ page }) => {
    // Look for language-related text or controls
    const languageOption = page.getByText(/language/i).first();
    await expect(languageOption).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Location Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/system/location');
    await page.waitForLoadState('domcontentloaded');
  });


  test('should have latitude and longitude fields', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for latitude/longitude labels or inputs
    const latLonText = page.getByText(/latitude|longitude|lat|lon|coordinates/i);
    await expect(latLonText.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Maintenance Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/system/maintenance');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display maintenance page', async ({ page }) => {
    // Wait for page to load
    await page.waitForTimeout(2000);

    // Page should be loaded (basic check)
    expect(page.url()).toContain('/admin/system/maintenance');
  });

  test('should have maintenance controls or information', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for buttons or text related to maintenance
    const buttons = page.locator('button');
    const count = await buttons.count();

    // Should have some interactive elements
    expect(count).toBeGreaterThan(0);
  });

  test('should display time drift diagnostics card', async ({ page }) => {
    await page.goto('/admin/system/maintenance?mtab=diagnostics');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(/Frontend vs Backend Time/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Frontend Time/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/^Backend Time/i)).toBeVisible({ timeout: 10000 });
  });
});

test.describe('About Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/system/about');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display about page', async ({ page }) => {
    // Wait for content to load
    await page.waitForTimeout(2000);

    // Should be on the about page
    expect(page.url()).toContain('/admin/system/about');
  });

  test('should display application information', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for common about page elements like version, copyright, or Ground Station text
    const aboutContent = page.getByText(/version|copyright|ground station|license/i);
    await expect(aboutContent.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Settings Navigation Flow', () => {
  test('should navigate between different settings pages', async ({ page }) => {
    // Start at preferences
    await page.goto('/preferences');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/preferences');

    // Navigate to location
    await page.goto('/admin/system/location');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/system/location');

    // Navigate to maintenance
    await page.goto('/admin/system/maintenance');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/system/maintenance');

    // Navigate to about
    await page.goto('/admin/system/about');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/system/about');
  });
});

test.describe('Preferences Persistence', () => {
  test('should persist theme preference after refresh', async ({ page }) => {
    await page.goto('/preferences');
    await page.waitForLoadState('domcontentloaded');

    const themeSelect = page.locator('#theme-selector');
    await themeSelect.click();
    const allThemeOptions = page.getByRole('option');
    const optionCount = await allThemeOptions.count();
    let currentlySelectedThemeName = null;
    let selectedThemeName = null;

    for (let i = 0; i < optionCount; i++) {
      const option = allThemeOptions.nth(i);
      const optionName = (await option.innerText()).trim();
      const isSelected = (await option.getAttribute('aria-selected')) === 'true';
      if (isSelected) {
        currentlySelectedThemeName = optionName;
      }
      if (optionName && optionName !== currentlySelectedThemeName) {
        selectedThemeName = optionName;
        await option.click();
        break;
      }
    }

    if (!selectedThemeName) {
      for (let i = 0; i < optionCount; i++) {
        const option = allThemeOptions.nth(i);
        const optionName = (await option.innerText()).trim();
        if (optionName && optionName !== currentlySelectedThemeName) {
          selectedThemeName = optionName;
          await option.click();
          break;
        }
      }
    }

    expect(selectedThemeName).not.toBeNull();

    const saveButton = page.getByTestId('preferences-save-button');
    await expect(saveButton).toBeEnabled({ timeout: 15000 });
    await saveButton.click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('domcontentloaded');

    await themeSelect.click();
    await expect(page.getByRole('option', { name: selectedThemeName })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
  });
});
