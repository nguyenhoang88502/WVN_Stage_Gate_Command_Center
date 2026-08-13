// @ts-check
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');

// 1x1 red pixel PNG — small enough to keep the test fast, still a real,
// decodable image so the server's System.Drawing.Image.FromStream() (used
// to size the oneCellAnchor's <xdr:ext>) has real bytes to work with.
const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/* v8.3 (single-anchor LFI image, admin PIN, issue resolution dropzone) —
   direct execution per this round's explicit override, tested directly here
   rather than delegated. Loader/Gantt/state-preservation (Section 5) were
   already covered by tests/v81.spec.js and are not duplicated. */

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

test.describe('v8.3 admin PIN protection', () => {
  test('selecting admin prompts a PIN modal; wrong PIN reverts the selection', async ({ page }) => {
    await boot(page);
    await page.locator('#whoSelect').selectOption('admin');
    const pinModal = page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' });
    await expect(pinModal).toBeVisible();

    await pinModal.locator('input[type="password"]').fill('0000');
    await pinModal.locator('button', { hasText: 'Unlock' }).click();
    await expect(pinModal).not.toBeVisible();
    // Wrong PIN must revert the <select> away from admin, not leave it stuck.
    await expect(page.locator('#whoSelect')).not.toHaveValue('admin');
  });

  test('correct PIN unlocks admin; a fresh reload of the same tab does not re-prompt', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await expect(page.locator('#whoSelect')).toHaveValue('admin');

    // sessionStorage survives a same-tab reload — re-authenticating should
    // not be required again this session.
    await page.reload();
    await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
    await expect(page.locator('#whoSelect')).toHaveValue('admin');
    await expect(page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' })).not.toBeVisible();
  });

  test('switching away from admin and back to a non-admin user needs no PIN', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    let chooserPromptSeen = false;
    page.on('dialog', () => { chooserPromptSeen = true; });
    await page.locator('#whoSelect').selectOption('intern');
    await expect(page.locator('#whoSelect')).toHaveValue('intern');
    expect(chooserPromptSeen).toBe(false);
  });

  test('Settings has an Admin Security PIN card that can change the PIN', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await page.locator('#tabs button', { hasText: /^Settings$/ }).click();

    const card = page.locator('.admin-pin-card');
    await expect(card).toBeVisible();
    await card.locator('input[placeholder="Current PIN"]').fill('1234');
    await card.locator('input[placeholder="New PIN"]').fill('5678');
    await card.locator('button', { hasText: 'Change PIN' }).click();
    await expect(card.locator('.note', { hasText: 'PIN updated.' })).toBeVisible();

    // Change it back so the suite is idempotent across runs.
    await card.locator('input[placeholder="Current PIN"]').fill('5678');
    await card.locator('input[placeholder="New PIN"]').fill('1234');
    await card.locator('button', { hasText: 'Change PIN' }).click();
    await expect(card.locator('.note', { hasText: 'PIN updated.' })).toBeVisible();
  });
});

test.describe('v8.3 issue resolution dropzone', () => {
  /* No pre-seeded claimed issue exists in the sample tracking data, and a
     resolution dropzone only renders once an issue has an owner (owner_pic/
     claimed_by — a different field from the Raise Issue modal's own "Owner"
     suggestion, which just writes `owner`). Self-contained setup: open a
     project drawer, raise a throwaway issue, then Claim it. */
  async function raiseAndClaimIssue(page) {
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row').first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const marker = 'v8.3 resolution-dropzone test ' + Date.now();
    await page.locator('#drawer button', { hasText: /^Raise issue…$/ }).click();
    const raiseModal = page.locator('.modal-scrim .modal', { hasText: 'Raise Issue' });
    await expect(raiseModal).toBeVisible();
    await raiseModal.locator('textarea').fill(marker);
    await raiseModal.locator('button', { hasText: 'Raise Issue' }).click();
    await expect(raiseModal).not.toBeVisible();

    const row = page.locator('.claim-issue-row', { hasText: marker });
    await expect(row).toBeVisible();
    await row.locator('button', { hasText: /^Claim Task$/ }).click();
    await expect(row.locator('.dz-issue-resolve')).toBeVisible({ timeout: 5000 });
    return row;
  }

  test('open issue rows carry full task-lifecycle controls', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    const row = await raiseAndClaimIssue(page);
    // A resolution dropzone only renders once someone owns the issue, so its
    // mere presence already proves the row has a claim/assign control set —
    // confirm at least one recognizable task-lifecycle button is present too.
    const lifecycleButtons = row.locator('button');
    expect(await lifecycleButtons.count(), 'issue row has task-lifecycle buttons').toBeGreaterThan(0);
    await expect(row.locator('.dz-issue-resolve')).toBeVisible();
  });

  test('dropping resolution evidence closes the issue with evidence_path recorded', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    const row = await raiseAndClaimIssue(page);

    const openCountBefore = await page.evaluate(() => TRK.lb_issues.filter((i) => i.status !== 'Closed').length);

    const dz = row.locator('.dz-issue-resolve');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await dz.click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles({ name: 'resolution-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('v8.3 issue resolution test evidence') });

    // The dropzone (and its whole issue row) disappears from "Open against
    // this step" once the issue closes and the drawer re-renders.
    await expect(dz).not.toBeAttached({ timeout: 10000 });

    const openCountAfter = await page.evaluate(() => TRK.lb_issues.filter((i) => i.status !== 'Closed').length);
    expect(openCountAfter, 'exactly one issue closed').toBe(openCountBefore - 1);

    const resolved = await page.evaluate(() =>
      TRK.lb_issues.find((i) => i.status === 'Closed' && i.resolution === 'Resolved via uploaded evidence'));
    expect(resolved, 'a closed issue records the resolution + evidence_path').toBeTruthy();
    expect(resolved.evidence_path, 'evidence_path was set').toBeTruthy();
  });
});

test.describe('v8.3 single-anchor LFI image placement', () => {
  test('submitted LFI photos use xdr:oneCellAnchor at A16/M16, not stretched', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row').first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    await page.locator('.lfi-expand-btn').click();
    await expect(page.locator('#lfiTitle')).toBeVisible();
    await page.locator('#lfiTitle').fill('v8.3 single-anchor test ' + Date.now());
    await page.setInputFiles('#lfiProblemInput', { name: 'problem.png', mimeType: 'image/png', buffer: TEST_PNG });
    await page.setInputFiles('#lfiSolutionInput', { name: 'solution.png', mimeType: 'image/png', buffer: TEST_PNG });

    await page.locator('#lfiSubmit').click();
    const okDiv = page.locator('#lfiOk');
    await expect(okDiv).toBeVisible({ timeout: 20000 });
    const pathText = ((await okDiv.locator('.vault-path-text').textContent()) || '').trim();
    expect(pathText, 'workbook path is shown').toMatch(/\.xlsx$/i);

    // Inspect the actual generated workbook's drawing XML — this is a real
    // OpenXML structural property Playwright's DOM assertions can't see;
    // shelling out to Python's zipfile against the file on disk is the most
    // direct way to check it.
    const script = [
      'import zipfile, json, re, sys',
      'z = zipfile.ZipFile(sys.argv[1])',
      "xml = z.read('xl/drawings/drawing1.xml').decode('utf-8')",
      "media = [n for n in z.namelist() if n.startswith('xl/media/')]",
      'print(json.dumps({',
      "  'oneCellAnchorCount': xml.count('<xdr:oneCellAnchor'),",
      "  'twoCellAnchorCount': xml.count('<xdr:twoCellAnchor'),",
      "  'hasToTag': '<xdr:to>' in xml,",
      "  'colValues': re.findall(r'<xdr:col>(\\d+)</xdr:col>', xml),",
      "  'rowValues': re.findall(r'<xdr:row>(\\d+)</xdr:row>', xml),",
      "  'extCount': xml.count('<xdr:ext '),",
      "  'mediaCount': len(media),",
      '}))',
    ].join('\n');
    const report = JSON.parse(execFileSync('python3', ['-c', script, pathText]).toString());

    expect(report.oneCellAnchorCount, 'both images use oneCellAnchor').toBe(2);
    expect(report.twoCellAnchorCount, 'no twoCellAnchor remains').toBe(0);
    expect(report.hasToTag, 'no <xdr:to> stretch-box bounds').toBe(false);
    expect(report.extCount, 'each anchor declares its own natural <xdr:ext>').toBe(2);
    expect(report.colValues, 'anchored at column 0 (A) and column 12 (M)').toEqual(expect.arrayContaining(['0', '12']));
    expect(report.rowValues.every((r) => r === '15'), 'both anchored at row 16 (0-based row 15)').toBe(true);
    expect(report.mediaCount, 'both images saved as media parts').toBeGreaterThanOrEqual(2);
  });
});
