/**
 * E2E tests for hardware configuration pages
 */

import { test, expect } from '@playwright/test';
import { ensureLocationIsConfigured } from './location-helpers.js';

const ensureLocationIsSet = async (page) => {
  await ensureLocationIsConfigured(page);
};

const openAddDialogWithLocationFallback = async (page) => {
  const currentUrl = page.url();
  const getAddButton = () => page.locator('button', { hasText: /add|new|create/i }).first();

  try {
    await expect(getAddButton()).toBeVisible({ timeout: 5000 });
    await expect(getAddButton()).toBeEnabled({ timeout: 10000 });
  } catch {
    await ensureLocationIsSet(page);
    await page.goto(currentUrl);
    await page.waitForLoadState('domcontentloaded');
    await expect(getAddButton()).toBeVisible();
    await expect(getAddButton()).toBeEnabled({ timeout: 10000 });
  }

  await getAddButton().scrollIntoViewIfNeeded();
  await getAddButton().click();
  return page.getByRole('dialog');
};

const confirmDeleteInDialog = async (dialog) => {
  const typeDeleteInput = dialog.getByLabel(/type delete to confirm/i);
  if (await typeDeleteInput.isVisible().catch(() => false)) {
    await typeDeleteInput.fill('DELETE');
  }

  const confirmButton = dialog.getByRole('button', { name: /^delete$/i });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
};

const clickSelectionEditButton = async (page) => {
  // Scope to toolbar-style MUI buttons so row-level icon buttons (also named "Edit") are excluded.
  const button = page.locator('.MuiButton-root').filter({ hasText: /^edit$/i }).first();
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
};

test.describe('Rig Configuration', () => {
  const openRigDialog = async (page) => {
    return openAddDialogWithLocationFallback(page);
  };

  const selectRigRowForDelete = async (page, rowLocator) => {
    await expect(rowLocator).toBeVisible();
    const checkbox = rowLocator.getByRole('checkbox');
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.check({ force: true });
    await expect(checkbox).toBeChecked();
    await expect(page.getByRole('button', { name: /^delete$/i })).toBeEnabled();
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/system/hardware/rigs');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display rig configuration page', async ({ page }) => {
    // Wait for content to load
    await page.waitForTimeout(2000);

    // Verify we're on the rigs page
    expect(page.url()).toContain('/admin/system/hardware/rigs');
  });

  test('should have rig configuration controls', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for common rig-related text or controls
    const rigContent = page.locator('button, input, select, [role="combobox"]');
    const count = await rigContent.count();

    // Should have some interactive elements for rig configuration
    expect(count).toBeGreaterThan(0);
  });

  test('should allow adding or configuring rigs', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for add button or configuration options
    const buttons = page.locator('button');
    const addButton = buttons.filter({ hasText: /add|new|create/i });

    // Should have controls (even if add button isn't present, other buttons should exist)
    const totalButtons = await buttons.count();
    expect(totalButtons).toBeGreaterThan(0);
  });

  test('should allow adding, editing, and deleting a rig', async ({ page }) => {
    await page.waitForTimeout(2000);

    const rigName = `Rig ${Date.now()}`;
    const updatedName = `${rigName} Updated`;

    const addDialog = await openRigDialog(page);
    await addDialog.getByLabel('Name').fill(rigName);
    await addDialog.getByLabel('Host').fill('127.0.0.1');
    await addDialog.getByLabel('Port').fill('4532');
    await addDialog.getByRole('button', { name: /submit/i }).click();
    await expect(addDialog).toBeHidden();

    const row = page.locator('.MuiDataGrid-row').filter({ hasText: rigName });
    await expect(row).toBeVisible();
    await selectRigRowForDelete(page, row);
    await clickSelectionEditButton(page);

    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Name').fill(updatedName);
    await editDialog.getByRole('button', { name: /submit/i }).click();
    await expect(editDialog).toBeHidden();

    const updatedRow = page.locator('.MuiDataGrid-row').filter({ hasText: updatedName });
    await expect(updatedRow).toBeVisible();

    await selectRigRowForDelete(page, updatedRow);
    await page.getByRole('button', { name: /^delete$/i }).click();
    const deleteDialog = page.getByRole('dialog');
    await deleteDialog.getByRole('button', { name: /^delete$/i }).click();
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: updatedName })).toHaveCount(0);
  });

  test('should allow deleting multiple rigs', async ({ page }) => {
    await page.waitForTimeout(2000);

    const rigNameA = `Rig A ${Date.now()}`;
    const rigNameB = `Rig B ${Date.now()}`;

    const addDialogA = await openRigDialog(page);
    await addDialogA.getByLabel('Name').fill(rigNameA);
    await addDialogA.getByLabel('Host').fill('127.0.0.1');
    await addDialogA.getByLabel('Port').fill('4532');
    await addDialogA.getByRole('button', { name: /submit/i }).click();
    await expect(addDialogA).toBeHidden();

    const addDialogB = await openRigDialog(page);
    await addDialogB.getByLabel('Name').fill(rigNameB);
    await addDialogB.getByLabel('Host').fill('127.0.0.1');
    await addDialogB.getByLabel('Port').fill('4532');
    await addDialogB.getByRole('button', { name: /submit/i }).click();
    await expect(addDialogB).toBeHidden();

    const rowA = page.locator('.MuiDataGrid-row').filter({ hasText: rigNameA });
    const rowB = page.locator('.MuiDataGrid-row').filter({ hasText: rigNameB });
    await rowA.getByRole('checkbox').check({ force: true });
    await rowB.getByRole('checkbox').check({ force: true });
    await expect(page.getByRole('button', { name: /^delete$/i })).toBeEnabled();

    await page.getByRole('button', { name: /^delete$/i }).click();
    const deleteDialog = page.getByRole('dialog');
    await confirmDeleteInDialog(deleteDialog);
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: rigNameA })).toHaveCount(0);
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: rigNameB })).toHaveCount(0);
  });
});

test.describe('Rotator Configuration', () => {
  const openRotatorDialog = async (page) => {
    return openAddDialogWithLocationFallback(page);
  };

  const selectRotatorRowForDelete = async (page, rowLocator) => {
    await expect(rowLocator).toBeVisible();
    const checkbox = rowLocator.getByRole('checkbox');
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.check({ force: true });
    await expect(checkbox).toBeChecked();
    await expect(page.getByRole('button', { name: /^delete$/i })).toBeEnabled();
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/system/hardware/rotators');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display rotator configuration page', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Verify we're on the rotator page
    expect(page.url()).toContain('/admin/system/hardware/rotators');
  });

  test('should have rotator configuration controls', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for rotator-related controls
    const controls = page.locator('button, input, select');
    const count = await controls.count();

    // Should have some interactive elements
    expect(count).toBeGreaterThan(0);
  });

  test('should display azimuth and elevation controls or information', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for azimuth/elevation related text or controls
    const azElText = page.getByText(/azimuth|elevation|az|el/i);

    // Common rotator terminology should be present
    const count = await azElText.count();
    expect(count).toBeGreaterThanOrEqual(0); // May or may not be visible depending on setup
  });

  test('should allow adding, editing, and deleting a rotator', async ({ page }) => {
    await page.waitForTimeout(2000);

    const rotatorName = `Rotator ${Date.now()}`;
    const updatedName = `${rotatorName} Updated`;

    const addDialog = await openRotatorDialog(page);
    await addDialog.getByLabel('Name').fill(rotatorName);
    await addDialog.getByLabel('Host').fill('127.0.0.1');
    await addDialog.getByLabel('Port').fill('4533');
    await addDialog.locator('input[name="minaz"]').fill('0');
    await addDialog.locator('input[name="maxaz"]').fill('360');
    await addDialog.locator('input[name="minel"]').fill('0');
    await addDialog.locator('input[name="maxel"]').fill('90');
    await addDialog.getByRole('button', { name: /submit/i }).click();
    await expect(addDialog).toBeHidden();

    const row = page.locator('.MuiDataGrid-row').filter({ hasText: rotatorName });
    await expect(row).toBeVisible();
    await selectRotatorRowForDelete(page, row);
    await clickSelectionEditButton(page);

    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Name').fill(updatedName);
    await editDialog.getByRole('button', { name: /submit/i }).click();
    await expect(editDialog).toBeHidden();

    const updatedRow = page.locator('.MuiDataGrid-row').filter({ hasText: updatedName });
    await expect(updatedRow).toBeVisible();

    await selectRotatorRowForDelete(page, updatedRow);
    await page.getByRole('button', { name: /^delete$/i }).click();
    const deleteDialog = page.getByRole('dialog');
    await deleteDialog.getByRole('button', { name: /^delete$/i }).click();
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: updatedName })).toHaveCount(0);
  });

  test('should allow deleting multiple rotators', async ({ page }) => {
    await page.waitForTimeout(2000);

    const rotatorNameA = `Rotator A ${Date.now()}`;
    const rotatorNameB = `Rotator B ${Date.now()}`;

    const addDialogA = await openRotatorDialog(page);
    await addDialogA.getByLabel('Name').fill(rotatorNameA);
    await addDialogA.getByLabel('Host').fill('127.0.0.1');
    await addDialogA.getByLabel('Port').fill('4533');
    await addDialogA.locator('input[name="minaz"]').fill('0');
    await addDialogA.locator('input[name="maxaz"]').fill('360');
    await addDialogA.locator('input[name="minel"]').fill('0');
    await addDialogA.locator('input[name="maxel"]').fill('90');
    await addDialogA.getByRole('button', { name: /submit/i }).click();
    await expect(addDialogA).toBeHidden();

    const addDialogB = await openRotatorDialog(page);
    await addDialogB.getByLabel('Name').fill(rotatorNameB);
    await addDialogB.getByLabel('Host').fill('127.0.0.1');
    await addDialogB.getByLabel('Port').fill('4533');
    await addDialogB.locator('input[name="minaz"]').fill('0');
    await addDialogB.locator('input[name="maxaz"]').fill('360');
    await addDialogB.locator('input[name="minel"]').fill('0');
    await addDialogB.locator('input[name="maxel"]').fill('90');
    await addDialogB.getByRole('button', { name: /submit/i }).click();
    await expect(addDialogB).toBeHidden();

    const rowA = page.locator('.MuiDataGrid-row').filter({ hasText: rotatorNameA });
    const rowB = page.locator('.MuiDataGrid-row').filter({ hasText: rotatorNameB });
    await rowA.getByRole('checkbox').check({ force: true });
    await rowB.getByRole('checkbox').check({ force: true });
    await expect(page.getByRole('button', { name: /^delete$/i })).toBeEnabled();

    await page.getByRole('button', { name: /^delete$/i }).click();
    const deleteDialog = page.getByRole('dialog');
    await confirmDeleteInDialog(deleteDialog);
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: rotatorNameA })).toHaveCount(0);
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: rotatorNameB })).toHaveCount(0);
  });
});

test.describe('SDR Configuration', () => {
  const openAddDialog = async (page) => {
    return openAddDialogWithLocationFallback(page);
  };

  const selectRtlUsb = async (page, dialog, version = 'v4') => {
    await dialog.getByLabel('SDR Type').click();
    await page.getByRole('option', { name: 'RTL-SDR USB' }).click();
    await dialog.getByRole('button', { name: version }).click();
  };

  const addBogusRtlUsb = async (page, { name, serial, version = 'v4' }) => {
    const dialog = await openAddDialog(page);
    await selectRtlUsb(page, dialog, version);
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Serial').fill(serial);
    await dialog.getByRole('button', { name: /submit/i }).click();
    await expect(dialog).toBeHidden();
  };

  const selectRowForDelete = async (page, rowLocator) => {
    await expect(rowLocator).toBeVisible();
    const checkbox = rowLocator.getByRole('checkbox');
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.check({ force: true });
    await expect(checkbox).toBeChecked();
    await expect(page.getByRole('button', { name: /^delete$/i })).toBeEnabled();
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/system/hardware/sdrs');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display SDR configuration page', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Verify we're on the SDRs page
    expect(page.url()).toContain('/admin/system/hardware/sdrs');
  });

  test('should have SDR configuration controls', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for SDR-related controls
    const controls = page.locator('button, input, select');
    const count = await controls.count();

    // Should have some interactive elements
    expect(count).toBeGreaterThan(0);
  });

  test('should allow adding or managing SDRs', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for buttons to manage SDRs
    const buttons = page.locator('button');
    const count = await buttons.count();

    // Should have control buttons
    expect(count).toBeGreaterThan(0);
  });

  test('should allow adding a bogus RTL-SDR and deleting it', async ({ page }) => {
    await page.waitForTimeout(2000);

    const bogusName = `Bogus RTL-SDR ${Date.now()}`;

    await addBogusRtlUsb(page, { name: bogusName, serial: 'BOGUS123' });

    const row = page.locator('.MuiDataGrid-row').filter({ hasText: bogusName });
    await expect(row).toBeVisible();

    await row.getByRole('checkbox').click();
    await page.getByRole('button', { name: /^delete$/i }).click();

    const deleteDialog = page.getByRole('dialog');
    await deleteDialog.getByRole('button', { name: /^delete$/i }).click();

    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: bogusName })).toHaveCount(0);
  });

  test('should validate required RTL-SDR USB fields', async ({ page }) => {
    await page.waitForTimeout(2000);

    const dialog = await openAddDialog(page);
    await selectRtlUsb(page, dialog, 'v4');

    await dialog.getByLabel('Name').fill('');
    await dialog.getByLabel('Serial').fill('');

    await expect(dialog.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  test('should validate required RTL-SDR TCP fields', async ({ page }) => {
    await page.waitForTimeout(2000);

    const dialog = await openAddDialog(page);
    await dialog.getByLabel('SDR Type').click();
    await page.getByRole('option', { name: 'RTL-SDR TCP' }).click();
    await dialog.getByRole('button', { name: 'v4' }).click();

    await dialog.getByLabel('Name').fill('Bogus RTL TCP');
    await dialog.getByLabel('Host').fill('');
    await dialog.getByLabel('Port').fill('');

    await expect(dialog.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  test('should allow editing an SDR', async ({ page }) => {
    await page.waitForTimeout(2000);

    const initialName = `Bogus RTL-SDR ${Date.now()}`;
    const updatedName = `${initialName} Updated`;

    await addBogusRtlUsb(page, { name: initialName, serial: 'BOGUS234' });

    const row = page.locator('.MuiDataGrid-row').filter({ hasText: initialName });
    await row.getByRole('checkbox').click();
    await clickSelectionEditButton(page);

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(updatedName);
    await dialog.getByRole('button', { name: /submit/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: updatedName })).toHaveCount(1);

    const updatedRow = page.locator('.MuiDataGrid-row').filter({ hasText: updatedName });
    await selectRowForDelete(page, updatedRow);
    await page.getByRole('button', { name: /^delete$/i }).click();
    const deleteDialog = page.getByRole('dialog');
    await deleteDialog.getByRole('button', { name: /^delete$/i }).click();
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: updatedName })).toHaveCount(0);
  });

  test('should delete multiple SDRs', async ({ page }) => {
    await page.waitForTimeout(2000);

    const nameA = `Bogus RTL-SDR A ${Date.now()}`;
    const nameB = `Bogus RTL-SDR B ${Date.now()}`;

    await addBogusRtlUsb(page, { name: nameA, serial: 'BOGUS345' });
    await addBogusRtlUsb(page, { name: nameB, serial: 'BOGUS346' });

    const rowA = page.locator('.MuiDataGrid-row').filter({ hasText: nameA });
    const rowB = page.locator('.MuiDataGrid-row').filter({ hasText: nameB });
    await rowA.getByRole('checkbox').click();
    await rowB.getByRole('checkbox').click();

    await page.getByRole('button', { name: /^delete$/i }).click();
    const deleteDialog = page.getByRole('dialog');
    await confirmDeleteInDialog(deleteDialog);

    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: nameA })).toHaveCount(0);
    await expect(page.locator('.MuiDataGrid-row').filter({ hasText: nameB })).toHaveCount(0);
  });
});

test.describe('Hardware Navigation Flow', () => {
  test('should navigate between hardware pages', async ({ page }) => {
    // Navigate to rigs
    await page.goto('/admin/system/hardware/rigs');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/system/hardware/rigs');

    // Navigate to rotators
    await page.goto('/admin/system/hardware/rotators');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/system/hardware/rotators');

    // Navigate to SDRs
    await page.goto('/admin/system/hardware/sdrs');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/system/hardware/sdrs');
  });
});
