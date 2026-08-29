// @ts-check
/* v10 — Live Gantt: two-tier week axis, week rules, per-step drill-down. */
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.setItem('wvn_lang', 'en'); } catch (e) { } });
  await page.goto('/');
  await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
  await expect(page.locator('.gantt-live-wrap')).toBeVisible();
}

test.describe('v10 Gantt axis', () => {
  test('the axis splits into a month band over bare week numbers, and the week labels no longer collide', async ({ page }) => {
    await boot(page);

    const band = page.locator('.gantt-live-header-top .gantt-band');
    expect(await band.count(), 'the upper tier carries at least one month band').toBeGreaterThan(0);
    // The year moves onto the band — that is the whole point of lifting it off
    // the repeated week label. Read it from the tooltip: the visible text drops
    // to the short month, or to nothing, on a band too narrow to hold it.
    const titles = await band.evaluateAll((ns) => ns.map((n) => n.title));
    expect(titles[0], 'the first month band names its month and year').toMatch(/^[A-Z][a-z]{2} (19|20)\d{2}$/);
    expect((await band.first().textContent()) || '', 'the first band shows the year on screen').toMatch(/(19|20)\d{2}/);

    const labels = page.locator('.gantt-live-track-header .gantt-week-label');
    const texts = await labels.allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t.trim(), 'the lower tier shows only Wnn, never the full ISO week').toMatch(/^W\d{2}$/);
    }

    /* The smear this replaced: a label written at every tick with nothing
       thinning them out. Demand a real gap, not merely non-overlap — at the
       default 1280px viewport the first cut of this spacing rule left the
       glyphs touching by 0.2px, which reads as one run-on string. */
    const boxes = [];
    for (let i = 0; i < texts.length; i++) {
      const b = await labels.nth(i).boundingBox();
      if (b) boxes.push(b);
    }
    boxes.sort((a, b) => a.x - b.x);
    for (let i = 1; i < boxes.length; i++) {
      const gap = boxes[i].x - (boxes[i - 1].x + boxes[i - 1].width);
      expect(gap, `week label ${i} has clear air before it`).toBeGreaterThanOrEqual(2);
    }
  });

  test('vertical week rules are painted on every track', async ({ page }) => {
    await boot(page);
    const rule = await page.evaluate(() => {
      const grid = document.querySelector('.gantt-live-grid');
      const track = document.querySelector('.gantt-live-track');
      if (!grid || !track) return null;
      return {
        offset: grid.style.getPropertyValue('--gantt-rule-offset'),
        period: grid.style.getPropertyValue('--gantt-rule-period'),
        image: getComputedStyle(track, '::before').backgroundImage,
      };
    });
    expect(rule, 'the gantt grid renders').not.toBeNull();
    expect(rule.offset, 'rules are offset to the first week boundary').toMatch(/%$/);
    expect(parseFloat(rule.period), 'rules repeat on a positive period').toBeGreaterThan(0);
    expect(rule.image, 'the rules are drawn as a repeating gradient').toContain('repeating-linear-gradient');
  });
});

test.describe('v10 Gantt per-step drill-down', () => {
  test('a project expands into one sub-row per step, each with its own bar, and collapses again', async ({ page }) => {
    await boot(page);

    const firstRow = page.locator('.gantt-live-row:not(.gantt-live-header)').first();
    const pid = ((await firstRow.locator('.gantt-live-meta-cell').first().textContent()) || '').trim();
    expect(pid, 'the project cell still reads as a bare project id').toMatch(/^(NPI|ECN)-/);

    await expect(page.locator('.gantt-sub-row')).toHaveCount(0);

    const toggle = firstRow.locator('.gantt-expand');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    const subs = page.locator('.gantt-sub-row');
    const n = await subs.count();
    expect(n, 'expanding yields a sub-row per step').toBeGreaterThan(1);
    // NPI runs 7 steps, ECN 12; a change type can exclude some.
    expect(n).toBeLessThanOrEqual(12);

    // Clicking the toggle must not also fire the row's open-drawer handler.
    await expect(page.locator('#drawer')).toHaveCount(0);

    for (let i = 0; i < n; i++) {
      const sub = subs.nth(i);
      await expect(sub.locator('.gantt-live-meta-cell').first()).toHaveText(/^Step \d+: \S/);
      const bar = sub.locator('.gantt-sub-bar');
      await expect(bar).toHaveCount(1);
      const cls = (await bar.getAttribute('class')) || '';
      expect(cls, 'the bar is coloured by its own gate status')
        .toMatch(/gantt-stage-seg-(complete|in_progress|not_started|bypassed|late)/);
      const title = (await bar.getAttribute('title')) || '';
      expect(title, 'the bar tooltip carries start, end and document counts').toMatch(/Start: \d{4}-W\d{2} \| End: \d{4}-W\d{2}/);
      expect(title).toMatch(/\d+\/\d+ docs filed/);
    }

    // Sub-row bars are not the parent's segments — the segmentation selectors
    // must keep matching only the summary strip.
    expect(await subs.first().locator('.gantt-stage-seg').count()).toBe(0);

    await toggle.click();
    await expect(page.locator('.gantt-sub-row')).toHaveCount(0);
  });

  test('clicking a step bar opens that step in the drawer', async ({ page }) => {
    await boot(page);
    const firstRow = page.locator('.gantt-live-row:not(.gantt-live-header)').first();
    const pid = ((await firstRow.locator('.gantt-live-meta-cell').first().textContent()) || '').trim();
    await firstRow.locator('.gantt-expand').click();

    const sub = page.locator('.gantt-sub-row').nth(1);
    const stepLabel = ((await sub.locator('.gantt-live-meta-cell').first().textContent()) || '').trim();
    const stepId = (stepLabel.match(/^Step (\d+):/) || [])[1];
    expect(stepId, 'the sub-row names its step').toBeTruthy();

    await sub.locator('.gantt-sub-bar').click();
    await expect(page.locator('#drawer')).toBeVisible();
    const h2 = ((await page.locator('#drawer h2').textContent()) || '').trim();
    expect(h2).toContain(pid);
    expect(h2, 'the drawer opens on the clicked step, not the project default')
      .toMatch(new RegExp('step\\s+' + stepId + '\\b', 'i'));
  });

  test('the expanded state survives the auto-reload re-render', async ({ page }) => {
    await boot(page);
    await page.locator('.gantt-live-row:not(.gantt-live-header)').first().locator('.gantt-expand').click();
    const before = await page.locator('.gantt-sub-row').count();
    expect(before).toBeGreaterThan(0);

    await page.evaluate(() => restoreUiState(captureUiState()));
    await expect(page.locator('.gantt-live-wrap')).toBeVisible();
    await expect(page.locator('.gantt-sub-row')).toHaveCount(before);
  });
});
