// @ts-check
const { test, expect } = require('@playwright/test');

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

test.describe('v7.0 editable target weeks', () => {
  test('Gate drawer shows a target-week editor that persists on Save', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row').first().click();
    await expect(page.locator('#drawer')).toBeVisible();

    const editor = page.locator('#drawer .target-week-editor').first();
    await expect(editor).toBeVisible();
    const input = editor.locator('input[type="week"]');
    await input.fill('2026-W40');
    await editor.locator('button', { hasText: 'Save' }).click();
    await expect(page.locator('#drawer')).toBeVisible();
    await expect(page.locator('#drawer .target-week-editor').first().locator('input[type="week"]')).toHaveValue('2026-W40');
  });
});

test.describe('v7.0 stage gate comments', () => {
  test('Gate Notes section accepts and displays a new comment', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row').first().click();
    await expect(page.locator('#drawer')).toBeVisible();

    const gateNotesBtn = page.locator('#drawer button', { hasText: /^Gate Notes/ });
    await expect(gateNotesBtn).toBeVisible();
    await gateNotesBtn.click();

    const thread = page.locator('#drawer .comment-thread');
    await expect(thread).toBeVisible();
    const testText = 'v7.0 Playwright test comment ' + Date.now();
    await thread.locator('.comment-add input').fill(testText);
    await thread.locator('.comment-add button', { hasText: 'Save' }).click();
    await expect(thread.locator('.comment-item', { hasText: testText })).toBeVisible();
  });
});

test.describe('v7.0 live Dashboard Gantt', () => {
  test('Gantt section renders rows with planned+actual bars and opens the drawer on click', async ({ page }) => {
    await boot(page);
    // Dashboard is the default tab.
    const ganttWrap = page.locator('.gantt-live-wrap');
    await expect(ganttWrap).toBeVisible();

    const rows = ganttWrap.locator('.gantt-live-row:not(.gantt-live-header)');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    const firstRow = rows.first();
    await expect(firstRow.locator('.gantt-bar-planned')).toBeVisible();
    // v8.0 segments the actual bar into one block per gated step, so
    // .gantt-bar-actual now matches N elements per row, not one.
    await expect(firstRow.locator('.gantt-bar-actual').first()).toBeVisible();

    await firstRow.click();
    await expect(page.locator('#drawer')).toBeVisible();
  });
});
