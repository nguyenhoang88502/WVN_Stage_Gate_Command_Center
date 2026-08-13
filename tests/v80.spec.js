// @ts-check
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('/');
  await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
  await page.locator('#whoSelect').selectOption('admin');
}

test.describe('v8.0 dropzone event isolation & inline notes', () => {
  test('typing a dropzone note and clicking Save Note does not open a file chooser', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    // A COMPLETE project's default step has nothing left to file — no .dz
    // renders at all. NOT STARTED guarantees an open dropzone to test against.
    // Click the project-id label, not the row's bounding-box center — for
    // NOT STARTED rows the "Download transfer package" button sits in that
    // center, and the row's own onclick correctly declines to open the
    // drawer for clicks inside a button (e.target.closest('button')).
    await page.locator('#views .card.project-list-row', { hasText: 'NOT STARTED' }).first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const dz = page.locator('#drawer .dz').first();
    await expect(dz).toBeVisible();
    const noteInput = dz.locator('.dz-note-input');
    await expect(noteInput).toBeVisible();

    let chooserFired = false;
    page.once('filechooser', () => { chooserFired = true; });

    const testText = 'v8.0 dz note ' + Date.now();
    await noteInput.fill(testText);
    await dz.locator('.dz-note-add button', { hasText: 'Save Note' }).click();
    await expect(dz.locator('.comment-item', { hasText: testText })).toBeVisible();
    await page.waitForTimeout(300);
    expect(chooserFired).toBe(false);
  });

  test('clicking the target-week Save button inside a dropzone does not open a file chooser', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    // Click the project-id label, not the row's bounding-box center — for
    // NOT STARTED rows the "Download transfer package" button sits in that
    // center, and the row's own onclick correctly declines to open the
    // drawer for clicks inside a button (e.target.closest('button')).
    await page.locator('#views .card.project-list-row', { hasText: 'NOT STARTED' }).first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const dz = page.locator('#drawer .dz').first();
    const editor = dz.locator('.target-week-editor');
    await expect(editor).toBeVisible();

    let chooserFired = false;
    page.once('filechooser', () => { chooserFired = true; });

    await editor.locator('button', { hasText: 'Save' }).click();
    await page.waitForTimeout(300);
    expect(chooserFired).toBe(false);
  });

  test('deliverable dropzone target-week value persists after Save (does not revert to blank)', async ({ page }) => {
    // Regression test for a bug the DeepSeek QA swarm found: makeTargetWeekEditor's
    // Save handler skipped refreshSilently() before its onAfterSave callback
    // re-rendered the drawer, so the just-written value read back from stale
    // in-memory tracking data and appeared blank (it was never actually lost
    // on disk, just not yet reflected in memory).
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row', { hasText: 'NOT STARTED' }).first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const dz = page.locator('#drawer .dz').first();
    const editor = dz.locator('.target-week-editor');
    await expect(editor).toBeVisible();
    const input = editor.locator('input[type="week"]');
    await input.fill('2026-W44');
    await editor.locator('button', { hasText: 'Save' }).click();
    await expect(page.locator('#drawer .dz').first().locator('.target-week-editor input[type="week"]')).toHaveValue('2026-W44');
  });
});

test.describe('v8.0 Gantt stage segmentation', () => {
  test('Gantt bars render per-stage segments with labels, separators, and per-segment drawer navigation', async ({ page }) => {
    await boot(page);
    const ganttWrap = page.locator('.gantt-live-wrap');
    await expect(ganttWrap).toBeVisible();

    const firstRow = ganttWrap.locator('.gantt-live-row:not(.gantt-live-header)').first();
    const segs = firstRow.locator('.gantt-stage-seg');
    const segCount = await segs.count();
    expect(segCount).toBeGreaterThan(0);
    await expect(segs.first().locator('.gantt-stage-label')).toBeVisible();

    if (segCount > 1) {
      await expect(firstRow.locator('.gantt-stage-separator').first()).toBeAttached();
    }

    await segs.first().click();
    await expect(page.locator('#drawer')).toBeVisible();
  });
});
