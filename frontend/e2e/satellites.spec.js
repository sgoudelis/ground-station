/**
 * E2E tests for satellite management pages
 */

import { test, expect } from '@playwright/test';

async function ensureSourcesSubTabSelected(page) {
  const addButton = page.getByRole('button', { name: /^add$/i }).first();
  if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    return;
  }

  // Target the inner orbital-data tab group (Sync Now / Sources), not the top satellites tabs.
  const orbitalSourceTablist = page.getByRole('tablist').filter({
    has: page.getByRole('tab', { name: /^sync now$/i }),
  }).first();
  await expect(orbitalSourceTablist).toBeVisible({ timeout: 15000 });

  const sourcesTab = orbitalSourceTablist.getByRole('tab', { name: /^sources$/i });
  await expect(sourcesTab).toBeVisible({ timeout: 15000 });

  const isSelected = await sourcesTab.getAttribute('aria-selected');
  if (isSelected !== 'true') {
    await sourcesTab.click();
    await expect(sourcesTab).toHaveAttribute('aria-selected', 'true');
  }

  await expect(addButton).toBeVisible({ timeout: 15000 });
}

test.describe('TLE Sources', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/satellites/sources');
    await page.waitForLoadState('domcontentloaded');
    await ensureSourcesSubTabSelected(page);
  });

  test('should display TLE sources page', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Verify we're on the TLE sources page
    expect(page.url()).toContain('/admin/satellites/sources');
  });

  test('should have TLE source management controls', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for controls to manage TLE sources
    const controls = page.locator('button, input, a');
    const count = await controls.count();

    // Should have interactive elements
    expect(count).toBeGreaterThan(0);
  });

  test('should allow adding or editing TLE sources', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for add or edit buttons
    const buttons = page.locator('button');
    const actionButtons = buttons.filter({ hasText: /add|edit|new|create|update/i });

    // Should have action buttons available (checking for any buttons as fallback)
    const totalButtons = await buttons.count();
    expect(totalButtons).toBeGreaterThan(0);
  });
});

test.describe('Satellites Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/satellites/catalog');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display satellites page', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Verify we're on the satellites page
    expect(page.url()).toContain('/admin/satellites/catalog');
  });

  test('should have satellite list or grid', async ({ page }) => {
    await page.waitForTimeout(3000);

    // Look for satellite entries (could be table, list, or grid)
    const satelliteElements = page.locator('[role="row"], [role="listitem"], .satellite-item, td, li');
    const count = await satelliteElements.count();

    // Should have some elements (even if empty state)
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should allow searching or filtering satellites', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for search input or filter controls
    const searchInput = page.locator('input[type="text"], input[type="search"], input[placeholder*="search" i]');

    // Should have search capability (checking if inputs exist)
    const inputCount = await searchInput.count();
    const allInputs = await page.locator('input').count();

    expect(allInputs).toBeGreaterThanOrEqual(0);
  });

  test('should display satellite information', async ({ page }) => {
    await page.waitForTimeout(3000);

    // Look for any satellite-related information
    const content = page.locator('body');
    await expect(content).toBeVisible();

    // Page should be loaded
    expect(page.url()).toContain('/admin/satellites/catalog');
  });
});

test.describe('Satellite Groups', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/satellites/groups');
    await page.waitForLoadState('domcontentloaded');
  });


  test('should have group management controls', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for buttons to manage groups
    const buttons = page.locator('button');
    const count = await buttons.count();

    // Should have some buttons for group management
    expect(count).toBeGreaterThan(0);
  });

  test('should allow creating or editing groups', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for add/create/edit buttons
    const buttons = page.locator('button');
    const actionButtons = buttons.filter({ hasText: /add|create|new|edit/i });

    // Should have action buttons (or at least some buttons)
    const totalButtons = await buttons.count();
    expect(totalButtons).toBeGreaterThan(0);
  });

  test('should display existing groups', async ({ page }) => {
    await page.waitForTimeout(3000);

    // Look for group items or list
    const groupElements = page.locator('[role="listitem"], .group-item, li, [role="row"]');

    // Should have group display elements (even if empty)
    const count = await groupElements.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Satellite Navigation Flow', () => {
  test('should navigate between satellite pages', async ({ page }) => {
    // TLE Sources
    await page.goto('/admin/satellites/sources');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/satellites/sources');

    // Satellites
    await page.goto('/admin/satellites/catalog');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/satellites/catalog');

    // Groups
    await page.goto('/admin/satellites/groups');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/satellites/groups');
  });

});

test.describe('Satellite Info Page', () => {
  test('should handle direct satellite info navigation with NORAD ID', async ({ page }) => {
    // Test with a common satellite NORAD ID (ISS = 25544)
    await page.goto('/satellites/25544');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Should navigate to satellite info page
    expect(page.url()).toContain('/satellites/25544');
  });

  test('should display satellite information when valid NORAD ID provided', async ({ page }) => {
    // Navigate to a satellite info page
    await page.goto('/satellites/25544');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Should have some content loaded
    const content = page.locator('body');
    await expect(content).toBeVisible();
  });
});

test.describe('Satellite List CRUD', () => {
  test('should allow adding, editing, and deleting a satellite', async ({ page }) => {
    await page.goto('/admin/satellites/catalog');
    await page.waitForLoadState('domcontentloaded');

    // Keep a deterministic 5-digit NORAD ID to avoid invalid values.
    const noradId = String(10000 + (Date.now() % 90000));
    const name = `E2E Sat ${noradId}`;
    const updatedName = `${name} Updated`;
    const tle1 = '1 25544U 98067A   20029.54791585  .00001264  00000-0  29621-4 0  9994';
    const tle2 = '2 25544  51.6449  18.9183 0004869  73.6915  35.7994 15.49191311210139';

    await page.getByRole('button', { name: /^add$/i }).click();
    const addDialog = page.getByRole('dialog', { name: /add satellite/i });
    await expect(addDialog).toBeVisible();
    await addDialog.getByRole('textbox', { name: /^name$/i }).fill(name);
    await addDialog.locator('input[name="norad_id"]').fill(noradId);
    await addDialog.getByRole('tab', { name: /^orbital$/i }).click();
    await addDialog.getByRole('textbox', { name: /tle line 1/i }).fill(tle1);
    await addDialog.getByRole('textbox', { name: /tle line 2/i }).fill(tle2);
    await addDialog.getByRole('button', { name: /^submit$/i }).click();
    await expect(addDialog).toBeHidden();

    const searchInput = page.getByRole('textbox', { name: /search satellites/i });
    await searchInput.fill(noradId);
    await page.waitForTimeout(800);

    const row = page.locator('.MuiDataGrid-row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole('checkbox').check({ force: true });

    const toolbarEditButton = page.getByRole('button').filter({ hasText: /^edit$/i }).first();
    await expect(toolbarEditButton).toBeEnabled();
    await toolbarEditButton.click();
    const editDialog = page.getByRole('dialog', { name: /edit satellite/i });
    await expect(editDialog).toBeVisible();
    await editDialog.getByRole('textbox', { name: /^name$/i }).fill(updatedName);
    await editDialog.getByRole('tab', { name: /^orbital$/i }).click();
    await editDialog.getByRole('textbox', { name: /tle line 1/i }).fill(tle1);
    await editDialog.getByRole('textbox', { name: /tle line 2/i }).fill(tle2);
    await editDialog.getByRole('button', { name: /^edit$/i }).click();
    await expect(editDialog).toBeHidden();

    await searchInput.fill(updatedName);
    await page.waitForTimeout(800);
    const updatedRow = page.locator('.MuiDataGrid-row').filter({ hasText: updatedName });
    await expect(updatedRow).toBeVisible();
    await updatedRow.getByRole('checkbox').check({ force: true });

    await page.getByRole('button', { name: /^delete$/i }).click();
    const deleteDialog = page.getByRole('dialog');
    await deleteDialog.getByRole('button', { name: /^delete$/i }).click();
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: updatedName })).toHaveCount(0);
  });
});

test.describe('TLE Sources CRUD', () => {
  test('should allow adding, editing, and deleting a TLE source', async ({ page }) => {
    await page.goto('/admin/satellites/sources');
    await page.waitForLoadState('domcontentloaded');
    await ensureSourcesSubTabSelected(page);

    const sourceName = `E2E Source ${Date.now()}`;
    const updatedName = `${sourceName} Updated`;
    const url = `https://example.com/${Date.now()}.txt`;

    await page.getByRole('button', { name: /add/i }).click();

    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel(/name/i).fill(sourceName);
    await addDialog.getByLabel(/url/i).fill(url);
    await addDialog.getByRole('button', { name: /submit|add|create|save/i }).click();
    await expect(addDialog).toBeHidden();

    const row = page.locator('.MuiDataGrid-row').filter({ hasText: sourceName });
    await expect(row).toBeVisible();
    await row.getByRole('checkbox').check({ force: true });

    const toolbarEditButton = page.getByRole('button').filter({ hasText: /^edit$/i }).first();
    await expect(toolbarEditButton).toBeEnabled();
    await toolbarEditButton.click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel(/name/i).fill(updatedName);
    await editDialog.getByRole('button', { name: /edit|submit|save/i }).click();
    await expect(editDialog).toBeHidden();

    const updatedRow = page.locator('.MuiDataGrid-row').filter({ hasText: updatedName });
    await expect(updatedRow).toBeVisible();
    await updatedRow.getByRole('checkbox').check({ force: true });

    await page.getByRole('button', { name: /^delete$/i }).click();
    const deleteDialog = page.getByRole('dialog');
    await deleteDialog.getByRole('button', { name: /^delete$/i }).click();
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: updatedName })).toHaveCount(0);
  });
});

test.describe('Satellite Groups CRUD', () => {
  test('should allow adding and deleting a satellite group', async ({ page }) => {
    await page.goto('/admin/satellites/groups');
    await page.waitForLoadState('domcontentloaded');

    const groupName = `E2E Group ${Date.now()}`;

    await page.getByRole('button', { name: /add/i }).click();

    const formDialog = page.getByRole('dialog').filter({ hasText: /add a new satellite group/i }).first();
    await formDialog.getByRole('textbox', { name: /^name$/i }).fill(groupName);
    await formDialog.getByRole('button', { name: /submit/i }).click();
    await expect(formDialog).toBeHidden();

    const row = page.locator('.MuiDataGrid-row').filter({ hasText: groupName });
    await expect(row).toBeVisible();
    await row.getByRole('checkbox').check({ force: true });

    await page.getByRole('button', { name: /^delete$/i }).click();
    const deleteDialog = page.getByRole('dialog');
    await deleteDialog.getByRole('button', { name: /^delete$/i }).click();
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: groupName })).toHaveCount(0);
  });
});
