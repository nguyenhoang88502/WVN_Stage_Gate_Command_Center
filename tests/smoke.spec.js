// @ts-check
const { test, expect } = require('@playwright/test');

/* Console-error guard: attach before navigation so nothing is missed, then
   assert zero errors at the end of each test. A failure here means the app
   threw somewhere during the flow even if every UI assertion still passed. */
function trackConsoleErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function boot(page) {
  await page.goto('/');
  await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
}

// v8.3 Section 4: switching #whoSelect to 'admin' for the first time in a
// browser context now prompts a PIN modal (sessionStorage-gated, so every
// fresh Playwright context hits it). PIN is the config.json default.
async function loginAsAdmin(page) {
  await page.locator('#whoSelect').selectOption('admin');
  const pinModal = page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' });
  await expect(pinModal).toBeVisible();
  await pinModal.locator('input[type="password"]').fill('1234');
  await pinModal.locator('button', { hasText: 'Unlock' }).click();
  await expect(pinModal).not.toBeVisible();
}

test.describe('boot and header identity', () => {
  test('app boots clean and the header dropdown lists registered users', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await boot(page);

    const who = page.locator('#whoSelect');
    await expect(who).toBeVisible();
    const optionCount = await who.locator('option').count();
    expect(optionCount).toBeGreaterThan(0);

    await loginAsAdmin(page);
    await expect(who).toHaveValue('admin');

    // localStorage persistence, per spec Section 5.
    const stored = await page.evaluate(() => localStorage.getItem('wvn-epm-user'));
    expect(stored).toBe('admin');

    expect(errors, 'no console errors during boot').toEqual([]);
  });
});

test.describe('task lifecycle (v6.2)', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
  });

  async function openFirstNpiProject(page) {
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    const firstRow = page.locator('#views .card.project-list-row').first();
    await firstRow.click();
    await expect(page.locator('#drawer')).toBeVisible();
  }

  test('Assign Task opens a registry-backed modal, not a native dialog', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    // A native prompt()/confirm() left unhandled would hang this test at the
    // default timeout - reaching the assertion below at all is itself proof
    // the modal is DOM-based, not a native dialog.
    await openFirstNpiProject(page);

    const assignBtn = page.locator('#drawer button', { hasText: 'Assign Task' }).first();
    await assignBtn.click();

    const modal = page.locator('.modal', { hasText: 'Assign Task' });
    await expect(modal).toBeVisible();
    const select = modal.locator('select');
    await expect(select).toBeVisible();
    expect(await select.locator('option').count()).toBeGreaterThan(0);
    await expect(modal.locator('input[type=radio][value=owner]')).toBeChecked();

    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toBeHidden();

    expect(errors, 'no console errors while opening/cancelling Assign Task').toEqual([]);
  });

  test('buttons inside a dropzone do not trigger the native file picker', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await openFirstNpiProject(page);

    // If any task-lifecycle button's click bubbled to the dropzone's own
    // onclick, a hidden <input type=file> gets appended to <body> and
    // .click()'d. That's exactly what this asserts never happens.
    const fileInputsBefore = await page.locator('input[type=file]').count();
    const claimBtn = page.locator('#drawer button', { hasText: /^(Claim Task|Assigned to|Claimed by)/ }).first();
    await claimBtn.click();
    await page.waitForTimeout(300);
    const fileInputsAfter = await page.locator('input[type=file]').count();
    expect(fileInputsAfter).toBe(fileInputsBefore);

    expect(errors, 'no console errors from the click').toEqual([]);
  });

  test('Open in Explorer / Open vault folder buttons call the API without throwing', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    // packageBar() (where "Open vault folder" renders) is only mounted in
    // the NPI/ECN flat-project-list views, not the default Dashboard tab.
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();

    const openVaultBtn = page.locator('button', { hasText: 'Open vault folder' }).first();
    await expect(openVaultBtn).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/open-path')),
      openVaultBtn.click(),
    ]);
    expect(response.ok()).toBeTruthy();

    expect(errors, 'no console errors from Open vault folder').toEqual([]);
  });
});

test.describe('dropdown legibility', () => {
  test('select option text is forced dark on a light popup background', async ({ page }) => {
    await boot(page);
    const color = await page.evaluate(() => {
      const opt = document.querySelector('#whoSelect option');
      return opt ? getComputedStyle(opt).color : null;
    });
    // rgb(20, 32, 44) == #14202c
    expect(color).toBe('rgb(20, 32, 44)');
  });
});
