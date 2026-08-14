// @ts-check
const { test, expect } = require('@playwright/test');

/* v9.1 (auto-reload file-preservation guard, type-in combobox for #npClass,
   Issue Date column in Claimed Work) — direct execution per this round's
   explicit override ("DIRECT EXECUTION AUTHORIZATION & OVERRIDE"), tested
   directly here rather than delegated. */

async function boot(page) {
  await page.goto('/');
  await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
}

async function loginAsAdmin(page) {
  await page.locator('#whoSelect').selectOption('admin');
  const pinModal = page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' });
  await expect(pinModal).toBeVisible();
  await pinModal.locator('input[type="password"]').fill('1234');
  await pinModal.locator('button', { hasText: 'Unlock' }).click();
  await expect(pinModal).not.toBeVisible();
}

test.describe('v9.1 auto-reload file-preservation guard', () => {
  test('a staged (picked, not yet imported) Batch Project CSV blocks userIsMidAction()', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();

    expect(await page.evaluate(() => userIsMidAction()), 'clean before staging').toBe(false);

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=Drop a project CSV here, or click to choose').click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles({ name: 'batch.csv', mimeType: 'text/csv', buffer: Buffer.from('family,process\n9999XX,NPI\n') });

    await expect(page.locator('.batch-file:not(.hide)')).toBeVisible();
    expect(await page.evaluate(() => userIsMidAction()), 'staged CSV blocks the guard').toBe(true);

    await page.locator('.batch-file button', { hasText: 'Clear' }).click();
    expect(await page.evaluate(() => userIsMidAction()), 'clearing the staged file unblocks the guard').toBe(false);
  });

  test('staged Batch Evidence rows block userIsMidAction()', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=Drop files here — several at once is fine — or click to choose').click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles({ name: 'v91-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('v9.1 test evidence') });

    await expect(page.locator('#bRows tr')).toHaveCount(1, { timeout: 10000 });
    expect(await page.evaluate(() => userIsMidAction()), 'staged batch evidence rows block the guard').toBe(true);

    const bRowsCount = await page.evaluate(() => document.getElementById('bRows').children.length);
    expect(bRowsCount).toBeGreaterThan(0);
  });

  test('window._isUploadingEvidence blocks userIsMidAction() while true', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => userIsMidAction())).toBe(false);
    await page.evaluate(() => { window._isUploadingEvidence = true; });
    expect(await page.evaluate(() => userIsMidAction())).toBe(true);
    await page.evaluate(() => { window._isUploadingEvidence = false; });
    expect(await page.evaluate(() => userIsMidAction())).toBe(false);
  });

  test('reloadPreservingState() is skipped while a batch CSV is staged', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=Drop a project CSV here, or click to choose').click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles({ name: 'batch2.csv', mimeType: 'text/csv', buffer: Buffer.from('family,process\n9998XX,NPI\n') });
    await expect(page.locator('.batch-file:not(.hide)')).toBeVisible();

    const restoreCalled = await page.evaluate(async () => {
      let called = false;
      const orig = restoreUiState;
      restoreUiState = function (...args) { called = true; return orig.apply(this, args); };
      await reloadPreservingState();
      restoreUiState = orig;
      return called;
    });
    expect(restoreCalled, 'restoreUiState is never reached while a CSV is staged').toBe(false);
    // The staged file itself must still be there — a torn-down/rebuilt Input
    // tab would have wiped it.
    await expect(page.locator('.batch-file:not(.hide)')).toBeVisible();
  });
});

test.describe('v9.1 type-in combobox for Change / project type', () => {
  test('#npClass is a free-text input backed by a datalist, not a <select>', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();
    const cls = page.locator('#npClass');
    await expect(cls).toHaveJSProperty('tagName', 'INPUT');
    await expect(cls).toHaveAttribute('list', 'classList');
    await expect(page.locator('#classList option')).not.toHaveCount(0);
  });

  test('typing a bare type_id ("A") submits class_abcde "A"', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();

    const famId = 'V91A' + Date.now().toString().slice(-6);
    await page.locator('#npFamId').fill(famId);
    await page.locator('#npClass').fill('A');
    await page.locator('#npClass').dispatchEvent('change');
    await expect(page.locator('.banner', { hasText: 'Packaging-Only Change' })).toBeVisible();

    /* The point of this test is that normaliseChangeTypeInput() feeds the
       right type_id into the POST body — not that a row lands on disk. The
       original version let the request through, and since there is no
       delete-project endpoint every suite run permanently accreted a junk
       NPI-V91A* project. Those projects are NOT STARTED and carry no
       PRF/target week, so they are never charted on the Gantt — which is
       exactly what broke v81.spec.js's `.first()` "NOT STARTED" selector.
       Intercepting the call proves the same thing and leaves no residue. */
    let posted = null;
    await page.route('**/api/projects', async (route) => {
      posted = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project_id: 'NPI-' + famId }),
      });
    });

    page.once('dialog', (d) => d.accept());
    await page.locator('button', { hasText: 'Register project' }).click();
    await expect.poll(() => posted, { timeout: 5000 }).not.toBeNull();

    expect(posted.class_abcde, 'typed "A" resolved to type_id A').toBe('A');
    expect(posted.family).toBe(famId);
    await page.unroute('**/api/projects');
  });

  test('typing "Type E - ECN" resolves to type_id E', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();
    await page.locator('#npClass').fill('Type E - ECN');
    await page.locator('#npClass').dispatchEvent('input');
    await expect(page.locator('.banner', { hasText: 'New Product Development (Seed Develop)' })).toBeVisible();
  });

  test('unrecognised free text is rejected at submit, not silently registered', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();

    const famId = 'V91BAD' + Date.now().toString().slice(-6);
    await page.locator('#npFamId').fill(famId);
    await page.locator('#npClass').fill('not a real type');
    await page.locator('#npClass').dispatchEvent('change');

    let dialogMessage = '';
    page.once('dialog', (d) => { dialogMessage = d.message(); d.accept(); });
    await page.locator('button', { hasText: 'Register project' }).click();
    await page.waitForTimeout(300);

    expect(dialogMessage, 'submit is rejected with an explanatory alert').toContain('not a real type');
    expect(dialogMessage).toContain('recognised');
  });
});

test.describe('v9.1 Issue Date column in Claimed Work', () => {
  test('a freshly raised, claimed issue shows today\'s date; the header carries an Issue Date column', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row').first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const marker = 'v9.1 issue-date test ' + Date.now();
    await page.locator('#drawer button', { hasText: /^Raise issue…$/ }).click();
    const raiseModal = page.locator('.modal-scrim .modal', { hasText: 'Raise Issue' });
    await expect(raiseModal).toBeVisible();
    await raiseModal.locator('textarea').fill(marker);
    await raiseModal.locator('button', { hasText: 'Raise Issue' }).click();
    await expect(raiseModal).not.toBeVisible();

    const row = page.locator('.claim-issue-row', { hasText: marker });
    await expect(row).toBeVisible();
    await row.locator('button', { hasText: /^Claim Task$/ }).click();
    await expect(row.locator('button', { hasText: /^Claimed by admin$/ })).toBeVisible({ timeout: 5000 });

    await page.locator('#drawer button', { hasText: /^Close$/ }).click();
    await page.locator('#tabs button', { hasText: /^Claimed Work$/ }).click();

    const table = page.locator('table').first();
    await expect(table.locator('th', { hasText: 'Issue Date' })).toBeVisible();

    const today = new Date().toISOString().slice(0, 10);
    const claimedRow = page.locator('.claimed-row', { hasText: marker });
    await expect(claimedRow).toBeVisible();
    await expect(claimedRow).toContainText(today);
  });

  test('every table row carries exactly as many <td> as the header has <th>', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await page.locator('#tabs button', { hasText: /^Claimed Work$/ }).click();

    const counts = await page.evaluate(() => {
      const table = document.querySelector('table');
      if (!table) return null;
      const thCount = table.querySelectorAll('thead th').length;
      const rowTdCounts = Array.from(table.querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td').length);
      return { thCount, rowTdCounts };
    });
    expect(counts, 'a table is rendered').not.toBeNull();
    expect(counts.thCount).toBeGreaterThan(0);
    for (const n of counts.rowTdCounts) {
      expect(n, 'row column count matches header column count').toBe(counts.thCount);
    }
  });
});
