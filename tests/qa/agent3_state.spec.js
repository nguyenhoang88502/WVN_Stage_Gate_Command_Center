// @ts-check
const { test, expect } = require('@playwright/test');

/* Zero-Loss State Preservation Engine — QA Agent 3.
   Simulates an active editing session and verifies NOTHING is lost across a
   state-preserving reload (reloadPreservingState: capture -> refetch -> re-render -> restore). */

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

/* Trigger the state-preserving reload and wait for the bounded rAF restore
   loop (~30 frames) to finish settling. */
async function triggerReload(page) {
  await page.evaluate(() => reloadPreservingState());
  await page.waitForTimeout(900);
}

async function openFirstProjectDrawer(page) {
  await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
  const firstRow = page.locator('#views .card.project-list-row').first();
  await firstRow.click();
  await expect(page.locator('#drawer')).toBeVisible();
}

/* Some projects have every gate signed, so firstIncompleteStepOf() falls back
   to the last step (which is fully filed and has no dropzone). A `.dz-note-input`
   only renders on a step that still has a missing/on-going document, so walk
   every project row until we find one whose drawer exposes a dropzone note. */
async function findDrawerWithDzNote(page) {
  for (const tab of ['NPI', 'ECN']) {
    await page.locator('#tabs button', { hasText: new RegExp('^' + tab + ' ·') }).click();
    await page.waitForTimeout(200);
    const rows = page.locator('#views .card.project-list-row');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      await rows.nth(i).click();
      await page.waitForTimeout(250);
      if ((await page.locator('.dz-note-input').count()) > 0) return true;
      const closeBtn = page.locator('#drawer button', { hasText: /^Close$/ });
      if (await closeBtn.count()) { await closeBtn.first().click(); await page.waitForTimeout(150); }
    }
  }
  return false;
}

test.beforeEach(async ({ page }) => {
  await boot(page);
  await page.locator('#whoSelect').selectOption('admin');
  // The 15s auto-reload timer would interleave with our manual reloads.
  const autoChk = page.locator('#autoReloadChk');
  if ((await autoChk.count()) && (await autoChk.isChecked())) await autoChk.uncheck();
});

test.describe('zero-loss state preservation', () => {
  test('1. window scroll position survives reload', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(150);
    const before = await page.evaluate(() => window.scrollY);
    expect(before, 'page should actually be scrollable').toBeGreaterThan(100);

    await triggerReload(page);
    const after = await page.evaluate(() => window.scrollY);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('2. drawer stays open on same project+step, with scroll, text and caret preserved', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await openFirstProjectDrawer(page);

    // Identity: the drawer <h2> is "PROJECT_ID · step STEP_ID — NAME".
    const identityBefore = await page.locator('#drawer h2').first().textContent();

    // Type uncommitted text into the Executive note textarea, caret mid-string.
    // Focusing the textarea (at the drawer's bottom) also scrolls the drawer,
    // so capture the drawer scroll AFTER typing — the app captures the same
    // live position at reload time.
    const note = 'QA3 state test: decision pending review 2026-08-13';
    await page.evaluate((txt) => {
      const ta = document.getElementById('exNote');
      ta.focus();
      ta.value = txt;
      const start = Math.floor(txt.length / 2);
      ta.setSelectionRange(start, start + 4);
    }, note);
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => {
      const ta = document.getElementById('exNote');
      const d = document.getElementById('drawer');
      return { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, drawerScroll: d.scrollTop };
    });
    expect(before.drawerScroll, 'drawer should have scrolled to reveal the focused field').toBeGreaterThan(0);

    await triggerReload(page);

    const identityAfter = await page.locator('#drawer h2').first().textContent();
    expect(identityAfter).toBe(identityBefore);

    const after = await page.evaluate(() => {
      const ta = document.getElementById('exNote');
      const d = document.getElementById('drawer');
      return { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, drawerScroll: d.scrollTop };
    });
    expect(Math.abs(after.drawerScroll - before.drawerScroll)).toBeLessThanOrEqual(2);
    expect(after.value).toBe(before.value);
    expect(after.start).toBe(before.start);
    expect(after.end).toBe(before.end);
    expect(errors).toEqual([]);
  });

  test('3. dashboard multi-select slicer selection survives reload', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    // Dashboard is the default tab; slicers are under .dashboard-slicers.
    const famWrapper = page.locator('.dashboard-slicers .ms-wrapper').first();
    await expect(famWrapper.locator('.ms-label')).toHaveText('Family');

    await famWrapper.locator('.ms-trigger').click();
    await expect(famWrapper.locator('.ms-popover')).toBeVisible();
    await famWrapper.locator('.ms-option:not(.ms-option-all) input[type=checkbox]').first().check();
    await page.keyboard.press('Escape'); // commits + closes the popover

    const before = await page.evaluate(() => dashFamFilter.slice());
    expect(before.length).toBeGreaterThan(0);

    await triggerReload(page);

    const after = await page.evaluate(() => dashFamFilter.slice());
    expect(after).toEqual(before);
    // Visual confirmation: the trigger no longer shows the empty placeholder.
    const triggerText = await famWrapper.locator('.ms-trigger').textContent();
    expect(triggerText).not.toBe('All Families');
    expect(errors).toEqual([]);
  });

  test('4. focused element regains focus after reload', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await openFirstProjectDrawer(page);

    await page.evaluate(() => {
      const ta = document.getElementById('exNote');
      ta.focus();
      ta.value = 'focused-before-reload';
      ta.setSelectionRange(0, 0);
    });
    const focusedBefore = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(focusedBefore).toBe('exNote');

    await triggerReload(page);

    const focusedAfter = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(focusedAfter).toBe('exNote');
    expect(errors).toEqual([]);
  });

  test('5. uncommitted text in a dropzone note input survives reload', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const found = await findDrawerWithDzNote(page);
    test.skip(!found, 'no project drawer exposes a dropzone note input');

    const dz = page.locator('.dz-note-input').first();
    const uncommitted = 'QA3 uncommitted dropzone note (must survive reload)';
    await dz.fill(uncommitted);
    expect(await dz.inputValue()).toBe(uncommitted);

    await triggerReload(page);

    const after = await page.locator('.dz-note-input').first().inputValue();
    expect(after).toBe(uncommitted);
    expect(errors).toEqual([]);
  });
});
