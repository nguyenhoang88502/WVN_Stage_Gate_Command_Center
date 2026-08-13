// @ts-check
const { test, expect } = require('@playwright/test');

/* QA Agent 4 — User Registry, Modals & Settings.
   Every "type a name" input used to be a native prompt()/confirm(). It must
   now be a DOM <select> modal populated from CFG.user_registry. The strongest
   proof a native dialog is gone is a page.on('dialog') guard: if prompt()/
   confirm()/alert() ever fires, the guard records it and the test FAILS. */

function trackConsoleErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/* Authoritative native-dialog guard. Returns the array of fired dialog types
   (plus message text) so an assertion can fail with the exact offender. */
function guardDialogs(page) {
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type() + ': ' + (d.message() || ''));
    d.dismiss().catch(() => {});
  });
  return dialogs;
}

async function boot(page) {
  await page.goto('/');
  await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
}

async function openFirstProjectDrawer(page) {
  await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
  const firstRow = page.locator('#views .card.project-list-row').first();
  await firstRow.click();
  await expect(page.locator('#drawer')).toBeVisible();
}

/* The header #whoSelect is the canonical registry view. Its option *values*
   are the usernames (admin, intern, qa, Diem Pham, Hoang, Khoi Le). */
async function headerNames(page) {
  return page.locator('#whoSelect option').evaluateAll((opts) => opts.map((o) => o.value));
}

/* Option values of a given <select>, minus any leading "(none)" blank. */
async function selectValues(selectLocator) {
  return selectLocator.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter((v) => v !== ''));
}

test.beforeEach(async ({ page }) => {
  await boot(page);
  await page.locator('#whoSelect').selectOption('admin');
  // v8.3 Section 4: first switch to admin per browser context prompts a PIN
  // (a custom DOM modal, not a native dialog — guardDialogs below is unaffected).
  const pinModal = page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' });
  await expect(pinModal).toBeVisible();
  await pinModal.locator('input[type="password"]').fill('1234');
  await pinModal.locator('button', { hasText: 'Unlock' }).click();
  await expect(pinModal).not.toBeVisible();
});

test.describe('user-registry-backed username inputs (zero native dialogs)', () => {
  test('1. Assign Task opens a registry <select> modal, no prompt()', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const dialogs = guardDialogs(page);
    const names = await headerNames(page);
    await openFirstProjectDrawer(page);

    const assignBtn = page.locator('#drawer .claim-row button', { hasText: 'Assign Task' }).first();
    await assignBtn.click();

    const modal = page.locator('.modal', { hasText: 'Assign Task' });
    await expect(modal).toBeVisible();
    const sel = modal.locator('select');
    await expect(sel).toBeVisible();
    expect(await selectValues(sel)).toEqual(names); // same users as header
    await expect(modal.locator('input[type=radio][value=owner]')).toBeChecked();

    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    expect(dialogs, 'no native prompt()/confirm()/alert() fired').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('2. Edit Assignment opens a two-select registry modal, no prompt()', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const dialogs = guardDialogs(page);
    const names = await headerNames(page);
    await openFirstProjectDrawer(page);

    const editBtn = page.locator('#drawer .claim-row button', { hasText: 'Edit Assignment' }).first();
    await editBtn.click();

    const modal = page.locator('.modal', { hasText: 'Edit Assignment' });
    await expect(modal).toBeVisible();
    const selects = modal.locator('select');
    await expect(selects).toHaveCount(2);
    expect(await selectValues(selects.nth(0))).toEqual(names);
    expect(await selectValues(selects.nth(1))).toEqual(names);

    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    expect(dialogs, 'no native prompt()/confirm()/alert() fired').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('3. Remove Owner: assign then remove, no native confirm(), UI updates', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const dialogs = guardDialogs(page);
    await openFirstProjectDrawer(page);

    // Assign the gate to a non-admin user via the DOM modal.
    const gateClaim = () => page.locator('#drawer .claim-row').first();
    await gateClaim().locator('button', { hasText: 'Assign Task' }).click();
    const assignModal = page.locator('.modal', { hasText: 'Assign Task' });
    await expect(assignModal).toBeVisible();
    await assignModal.locator('select').selectOption('intern');
    await assignModal.locator('button', { hasText: 'Assign' }).click();

    // The drawer rebuilds; the gate now has an owner, so "Remove Owner" appears.
    const removeBtn = gateClaim().locator('button', { hasText: 'Remove Owner' });
    await expect(removeBtn).toBeVisible({ timeout: 10000 });

    // Remove Owner must use the DOM confirmModal, NOT a native confirm().
    await removeBtn.click();
    const confirmModal = page.locator('.modal', { hasText: 'Remove Owner' });
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal.locator('button', { hasText: 'Remove' })).toBeVisible();
    await confirmModal.locator('button', { hasText: 'Remove' }).click();

    // Owner cleared: the "Remove Owner" button is gone and the claim button
    // reverts to the unowned "Claim Task" label.
    await expect(gateClaim().locator('button', { hasText: 'Claim Task' })).toBeVisible({ timeout: 10000 });
    await expect(gateClaim().locator('button', { hasText: 'Remove Owner' })).toHaveCount(0);
    await expect(gateClaim().locator('span.claim-badge', { hasText: 'Owner:' })).toHaveCount(0);

    expect(dialogs, 'no native prompt()/confirm()/alert() fired').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('4. Raise Issue Owner field is a registry <select>, no prompt() chain', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const dialogs = guardDialogs(page);
    const names = await headerNames(page);
    await openFirstProjectDrawer(page);

    await page.locator('#drawer button', { hasText: 'Raise issue' }).first().click();

    const modal = page.locator('.modal', { hasText: 'Raise Issue' });
    await expect(modal).toBeVisible();
    await expect(modal.locator('textarea').first()).toBeVisible();
    // First <select> in the modal is the Owner field (Severity is second).
    const ownerSel = modal.locator('select').first();
    await expect(ownerSel).toBeVisible();
    expect(await selectValues(ownerSel)).toEqual(names);

    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    expect(dialogs, 'no native prompt()/confirm()/alert() fired').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('5. LFI Author field is a registry <select>, no prompt()', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const dialogs = guardDialogs(page);
    const names = await headerNames(page);
    await openFirstProjectDrawer(page);

    await page.locator('#drawer button.lfi-expand-btn').click();
    await expect(page.locator('#lfiAuthor')).toBeVisible();

    const author = page.locator('#lfiAuthor');
    expect(await author.evaluate((el) => el.tagName.toLowerCase())).toBe('select');
    expect(await selectValues(author)).toEqual(names);

    expect(dialogs, 'no native prompt()/confirm()/alert() fired').toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('settings document-types "Show more"/"Show less" toggle', () => {
  test('6. toggle reveals and re-hides doctype cards beyond the 8th', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const dialogs = guardDialogs(page);
    await page.locator('#tabs button', { hasText: 'Settings' }).click();

    const cards = page.locator('.doctype-card');
    const total = await cards.count();
    expect(total, 'registry should have more than 8 document types').toBeGreaterThan(8);

    const hiddenSel = page.locator('.doctype-card.taglist-hidden');
    expect(await hiddenSel.count()).toBe(total - 8); // all beyond the 8th are hidden

    // Visually: 1st card visible, 9th (index 8) hidden.
    await expect(cards.nth(0)).toBeVisible();
    await expect(cards.nth(8)).toBeHidden();

    const toggle = page.locator('button', { hasText: /Show more|Show less/ }).first();
    await expect(toggle).toBeVisible();

    // Expand.
    await toggle.click();
    await expect(page.locator('button', { hasText: 'Show less' }).first()).toBeVisible();
    expect(await page.locator('.doctype-card.taglist-hidden').count()).toBe(0);
    await expect(cards.nth(8)).toBeVisible();

    // Collapse again.
    await page.locator('button', { hasText: 'Show less' }).first().click();
    await expect(page.locator('button', { hasText: 'Show more' }).first()).toBeVisible();
    expect(await page.locator('.doctype-card.taglist-hidden').count()).toBe(total - 8);
    await expect(cards.nth(8)).toBeHidden();

    expect(dialogs, 'no native prompt()/confirm()/alert() fired').toEqual([]);
    expect(errors).toEqual([]);
  });
});
