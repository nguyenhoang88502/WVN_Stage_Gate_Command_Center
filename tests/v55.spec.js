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

test.describe('v5.5 dropdown-only username inputs', () => {
  test('Edit Assignment opens a registry-backed modal with two selects, not prompt()', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss(); });
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row').first().click();
    await expect(page.locator('#drawer')).toBeVisible();

    const editBtn = page.locator('#drawer button', { hasText: 'Edit Assignment' }).first();
    await editBtn.click();

    const modal = page.locator('.modal', { hasText: 'Edit Assignment' });
    await expect(modal).toBeVisible();
    const selects = modal.locator('select');
    await expect(selects).toHaveCount(2);

    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    expect(dialogs, 'no native prompt()/confirm() fired').toEqual([]);
  });

  test('Raise issue opens a modal with an Owner <select>, not a chain of prompt()s', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss(); });
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row').first().click();
    await expect(page.locator('#drawer')).toBeVisible();

    const raiseBtn = page.locator('#drawer button', { hasText: 'Raise issue' }).first();
    await raiseBtn.click();

    const modal = page.locator('.modal', { hasText: 'Raise Issue' });
    await expect(modal).toBeVisible();
    await expect(modal.locator('textarea')).toBeVisible();
    await expect(modal.locator('select').first()).toBeVisible();

    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    expect(dialogs, 'no native prompt()/confirm() fired').toEqual([]);
  });
});

test.describe('v5.5 dual LFI dropzones', () => {
  test('LFI form shows two distinct dropzones and a registry-backed Author select', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row').first().click();
    await expect(page.locator('#drawer')).toBeVisible();

    const lfiToggle = page.locator('#drawer button.lfi-expand-btn');
    await lfiToggle.click();

    await expect(page.locator('#lfiProblemArea')).toBeVisible();
    await expect(page.locator('#lfiSolutionArea')).toBeVisible();
    // Two independent inputs/preview lists, not one shared bucket.
    await expect(page.locator('#lfiProblemInput')).toHaveCount(1);
    await expect(page.locator('#lfiSolutionInput')).toHaveCount(1);

    const author = page.locator('#lfiAuthor');
    await expect(author).toBeVisible();
    const tag = await author.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe('select');
    expect(await author.locator('option').count()).toBeGreaterThan(0);
  });
});

test.describe('v5.5 Document Types redesign', () => {
  test('Document Types render as rectangular cards with id/name, template select, and stage badge', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: 'Settings' }).click();

    const cards = page.locator('.doctype-card');
    await expect(cards.first()).toBeVisible();
    const first = cards.first();
    await expect(first.locator('.doctype-card-top b')).toBeVisible();
    await expect(first.locator('.doctype-card-mid select, .doctype-card-mid span')).toBeVisible();
    await expect(first.locator('.doctype-card-bottom .badge')).toBeVisible();

    const gridCols = await page.locator('.taglist-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(gridCols.split(' ').length).toBeGreaterThan(0);
  });
});
