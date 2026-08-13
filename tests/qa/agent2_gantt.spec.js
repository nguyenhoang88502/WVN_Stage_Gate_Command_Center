// @ts-check
const { test, expect } = require('@playwright/test');

// Agent 2 — Dashboard Gantt & Stage Segmentation (v8.0 Section 4).
// Domain: live Gantt renders one row per project with a planned bar plus one
// colour-coded segment per gated step, each labelled S1..Sn, separated by
// divider elements, and each segment click opens the drawer at that exact step.

const STATUS_SUFFIXES = ['complete', 'in_progress', 'not_started', 'bypassed', 'late'];

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
  await expect(page.locator('.gantt-live-wrap')).toBeVisible({ timeout: 15000 });
}

test.describe('Dashboard Gantt & Stage Segmentation', () => {
  test('Gantt renders planned bar + per-stage segments with labels and separators', async ({ page }) => {
    await boot(page);
    const wrap = page.locator('.gantt-live-wrap');

    const rows = wrap.locator('.gantt-live-row:not(.gantt-live-header)');
    const rowCount = await rows.count();
    expect(rowCount, 'at least one project row renders').toBeGreaterThan(0);

    const firstRow = rows.first();
    await expect(firstRow.locator('.gantt-bar.gantt-bar-planned')).toBeVisible();

    const segs = firstRow.locator('.gantt-stage-seg');
    const segCount = await segs.count();
    expect(segCount, 'first row has at least one stage segment').toBeGreaterThan(0);

    for (let i = 0; i < segCount; i++) {
      const label = segs.nth(i).locator('.gantt-stage-label');
      expect(await label.count(), 'segment has a label').toBe(1);
      const text = (await label.textContent() || '').trim();
      expect(text, 'label is S<id>').toMatch(/^S\d+$/);
    }
    await expect(segs.first().locator('.gantt-stage-label')).toBeVisible();

    if (segCount > 1) {
      const sepCount = await firstRow.locator('.gantt-stage-separator').count();
      expect(sepCount, 'separators exist between segments').toBeGreaterThan(0);
    }
  });

  test('every segment carries exactly one status class and a rendered fill colour', async ({ page }) => {
    await boot(page);
    const wrap = page.locator('.gantt-live-wrap');

    const report = await wrap.evaluate((el) => {
      const rows = Array.from(el.querySelectorAll('.gantt-live-row:not(.gantt-live-header)'));
      const out = [];
      for (const row of rows) {
        const pid = (row.querySelector('.gantt-live-meta-cell') || {}).textContent || '';
        const segs = Array.from(row.querySelectorAll('.gantt-stage-seg'));
        for (const seg of segs) {
          const classes = (seg.className || '').split(/\s+/);
          const statuses = ['complete', 'in_progress', 'not_started', 'bypassed', 'late']
            .filter((s) => classes.includes('gantt-stage-seg-' + s));
          const cs = getComputedStyle(seg);
          const bg = cs.backgroundColor;
          const img = cs.backgroundImage;
          const transparentBg = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0.0)';
          const filled = img !== 'none' || !transparentBg;
          const label = seg.querySelector('.gantt-stage-label');
          out.push({
            pid: pid.trim(),
            label: label ? label.textContent.trim() : '',
            statuses,
            filled,
            backgroundColor: bg,
            backgroundImage: img,
          });
        }
      }
      return out;
    });

    expect(report.length, 'found at least one segment').toBeGreaterThan(0);

    const badStatus = report.filter((s) => s.statuses.length !== 1);
    expect(badStatus, 'every segment has exactly one status suffix').toEqual([]);

    const unfilled = report.filter((s) => !s.filled);
    expect(unfilled, 'every segment has a rendered (non-transparent) fill').toEqual([]);
  });

  test('segment title tooltips contain the project id and a status word', async ({ page }) => {
    await boot(page);
    const wrap = page.locator('.gantt-live-wrap');

    const segs = wrap.locator('.gantt-stage-seg');
    expect(await segs.count()).toBeGreaterThan(0);

    const seg = segs.first();
    const title = (await seg.getAttribute('title')) || '';

    const pid = ((await wrap.locator('.gantt-live-row:not(.gantt-live-header)').first()
      .locator('.gantt-live-meta-cell').first().textContent()) || '').trim();

    expect(title.length, 'title is present').toBeGreaterThan(0);
    expect(title, 'title includes the project id').toContain(pid);
    expect(title, 'title includes a status line').toMatch(/Status:/i);
    expect(title, 'title names a concrete status').toMatch(/(COMPLETE|IN PROGRESS|NOT STARTED|BYPASSED|LATE)/i);
  });

  test('clicking a mid-project stage segment opens the drawer at that exact step', async ({ page }) => {
    await boot(page);
    const wrap = page.locator('.gantt-live-wrap');
    const rows = wrap.locator('.gantt-live-row:not(.gantt-live-header)');

    // Prefer a row with 3+ segments (true "mid" segment); fall back to 2.
    let chosen = null;
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const segCount = await rows.nth(i).locator('.gantt-stage-seg').count();
      if (segCount >= 3) { chosen = { i, segCount, mid: 1 }; break; }
    }
    if (!chosen) {
      for (let i = 0; i < rowCount; i++) {
        const segCount = await rows.nth(i).locator('.gantt-stage-seg').count();
        if (segCount >= 2) { chosen = { i, segCount, mid: 1 }; break; }
      }
    }
    expect(chosen, 'a row with at least 2 segments exists').not.toBeNull();

    const row = rows.nth(chosen.i);
    const pid = ((await row.locator('.gantt-live-meta-cell').first().textContent()) || '').trim();
    const midSeg = row.locator('.gantt-stage-seg').nth(chosen.mid);
    const labelText = ((await midSeg.locator('.gantt-stage-label').textContent()) || '').trim();
    const expectedStep = labelText.replace(/^S/, '');
    expect(expectedStep.length, 'mid segment has a step id').toBeGreaterThan(0);

    await midSeg.click();
    await expect(page.locator('#drawer')).toBeVisible();

    const h2 = ((await page.locator('#drawer h2').textContent()) || '').trim();
    expect(h2, 'drawer heading names the clicked project').toContain(pid);
    const m = h2.match(/step\s+(\S+)\s+—/);
    expect(m, 'drawer heading includes a step id').toBeTruthy();
    expect(m[1], 'drawer opens at the clicked segment step, not another step').toBe(expectedStep);
  });
});
