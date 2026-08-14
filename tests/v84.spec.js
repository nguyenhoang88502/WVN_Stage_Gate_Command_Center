// @ts-check
const { test, expect } = require('@playwright/test');

/* v8.4 (gate-approval Cancel fix, scroll-jump elimination, atomic state
   preservation race fix, multi-file dropzone isolation) — direct execution
   was NOT authorized for this round (no override text in the spec), so all
   four fixes were dispatched to the DeepSeek worker per the standing
   delegation rule; this file is Claude's own regression coverage, written
   directly, same as every prior round's *.spec.js files. */

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

// NPI-9611 (the very first project row) has every gate already signed and
// every document already filed, so it renders neither an "Approve step"
// button nor an open dropzone. A "NOT STARTED" project's current step still
// has an unsigned gate and every required doc missing — exactly the state
// the Cancel-bug and multi-file-dropzone fixes need to exercise.
async function openNotStartedProjectDrawer(page) {
  await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
  await page.locator('#views .card.project-list-row', { hasText: 'NOT STARTED' }).first().locator('b').click();
  await expect(page.locator('#drawer')).toBeVisible();
}

test.describe('v8.4 gate approval Cancel bug fix', () => {
  /* The "Approve step" button is disabled (g.canApprove === false) unless the
     sample data happens to have every mandatory document filed for that step,
     which isn't guaranteed. The Cancel-handling bug lives entirely in the
     onclick handler's own logic (it never re-checks canApprove), so forcing
     the button enabled for the click is a valid, deterministic way to
     exercise exactly the code path that changed, regardless of what state
     the sample data is in. */
  async function findAndEnableApproveButton(page) {
    const btn = page.locator('#drawer button', { hasText: /^Approve step \d+$/ }).first();
    await expect(btn).toBeAttached({ timeout: 10000 });
    await btn.evaluate((b) => { b.disabled = false; });
    return btn;
  }

  test('clicking Cancel on the comment prompt does NOT approve the gate', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await openNotStartedProjectDrawer(page);
    const btn = await findAndEnableApproveButton(page);

    const approvalsBefore = await page.evaluate(() => TRK.lb_approvals.length);
    let postFired = false;
    page.on('requestfinished', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/action')) postFired = true;
    });
    page.once('dialog', (d) => d.dismiss());
    await btn.click();
    // Give any (incorrect) fire-and-forget POST a moment to show up.
    await page.waitForTimeout(800);

    expect(postFired, 'no /api/action POST fired after Cancel').toBe(false);
    const approvalsAfter = await page.evaluate(() => TRK.lb_approvals.length);
    expect(approvalsAfter, 'lb_approvals row count unchanged after Cancel').toBe(approvalsBefore);
    // The button must still be present/clickable — no broken state left behind.
    await expect(page.locator('#drawer button', { hasText: /^Approve step \d+$/ }).first()).toBeAttached();
  });

  test('clicking OK on the comment prompt still approves the gate', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await openNotStartedProjectDrawer(page);
    const btn = await findAndEnableApproveButton(page);

    const approvalsBefore = await page.evaluate(() => TRK.lb_approvals.length);
    page.once('dialog', (d) => d.accept('v8.4 regression test approval'));
    const [resp] = await Promise.all([
      // The handler fires lb_approvals then lb_gates then redraw()'s own
      // refreshSilently() — matching the first /api/action POST only proves
      // the approve call started, not that TRK has caught up yet, so the
      // count check below polls rather than racing a fixed timeout.
      page.waitForResponse((r) => r.url().includes('/api/action') && r.request().method() === 'POST'),
      btn.click(),
    ]);
    expect(resp.status()).toBe(200);
    await expect.poll(() => page.evaluate(() => TRK.lb_approvals.length), {
      timeout: 5000,
      message: 'lb_approvals grew by exactly one after OK',
    }).toBe(approvalsBefore + 1);
  });
});

test.describe('v8.4 multi-file dropzone isolation', () => {
  test('dropping several files on one dropzone uploads all of them in a single batch redraw', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await openNotStartedProjectDrawer(page);

    const dz = page.locator('#drawer .dz[data-doc-code]:not(.dz-locked)').first();
    await expect(dz).toBeAttached({ timeout: 10000 });
    const docCode = await dz.getAttribute('data-doc-code');

    const deliverablesBefore = await page.evaluate(
      (code) => TRK.lb_deliverables.filter((d) => d.doc_code === code && d.status === 'Filed').length,
      docCode
    );

    // Native OS drag-and-drop can't be simulated by Playwright, and Chromium
    // zeroes out dataTransfer.files on a script-constructed DragEvent even
    // when items were added via DataTransfer.items.add() (a sandboxing
    // measure, confirmed by an earlier run of this test: the drop fired but
    // 0 files ever reached the handler). dz.ondrop was assigned as a plain
    // property (not addEventListener), so it can be grabbed and invoked
    // directly with a fully-controlled fake event — same production code
    // path, deterministic, no browser drag sandboxing involved.
    await dz.evaluate(async (node) => {
      const file1 = new File(['v8.4 evidence A'], 'evidence-a.txt', { type: 'text/plain' });
      const file2 = new File(['v8.4 evidence B'], 'evidence-b.txt', { type: 'text/plain' });
      await node.ondrop({ preventDefault: () => {}, dataTransfer: { files: [file1, file2] } });
    });

    // Both uploads complete and the single end-of-batch redraw lands.
    await expect(page.locator('#drawer')).toBeVisible({ timeout: 15000 });

    await expect.poll(() => page.evaluate(
      (code) => TRK.lb_deliverables.filter((d) => d.doc_code === code && d.status === 'Filed').length,
      docCode
    ), { timeout: 5000, message: 'both dropped files were filed as deliverables' }).toBe(deliverablesBefore + 2);

    const deliverablesAfter = await page.evaluate(
      (code) => TRK.lb_deliverables.filter((d) => d.doc_code === code && d.status === 'Filed').length,
      docCode
    );

    const names = await page.evaluate(
      (code) => TRK.lb_deliverables.filter((d) => d.doc_code === code && d.status === 'Filed').map((d) => d.original_name || d.file_name),
      docCode
    );
    expect(names.some((n) => n && n.includes('evidence-a'))).toBe(true);
    expect(names.some((n) => n && n.includes('evidence-b'))).toBe(true);
  });
});

test.describe('v8.4 scroll-jump elimination', () => {
  test('reloadPreservingState() never snaps the page to (0,0)', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);

    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(100);

    const calls = await page.evaluate(async () => {
      const captured = [];
      const orig = window.scrollTo.bind(window);
      window.scrollTo = function (x, y) { captured.push([x, y]); return orig(x, y); };
      try {
        await reloadPreservingState();
      } finally {
        window.scrollTo = orig;
      }
      return captured;
    });

    const snappedToTop = calls.some(([x, y]) => x === 0 && y === 0);
    expect(snappedToTop, 'window.scrollTo(0, 0) was never called during a background reload: ' + JSON.stringify(calls)).toBe(false);
  });
});

test.describe('v8.4 atomic state preservation race guard', () => {
  test('a modal opened mid-reload skips restoreUiState for that cycle', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);

    const result = await page.evaluate(async () => {
      let restoreCalled = false;
      const origRestore = restoreUiState;
      restoreUiState = function (...args) { restoreCalled = true; return origRestore.apply(this, args); };
      const origRefresh = refreshSilently;
      refreshSilently = async function () {
        // Simulate the user opening a modal while the background fetch is in flight.
        const scrim = document.createElement('div');
        scrim.className = 'modal-scrim';
        scrim.id = 'v84RaceTestScrim';
        document.body.appendChild(scrim);
        return origRefresh.apply(this, arguments);
      };
      await reloadPreservingState();
      refreshSilently = origRefresh;
      restoreUiState = origRestore;
      const scrimStillThere = !!document.getElementById('v84RaceTestScrim');
      document.getElementById('v84RaceTestScrim')?.remove();
      return { restoreCalled, scrimStillThere };
    });

    expect(result.restoreCalled, 'restoreUiState was skipped because a modal opened mid-reload').toBe(false);
    expect(result.scrimStillThere, 'the modal that opened mid-reload was not torn down by the reload').toBe(true);
  });

  test('userIsMidAction() reports true while a modal is open, false otherwise', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);

    const clean = await page.evaluate(() => typeof userIsMidAction === 'function' ? userIsMidAction() : 'MISSING');
    expect(clean).toBe(false);

    const withModal = await page.evaluate(() => {
      const scrim = document.createElement('div');
      scrim.className = 'modal-scrim';
      scrim.id = 'v84MidActionScrim';
      document.body.appendChild(scrim);
      const r = userIsMidAction();
      document.getElementById('v84MidActionScrim')?.remove();
      return r;
    });
    expect(withModal).toBe(true);
  });
});
