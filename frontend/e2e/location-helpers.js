const DEFAULT_COORDINATES = {
  latitude: '37.9838',
  longitude: '23.7275',
};

const DEFAULT_ADMIN_PASSWORD = 'GroundStationE2E#2026';

const toPathUrl = (baseURL, path) => {
  if (!baseURL) return path;
  return new URL(path, baseURL).toString();
};

const waitForEnabled = async (page, locator, timeout = 30000) => {
  const start = Date.now();
  while ((Date.now() - start) < timeout) {
    if (await locator.isEnabled().catch(() => false)) {
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
};

const getSetupWizardDialog = (page) => page.getByRole('dialog').filter({
  hasText: /ground station setup/i,
}).first();

const fillAdminDraftIfVisible = async (wizardDialog, { adminUsername, adminPassword }) => {
  const usernameInput = wizardDialog.getByLabel(/^username\b/i);
  const passwordInput = wizardDialog.getByLabel(/^password\b/i);
  const confirmInput = wizardDialog.getByLabel(/confirm password/i);

  const usernameVisible = await usernameInput.isVisible().catch(() => false);
  if (!usernameVisible) {
    return;
  }

  // Setup validation requires all three fields before advancing out of Admin step.
  await usernameInput.fill(adminUsername);
  await passwordInput.fill(adminPassword);
  await confirmInput.fill(adminPassword);
};

const ensureCoordinatesForWizardStep = async (page, wizardDialog, coordinates) => {
  const nextButton = wizardDialog.getByRole('button', { name: /^next$/i }).first();
  if (await nextButton.isEnabled().catch(() => false)) {
    return;
  }

  const enterCoordinatesButton = wizardDialog.getByRole('button', { name: /enter coordinates/i }).first();
  const canEnterCoordinates = await enterCoordinatesButton.isVisible().catch(() => false);
  if (canEnterCoordinates) {
    await enterCoordinatesButton.click();

    const manualDialog = page.getByRole('dialog').filter({
      has: page.getByRole('button', { name: /apply coordinates/i }),
    }).first();
    await manualDialog.waitFor({ state: 'visible', timeout: 10000 });
    await manualDialog.getByLabel(/latitude/i).fill(coordinates.latitude);
    await manualDialog.getByLabel(/longitude/i).fill(coordinates.longitude);
    await manualDialog.getByRole('button', { name: /apply coordinates/i }).click();
    await manualDialog.waitFor({ state: 'hidden', timeout: 10000 });
  }

  if (await nextButton.isEnabled().catch(() => false)) {
    return;
  }

  const mapCanvas = wizardDialog.locator('.maplibregl-canvas').first();
  await mapCanvas.waitFor({ state: 'visible', timeout: 10000 });
  const box = await mapCanvas.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await mapCanvas.click();
  }

  const nextEnabled = await waitForEnabled(page, nextButton, 10000);
  if (!nextEnabled) {
    throw new Error('Setup wizard did not enable Next after selecting coordinates.');
  }
};

const ensureStationIdentityDraft = async (wizardDialog) => {
  const stationNameInput = wizardDialog.getByLabel(/station name/i);
  const stationNameVisible = await stationNameInput.isVisible().catch(() => false);
  if (!stationNameVisible) {
    return;
  }

  const currentName = (await stationNameInput.inputValue().catch(() => '')).trim();
  if (!currentName) {
    await stationNameInput.fill('Ground Station');
  }
};

const waitForSetupCompletion = async (page, wizardDialog) => {
  const wizardHidden = await wizardDialog.waitFor({ state: 'hidden', timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (wizardHidden) {
    return;
  }

  // Fallback for slower runtime bootstrap after successful login.
  const appMainVisible = await page.getByRole('main').first().waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!appMainVisible) {
    throw new Error('Setup wizard did not close after pressing Complete setup.');
  }
};

export const completeLocationWizardIfVisible = async (
  page,
  {
    waitForMs = 5000,
    coordinates = DEFAULT_COORDINATES,
    adminUsername = `e2e-admin-${Date.now()}`,
    adminPassword = DEFAULT_ADMIN_PASSWORD,
    completeSetup = true,
  } = {},
) => {
  const wizardDialog = getSetupWizardDialog(page);
  let wizardVisible = await wizardDialog.isVisible().catch(() => false);
  if (!wizardVisible && waitForMs > 0) {
    wizardVisible = await wizardDialog.waitFor({ state: 'visible', timeout: waitForMs })
      .then(() => true)
      .catch(() => false);
  }
  if (!wizardVisible) {
    return false;
  }

  // The setup dialog can start from any step (fresh run, partial run, retries).
  // Drive by visible actions instead of hard-coding one fixed entry point.
  for (let stepGuard = 0; stepGuard < 14; stepGuard += 1) {
    const completeButton = wizardDialog.getByRole('button', { name: /^complete setup$/i }).first();
    if (await completeButton.isVisible().catch(() => false)) {
      if (!completeSetup) {
        return true;
      }

      const completeEnabled = await waitForEnabled(page, completeButton, 30000);
      if (!completeEnabled) {
        throw new Error('Setup wizard Complete setup button did not become enabled.');
      }
      await completeButton.click();
      await waitForSetupCompletion(page, wizardDialog);
      return true;
    }

    const saveButton = wizardDialog.getByRole('button', { name: /save and continue|save location/i }).first();
    if (await saveButton.isVisible().catch(() => false)) {
      const saveEnabled = await waitForEnabled(page, saveButton, 20000);
      if (!saveEnabled) {
        throw new Error('Setup wizard Save and Continue button is disabled.');
      }
      await saveButton.click();
      await wizardDialog.getByText(/setup checklist/i).first().waitFor({ state: 'visible', timeout: 30000 });
      continue;
    }

    const nextButton = wizardDialog.getByRole('button', { name: /^next$/i }).first();
    if (await nextButton.isVisible().catch(() => false)) {
      await fillAdminDraftIfVisible(wizardDialog, { adminUsername, adminPassword });
      await ensureStationIdentityDraft(wizardDialog);
      await ensureCoordinatesForWizardStep(page, wizardDialog, coordinates);

      const nextEnabled = await waitForEnabled(page, nextButton, 10000);
      if (!nextEnabled) {
        throw new Error('Setup wizard Next button did not become enabled.');
      }
      await nextButton.click();
      continue;
    }

    const dialogStillVisible = await wizardDialog.isVisible().catch(() => false);
    if (!dialogStillVisible) {
      return true;
    }

    throw new Error('Setup wizard is visible but no actionable button was found.');
  }

  throw new Error('Setup wizard did not reach a completed state in expected number of steps.');
};

export const ensureLocationIsConfigured = async (page, { baseURL } = {}) => {
  const locationUrl = toPathUrl(baseURL, '/admin/system/location');

  await page.goto(locationUrl);
  await page.waitForLoadState('domcontentloaded');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const wizardCompleted = await completeLocationWizardIfVisible(page, {
      waitForMs: attempt === 0 ? 5000 : 1200,
    });
    if (wizardCompleted) {
      break;
    }

    const saveButtonVisible = await page.getByRole('button', { name: /save location/i }).first()
      .isVisible()
      .catch(() => false);
    if (saveButtonVisible) {
      break;
    }
  }

  await page.goto(locationUrl);
  await page.waitForLoadState('domcontentloaded');

  const mapCanvas = page.locator('.maplibregl-canvas').first();
  await mapCanvas.waitFor({ state: 'visible', timeout: 15000 });

  const marker = page.locator('.maplibregl-marker');
  if ((await marker.count()) > 0) {
    return;
  }

  const box = await mapCanvas.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await mapCanvas.click();
  }

  const saveButton = page.getByRole('button', { name: /save location/i }).first();
  const saveVisible = await saveButton.waitFor({ state: 'visible', timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  if (!saveVisible) {
    const wizardCompleted = await completeLocationWizardIfVisible(page, { waitForMs: 1500 });
    if (wizardCompleted) {
      return;
    }
    throw new Error('Save location button is not visible and setup wizard did not appear.');
  }

  if (!(await saveButton.isEnabled()) && box) {
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.42);
  }

  const saveEnabled = await waitForEnabled(page, saveButton, 10000);
  if (!saveEnabled) {
    throw new Error('Save location button is still disabled after map interaction.');
  }

  await saveButton.click();
  await page.waitForLoadState('networkidle').catch(() => {});
};
