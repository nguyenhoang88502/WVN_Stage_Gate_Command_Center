// @ts-check
/* Screenshot harness for the v9.2 UI work — not an assertion suite.
   Run with:  npx playwright test tests/shots.spec.js
   Output dir is set by SHOT_DIR (defaults to test-results/shots). */
const { test, expect } = require('@playwright/test');
const path = require('path');

/* Deliberately NOT under test-results/ — Playwright wipes that directory at
   the start of every run, so a baseline captured there is destroyed by the
   next test invocation. */
const DIR = process.env.SHOT_DIR || 'ui-shots';
const shot = (name) => path.join(DIR, name + '.png');

test.use({ viewport: { width: 1500, height: 950 } });

test('capture every workspace surface', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/');
  await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });

  await page.locator('#whoSelect').selectOption('admin');
  const pin = page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' });
  await expect(pin).toBeVisible();
  await pin.locator('input[type="password"]').fill('1234');
  await pin.locator('button', { hasText: 'Unlock' }).click();
  await expect(pin).not.toBeVisible();

  const tabs = [
    ['dashboard', /^Dashboard$/],
    ['claimed', /^Claimed Work$/],
    ['input', /^Input$/],
    ['npi', /^NPI ·/],
    ['ecn', /^ECN ·/],
    ['settings', /^Settings$/],
  ];

  for (const [name, rx] of tabs) {
    await page.locator('#tabs button', { hasText: rx }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot(name), fullPage: false });
  }

  // Drawer — the densest surface in the app, and the one people live in.
  await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
  await page.locator('#views .card.project-list-row').first().locator('b').click();
  await expect(page.locator('#drawer')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('drawer') });

  // Dark theme on the dashboard, since the token overrides differ there.
  await page.locator('#drawer button', { hasText: /^Close$/ }).click();
  await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
  await page.locator('#themeBtn').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('dashboard-dark') });
  await page.locator('#themeBtn').click();
});
