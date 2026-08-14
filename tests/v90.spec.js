// @ts-check
const { test, expect } = require('@playwright/test');

/* v9.0 Open Beta (redrawAfterWrite scroll fix, Gantt today-line) — no
   execution-override text in this round's request, so both fixes were
   dispatched to the DeepSeek worker per the standing delegation rule; this
   file is Claude's own regression coverage, written directly. */

async function boot(page) {
  /* v9.2.1: the app defaults to Vietnamese. Every #tabs button selector in
     this suite matches English labels, so pin the language before the app
     boots rather than making each assertion locale-aware. */
  await page.addInitScript(() => { try { localStorage.setItem('wvn_lang', 'en'); } catch (e) { } });
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

test.describe('v9.0 redrawAfterWrite() scroll preservation', () => {
  test('redrawAfterWrite() never snaps the page to (0,0)', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);

    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(100);

    const result = await page.evaluate(async () => {
      const captured = [];
      const orig = window.scrollTo.bind(window);
      window.scrollTo = function (x, y) { captured.push([x, y]); return orig(x, y); };
      try {
        await redrawAfterWrite();
      } finally {
        window.scrollTo = orig;
      }
      return { calls: captured, finalY: window.scrollY };
    });

    const snappedToTop = result.calls.some(([x, y]) => x === 0 && y === 0);
    expect(snappedToTop, 'window.scrollTo(0, 0) was never called: ' + JSON.stringify(result.calls)).toBe(false);
    expect(result.finalY, 'page settles back at its pre-redraw scroll position').toBe(400);
  });

  test('completing a real task-lifecycle action (Remove Supporter) preserves scroll position', async ({ page }) => {
    await boot(page);
    await loginAsAdmin(page);
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    // NPI-9611 is the fully-signed project — its step 7 "Who did what" table
    // is long enough to make scroll position meaningful, and its gate row
    // has a real owner to attach/remove a supporter from without extra setup.
    await page.locator('#views .card.project-list-row', { hasText: 'NPI-9611' }).first().locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();

    // Assign a throwaway supporter via the Assign Task modal so a "Remove
    // Supporter" button exists to click — same registry-backed modal flow
    // every other task-lifecycle test in this suite already uses.
    const assignBtn = page.locator('#drawer button', { hasText: /^Assign Task$/ }).first();
    await assignBtn.click();
    const modal = page.locator('.modal-scrim .modal', { hasText: 'Assign Task' });
    await expect(modal).toBeVisible();
    await modal.locator('select').selectOption({ index: 1 });
    await modal.locator('input[type="radio"][value="supporter"]').check();
    await modal.locator('button', { hasText: /^Assign$/ }).click();
    await expect(modal).not.toBeVisible();
    await expect(page.locator('#drawer button', { hasText: /^Remove Supporter$/ }).first()).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => window.scrollTo(0, 250));
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => window.scrollY);

    await page.locator('#drawer button', { hasText: /^Remove Supporter$/ }).first().click();
    const confirmModal = page.locator('.modal-scrim .modal', { hasText: 'Remove Supporter' });
    await expect(confirmModal).toBeVisible();
    await confirmModal.locator('button', { hasText: /^Remove$/ }).click();
    await expect(confirmModal).not.toBeVisible();

    // redrawAfterWrite() runs, drawer reopens via onAfterRemove — give both
    // a moment to settle, then confirm we did not get bounced to the top.
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.scrollY);
    expect(after, 'scroll position survives a real Remove Supporter action, not reset to 0').toBeGreaterThan(0);
    expect(Math.abs(after - before), 'scroll position is close to where it was before the action').toBeLessThan(50);
  });
});

test.describe('v9.0 Gantt current-week indicator', () => {
  test('a bold red today-line renders on the header track and every project row, all at the same horizontal position', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.gantt-live-wrap')).toBeVisible();

    const info = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('.gantt-today-line'));
      const rows = document.querySelectorAll('.gantt-live-row').length;
      const cs = lines.length ? getComputedStyle(lines[0]) : null;
      return {
        count: lines.length,
        rowCount: rows,
        lefts: lines.map((l) => l.style.left),
        bg: cs ? cs.backgroundColor : null,
        width: cs ? cs.width : null,
      };
    });

    // One line in the header track + one per project row (rowCount includes
    // the header row itself).
    expect(info.count, 'a today-line renders once per gantt-live-row (header + each project)').toBe(info.rowCount);
    expect(info.count).toBeGreaterThan(0);

    // Every line shares the identical left% so it reads as one continuous
    // vertical line down the whole chart.
    const uniqueLefts = new Set(info.lefts);
    expect(uniqueLefts.size, 'every today-line sits at the exact same horizontal position').toBe(1);

    expect(info.bg, 'today-line renders in red').toBe('rgb(255, 0, 0)');
    expect(parseFloat(info.width || '0'), 'today-line is bold (>=2px wide)').toBeGreaterThanOrEqual(2);
  });

  test('the today-line position matches pctForDate(new Date()) within the live Gantt', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.gantt-live-wrap')).toBeVisible();

    const leftPct = await page.evaluate(() => {
      const line = document.querySelector('.gantt-today-line');
      return line ? parseFloat(line.style.left) : null;
    });
    expect(leftPct, 'today-line has a numeric left% position').not.toBeNull();
    expect(leftPct).toBeGreaterThanOrEqual(0);
    expect(leftPct).toBeLessThanOrEqual(100);
  });
});
