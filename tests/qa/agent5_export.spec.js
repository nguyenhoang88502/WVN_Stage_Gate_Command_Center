// @ts-check
const { test, expect } = require('@playwright/test');

/* Agent 5 — Explorer Integration & PDF/XLSX Exports.
   Extends (does not duplicate) smoke.spec.js test 4, which already covers a
   single "Open vault folder" POST. Here we additionally exercise a filed-
   document "Open in Explorer" POST, the Dashboard PDF print package, and all
   five XLSX report download paths. */

function trackConsoleErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function boot(page) {
  await page.goto('/');
  await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
  await page.locator('#whoSelect').selectOption('admin');
  // v8.3 Section 4: first switch to admin per browser context prompts a PIN.
  const pinModal = page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' });
  await expect(pinModal).toBeVisible();
  await pinModal.locator('input[type="password"]').fill('1234');
  await pinModal.locator('button', { hasText: 'Unlock' }).click();
  await expect(pinModal).not.toBeVisible();
}

test.describe('Explorer integration (/api/open-path)', () => {
  test('filed-document and vault-folder buttons both POST /api/open-path with 200', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();

    // Instance 1 — a project's vault folder (packageBar, no drawer needed).
    const openVaultBtn = page.locator('button', { hasText: 'Open vault folder' }).first();
    await expect(openVaultBtn).toBeVisible();
    const [vaultResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/open-path') && r.request().method() === 'POST'),
      openVaultBtn.click(),
    ]);
    expect(vaultResp.status()).toBe(200);

    // Instance 2 — a filed document inside the project drawer.
    await page.locator('#views .card.project-list-row', { hasText: 'NPI-9611' }).first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const openDocBtn = page.locator('#drawer button', { hasText: 'Open in Explorer' }).first();
    await expect(openDocBtn).toBeVisible({ timeout: 10000 });
    const [docResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/open-path') && r.request().method() === 'POST'),
      openDocBtn.click(),
    ]);
    expect(docResp.status()).toBe(200);

    expect(errors, 'no console/page errors during explorer actions').toEqual([]);
  });
});

test.describe('Dashboard PDF export', () => {
  test('Download PDF populates the print package without hanging or throwing', async ({ page }) => {
    test.setTimeout(45000);
    const errors = trackConsoleErrors(page);
    await boot(page); // Dashboard is the default tab.

    const pdfBtn = page.getByRole('button', { name: 'Download PDF', exact: true });
    await expect(pdfBtn).toBeVisible();

    // buildPrintPackage() populates #dashPrintPackage synchronously BEFORE it
    // calls window.print(). In headless Chromium print() is a no-op and returns
    // immediately; if it blocked instead, this click would stall to the test
    // timeout, which we treat as a hang finding rather than a fast fail.
    await pdfBtn.click();

    const info = await page.evaluate(() => {
      const c = document.getElementById('dashPrintPackage');
      return {
        exists: !!c,
        htmlLen: c ? c.innerHTML.length : -1,
        pages: c ? c.querySelectorAll('.print-page').length : 0,
      };
    });

    expect(info.exists, '#dashPrintPackage should exist after click').toBe(true);
    expect(info.htmlLen, 'print package should be populated').toBeGreaterThan(0);
    expect(info.pages, 'print package should contain at least one page').toBeGreaterThanOrEqual(1);

    expect(errors, 'no console/page errors during PDF export').toEqual([]);
  });
});

test.describe('Dashboard XLSX report downloads', () => {
  test('all five report types start a download with a non-empty filename', async ({ page }) => {
    test.setTimeout(180000);
    const errors = trackConsoleErrors(page);
    await boot(page);

    const sel = page.locator('#dashReportSelect');
    await expect(sel).toBeVisible();
    const rptBtn = page.getByRole('button', { name: 'Download', exact: true });

    const types = ['lfi', 'transfer', 'kpi', 'll', 'trial'];
    const filenames = [];
    for (const type of types) {
      await sel.selectOption(type);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        rptBtn.click(),
      ]);
      const name = download.suggestedFilename();
      filenames.push({ type, name });
      expect(name && name.length, `report "${type}" should download with a non-empty filename`).toBeGreaterThan(0);
    }
    console.log('XLSX download filenames:', JSON.stringify(filenames));

    expect(errors, 'no console/page errors during XLSX downloads').toEqual([]);
  });
});
