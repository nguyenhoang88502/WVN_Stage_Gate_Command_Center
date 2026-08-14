// @ts-check
const { test, expect } = require('@playwright/test');

/*
 * Agent 1 — Dropzone Isolation & Event Propagation.
 *
 * The bug this guards against (system/app.js:3232) is a `.dz` click bubbling
 * out of an interactive child (button / <a> template link / target-week input /
 * note input) into the dropzone's own onclick, which appends a hidden
 * <input type=file> and .click()s it — opening a native OS file picker.
 *
 * Every negative test attaches a `filechooser` listener BEFORE the click and
 * asserts it never fired. The final test flips it and asserts the plain
 * background label of an empty dropzone DOES still open the picker (the
 * intended behaviour).
 */

async function boot(page) {
  /* v9.2.1: the app defaults to Vietnamese. Every #tabs button selector in
     this suite matches English labels, so pin the language before the app
     boots rather than making each assertion locale-aware. */
  await page.addInitScript(() => { try { localStorage.setItem('wvn_lang', 'en'); } catch (e) { } });
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

// Opens the first NOT-STARTED NPI project's drawer and returns the first
// unlocked (fileable) dropzone. "NOT STARTED" guarantees an open dz.
async function openFirstOpenDropzone(page) {
  await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
  await page.locator('#views .card.project-list-row', { hasText: 'NOT STARTED' })
    .first().locator('b').click();
  await expect(page.locator('#drawer')).toBeVisible();
  const dz = page.locator('#drawer .dz:not(.dz-locked)').first();
  await expect(dz).toBeVisible();
  return dz;
}

// Runs `action` while listening for a filechooser; returns true if one fired.
async function chooserFiredDuring(page, action) {
  let fired = false;
  page.once('filechooser', () => { fired = true; });
  await action();
  await page.waitForTimeout(250);
  return fired;
}

// If a modal (confirm / assign / user-registry picker) is open, close it via
// its Cancel button. Returns true if a modal was dismissed.
async function dismissModal(page) {
  const cancel = page.locator('.modal-scrim .modal button', { hasText: 'Cancel' });
  if (await cancel.count()) {
    await cancel.first().click();
    await expect(page.locator('.modal-scrim')).toHaveCount(0, { timeout: 3000 });
    return true;
  }
  return false;
}

test.describe('agent1: dropzone isolation & event propagation', () => {
  test('note input + Save Note writes a comment and does not open a file chooser', async ({ page }) => {
    await boot(page);
    const dz = await openFirstOpenDropzone(page);

    const noteInput = dz.locator('.dz-note-input');
    await expect(noteInput).toBeVisible();
    const text = 'agent1 dz note ' + Date.now();

    const fired = await chooserFiredDuring(page, async () => {
      await noteInput.fill(text);
      await dz.locator('.dz-note-add button', { hasText: 'Save Note' }).click();
    });

    await expect(dz.locator('.comment-item', { hasText: text })).toBeVisible();
    expect(fired, 'Save Note must not open a file chooser').toBe(false);
  });

  test('target-week input + Save does not open a file chooser', async ({ page }) => {
    await boot(page);
    const dz = await openFirstOpenDropzone(page);

    const editor = dz.locator('.target-week-editor');
    await expect(editor).toBeVisible();

    // Both filling the week input and clicking Save must stay inside the
    // guard's `.target-week-editor` / `input` / `button` selectors and never
    // fall through to the dropzone's file input.
    const fired = await chooserFiredDuring(page, async () => {
      await editor.locator('input[type="week"]').fill('2026-W40');
      await editor.locator('button', { hasText: 'Save' }).click();
    });

    await expect(page.locator('#drawer')).toBeVisible();
    expect(fired, 'target-week input/Save must not open a file chooser').toBe(false);
  });

  test('every button control in a dropzone is isolated from the file picker', async ({ page }) => {
    await boot(page);
    const dz = await openFirstOpenDropzone(page);

    // Modal-opening buttons first (dismissed without confirming), so the
    // claim button — which mutates missing -> on-going — runs last and cannot
    // disturb the presence of the others.
    const modalButtons = [
      { name: 'Assign Task', regex: /^Assign Task$/ },
      { name: 'Edit Assignment', regex: /^Edit Assignment$/ },
      { name: 'Remove Owner', regex: /^Remove Owner$/ },
      { name: 'Remove Supporter', regex: /^Remove Supporter$/ },
      { name: 'Delete Task', regex: /^Delete Task$/ },
      { name: 'Mark as not applicable', regex: /^Mark as not applicable$/ },
    ];

    for (const c of modalButtons) {
      const btn = dz.locator('button', { hasText: c.regex });
      if (!(await btn.count())) continue; // not rendered in this state
      const fired = await chooserFiredDuring(page, async () => {
        await btn.first().click();
        await page.waitForTimeout(150);
      });
      expect(fired, `${c.name} must not open a file chooser`).toBe(false);
      // Confirm the button actually did something (opened its DOM modal), not
      // silently no-op'd while also (correctly) avoiding the picker.
      await expect(page.locator('.modal-scrim')).toBeVisible();
      await dismissModal(page);
    }

    // Claim button (or its claimed/assigned label) — a direct write, no modal.
    const claim = dz.locator('button', { hasText: /Claim Task|Claimed by|Assigned to/ });
    if (await claim.count()) {
      const fired = await chooserFiredDuring(page, async () => {
        await claim.first().click();
      });
      expect(fired, 'claim button must not open a file chooser').toBe(false);
    }
  });

  test('Download Blank Template link does not open a file chooser', async ({ page }) => {
    await boot(page);
    // NPI step 1 (Project Planning) has no templated docs, but ECN step 1
    // requires ECR, which has a template file. Open the first NOT-STARTED ECN
    // project to reach a real template link.
    await page.locator('#tabs button', { hasText: /^ECN ·/ }).click();
    await page.locator('#views .card.project-list-row', { hasText: 'NOT STARTED' })
      .first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const link = page.locator('#drawer .dz:not(.dz-locked) a.dz-template-btn').first();
    if (!(await link.count())) {
      test.skip(true, 'no template-enabled dropzone reachable in this state');
      return;
    }
    await expect(link).toBeVisible();

    const fired = await chooserFiredDuring(page, async () => {
      // A <a download> triggers a download, not navigation; swallow it.
      const dl = page.waitForEvent('download', { timeout: 2500 }).catch(() => null);
      await link.click();
      await dl;
    });
    expect(fired, 'template link must not open a file chooser').toBe(false);
  });

  test('Remove Owner / Remove Supporter buttons (when a claimed dropzone exists) are isolated', async ({ page }) => {
    await boot(page);
    // These only render once a deliverable already has an owner/supporter, so
    // this test depends on an earlier run having claimed one. Best-effort.
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row', { hasText: 'NOT STARTED' })
      .first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const removeOwner = page.locator('#drawer .dz button', { hasText: /^Remove Owner$/ });
    const removeSupporter = page.locator('#drawer .dz button', { hasText: /^Remove Supporter$/ });
    if (!(await removeOwner.count()) && !(await removeSupporter.count())) {
      test.skip(true, 'no claimed dropzone exposes Remove Owner/Supporter in this state');
      return;
    }

    for (const btn of [removeOwner, removeSupporter]) {
      if (!(await btn.count())) continue;
      const fired = await chooserFiredDuring(page, async () => {
        await btn.first().click();
        await page.waitForTimeout(150);
      });
      expect(fired, 'Remove Owner/Supporter must not open a file chooser').toBe(false);
      await expect(page.locator('.modal-scrim')).toBeVisible();
      await dismissModal(page);
    }
  });

  test('clicking the plain label/background of a dropzone DOES open the file picker', async ({ page }) => {
    await boot(page);
    const dz = await openFirstOpenDropzone(page);

    // The <b> document name is plain label text, not in the guard's
    // `button, a, input, ...` list, so it must fall through to the file input.
    const label = dz.locator('b').first();
    await expect(label).toBeVisible();

    const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await label.click();
    await chooserPromise; // resolves only if the picker actually opened
  });
});
