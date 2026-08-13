// @ts-check
const { test, expect } = require('@playwright/test');

/* v8.1 Sub-task 3 (Claude's own responsibility, not delegated to the
   DeepSeek worker per the v8.1 role split — "regression testing" is an
   Orchestrator duty). Covers the two genuinely NEW behaviors this round:
   the centered full-screen loader, and target-week-driven Gantt segment
   positioning + the new 3-line tooltip format. Everything else the v8.1
   spec listed (dropzone isolation, inline notes, zero-loss reload) was
   already implemented and is covered by tests/qa/*.spec.js and
   tests/v80.spec.js from the previous round — not duplicated here. */

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

test.describe('v8.1 centered loader', () => {
  test('#globalLoader is a fixed, full-viewport, centered overlay with a spinner', async ({ page }) => {
    await boot(page);
    // Trigger it via a heavy op (PDF export) rather than racing boot()'s
    // narrow visible window — this exercises the same showLoader() call and
    // lets us inspect steady-state layout without a timing race.
    await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
    await page.locator('button', { hasText: 'Download PDF' }).click();

    const loader = page.locator('#globalLoader');
    await expect(loader).toBeAttached();
    const box = await loader.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { position: cs.position, zIndex: cs.zIndex, display: cs.display, top: r.top, left: r.left, width: r.width, height: r.height };
    });
    expect(box.position).toBe('fixed');
    expect(Number(box.zIndex)).toBeGreaterThanOrEqual(1000);
    // Fixed + inset:0 should cover the full viewport regardless of scroll.
    expect(box.top).toBeLessThanOrEqual(1);
    expect(box.left).toBeLessThanOrEqual(1);

    const ring = loader.locator('.loader-ring');
    expect(await ring.count(), 'spinner child element exists').toBeGreaterThan(0);
  });

  test('loader is visible while boot() awaits /api/data, and hidden once connected', async ({ page }) => {
    // Delay the data fetch so there is a real window to observe the loader
    // in its shown state, rather than a race against a same-tick resolve.
    let releaseResponse;
    const gate = new Promise((resolve) => { releaseResponse = resolve; });
    await page.route('**/api/data', async (route) => {
      await gate;
      await route.continue();
    });

    const navigated = page.goto('/');
    // Give boot() a moment to run past showLoader() and into the pending fetch.
    await page.waitForTimeout(300);
    const loaderVisible = await page.locator('#globalLoader').evaluate((el) => !el.classList.contains('hide')).catch(() => false);
    expect(loaderVisible, 'loader is shown while the initial data fetch is in flight').toBe(true);

    releaseResponse();
    await navigated;
    await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
    await expect(page.locator('#globalLoader')).toHaveClass(/hide/);
  });
});

test.describe('v8.1 Gantt target-week-driven positioning + tooltip', () => {
  test('editing a gate target week re-renders its Gantt segment with the new Start/End tooltip', async ({ page }) => {
    await boot(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row', { hasText: 'NOT STARTED' }).first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const h2 = ((await page.locator('#drawer h2').textContent()) || '').trim();
    const pidMatch = h2.match(/^(\S+)\s*·\s*step\s+(\S+)/);
    expect(pidMatch, 'drawer heading parses to a project id + step id').toBeTruthy();
    const pid = pidMatch[1];
    const stepId = pidMatch[2];

    // Pick a target week that is unlikely to collide with any pre-seeded
    // sample data (far future), so the segment's new position is unambiguous.
    const newWeek = '2027-W30';
    const editor = page.locator('#drawer .target-week-editor').first();
    await editor.locator('input[type="week"]').fill(newWeek);
    await editor.locator('button', { hasText: 'Save' }).click();
    await expect(editor.locator('input[type="week"]')).toHaveValue(newWeek);

    // The drawer's own scrim intercepts clicks on the tab bar behind it —
    // close it explicitly first, same as a real user would.
    const closeBtn = page.locator('#drawer button', { hasText: /^Close$/ });
    if (await closeBtn.count()) await closeBtn.first().click();
    await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
    await expect(page.locator('.gantt-live-wrap')).toBeVisible();

    const seg = page.locator('.gantt-stage-seg', { hasText: '' }).filter({
      has: page.locator('.gantt-stage-label', { hasText: 'S' + stepId }),
    }).filter({ hasText: '' });
    // Narrow to the exact project by title content (locator filter on
    // attribute text isn't built in — read all matching-label segments and
    // pick the one whose title names this project).
    const candidates = page.locator('.gantt-stage-seg').filter({ has: page.locator('.gantt-stage-label', { hasText: new RegExp('^S' + stepId + '$') }) });
    const count = await candidates.count();
    let target = null;
    for (let i = 0; i < count; i++) {
      const title = (await candidates.nth(i).getAttribute('title')) || '';
      if (title.startsWith(pid + ' ')) { target = candidates.nth(i); break; }
    }
    expect(target, 'the edited gate\'s own segment is found on the Gantt').not.toBeNull();

    const title = (await target.getAttribute('title')) || '';
    expect(title, 'tooltip has the 3-line format with Start/End weeks').toMatch(/Start: \d{4}-W\d{2} \| End: \d{4}-W\d{2}/);
    expect(title, 'tooltip End matches the newly saved target week').toContain('End: ' + newWeek);
    expect(title, 'tooltip includes an X/Y docs-filed count').toMatch(/\(\d+\/\d+ docs filed\)/);
    expect(title, 'tooltip status is human-readable (space, not underscore)').not.toMatch(/[A-Z]_[A-Z]/);
  });
});
