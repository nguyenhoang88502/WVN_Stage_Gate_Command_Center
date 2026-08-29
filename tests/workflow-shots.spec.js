// @ts-check
/* Walks the real end-to-end operator workflow and captures one descriptively
   named screenshot per step, for the SOP and the presentation deck.

   Run:  npx playwright test tests/workflow-shots.spec.js
   Out:  presentation-shots/NN_step_name.png   (SHOT_DIR to override)

   This is a capture harness, not an assertion suite — steps are individually
   guarded so a surface that is empty in the current sample data degrades to a
   skipped shot instead of aborting the whole walk.

   NOTE: steps 08-13 genuinely write to the CSV store (claim, note, issue).
   That is deliberate — screenshots of a real interaction beat screenshots of
   a mocked one — but it means the tracking data needs cleaning afterwards,
   the same accretion problem the suite has elsewhere. */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const DIR = process.env.SHOT_DIR || 'presentation-shots';
let n = 0;
async function shot(page, name, locator) {
  n += 1;
  const file = path.join(DIR, String(n).padStart(2, '0') + '_' + name + '.png');
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file });
  console.log('SHOT ' + file);
}

test.use({ viewport: { width: 1500, height: 950 } });

test('capture the operator workflow', async ({ page }) => {
  test.setTimeout(240000);
  fs.mkdirSync(DIR, { recursive: true });

  // English for the deck; the Vietnamese default gets its own shot at the end.
  await page.addInitScript(() => { try { localStorage.setItem('wvn_lang', 'en'); } catch (e) { } });

  /* -- 1. Landing --------------------------------------------------------- */
  await page.goto('/');
  await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
  await page.waitForTimeout(600);
  await shot(page, 'dashboard_on_launch');

  /* -- 2. Identity + admin unlock ----------------------------------------- */
  await page.locator('#whoSelect').selectOption('admin');
  const pin = page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' });
  await expect(pin).toBeVisible();
  await shot(page, 'admin_pin_gate');
  await pin.locator('input[type="password"]').fill('1234');
  await pin.locator('button', { hasText: 'Unlock' }).click();
  await expect(pin).not.toBeVisible();

  /* -- 3. Portfolio KPIs --------------------------------------------------- */
  const kpis = page.locator('.kpi-row, .kpis, .card').first();
  await page.waitForTimeout(400);
  await shot(page, 'portfolio_kpis', kpis.first());

  /* -- 4. Stage completion drill-down (collapsed -> expanded) -------------- */
  const stageToggle = page.locator('.section-toggle', { hasText: /Stage Completion/i }).first();
  if (await stageToggle.count()) {
    await shot(page, 'stage_completion_collapsed', page.locator('#npiStageWrap'));
    await stageToggle.click();
    await page.waitForTimeout(400);
    await shot(page, 'stage_completion_expanded', page.locator('#npiStageWrap'));
    await stageToggle.click();
  }

  /* -- 5. Live Gantt with the current-week marker -------------------------- */
  const gantt = page.locator('.gantt-live-wrap');
  if (await gantt.count()) {
    await gantt.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, 'gantt_schedule_current_week_line', gantt);
  }

  /* -- 6. Project register ------------------------------------------------- */
  await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
  await page.waitForTimeout(500);
  await shot(page, 'npi_project_register');

  /* -- 7. Gate detail drawer ----------------------------------------------
     The SOP needs a gate that is unclaimed with documents still missing —
     that is the state showing both the claim button and the dropzones.
     Selecting on the row's own text does not work: "NOT STARTED" and the
     filed-count describe the whole project, not the state of the particular
     step the drawer opens at, so the first NOT STARTED row lands on a gate
     someone has already claimed. Open candidates in order instead and keep
     the first whose drawer actually offers Claim Task. */
  const rowCount = await page.locator('#views .card.project-list-row').count();
  let opened = false;
  for (let i = 0; i < Math.min(rowCount, 8); i++) {
    await page.locator('#views .card.project-list-row').nth(i).locator('b').click();
    await expect(page.locator('#drawer')).toBeVisible();
    await page.waitForTimeout(350);
    const claimable = await page.locator('#drawer button', { hasText: /^Claim Task$/ }).count();
    const dzs = await page.locator('#drawer .dz[data-doc-code]:not(.dz-locked)').count();
    if (claimable && dzs) { opened = true; break; }
    const c = page.locator('#drawer button', { hasText: /^Close$/ });
    if (await c.count()) await c.first().click();
    await page.waitForTimeout(200);
  }
  expect(opened, 'found an unclaimed gate with missing documents to demonstrate').toBe(true);
  await page.waitForTimeout(400);
  await shot(page, 'gate_detail_drawer');

  /* -- 8. Claim a task ----------------------------------------------------- */
  const claimBtn = page.locator('#drawer button', { hasText: /^Claim Task$/ }).first();
  if (await claimBtn.count()) {
    await shot(page, 'claim_task_before', page.locator('#drawer .claim-row').first());
    await claimBtn.click();
    await page.waitForTimeout(800);
    await shot(page, 'claim_task_ownership', page.locator('#drawer .claim-row').first());
  }

  /* -- 9. Evidence dropzone ------------------------------------------------ */
  const dz = page.locator('#drawer .dz[data-doc-code]:not(.dz-locked)').first();
  if (await dz.count()) {
    await dz.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, 'evidence_dropzone', dz);
    await shot(page, 'required_documents_checklist');
  }

  /* -- 10. Target week + gate notes ---------------------------------------- */
  const notesBtn = page.locator('#drawer button', { hasText: /Gate Notes/ }).first();
  if (await notesBtn.count()) {
    await notesBtn.click();
    await page.waitForTimeout(500);
    await shot(page, 'gate_notes_thread');
    await notesBtn.click();
  }

  /* -- 11. Raise an issue (owner pre-filled with the raiser) ---------------- */
  const raiseBtn = page.locator('#drawer button', { hasText: /^Raise issue…$/ }).first();
  if (await raiseBtn.count()) {
    await raiseBtn.click();
    const modal = page.locator('.modal-scrim .modal', { hasText: 'Raise Issue' });
    await expect(modal).toBeVisible();
    await modal.locator('textarea').fill('Housing gap out of tolerance on first-off sample');
    await page.waitForTimeout(300);
    await shot(page, 'raise_issue_owner_prefilled', modal);
    await modal.locator('button', { hasText: /^Cancel$/ }).click();
  }

  /* -- 12. Approve control -------------------------------------------------- */
  const approveBtn = page.locator('#drawer button', { hasText: /^Approve step \d+$/ }).first();
  if (await approveBtn.count()) {
    await approveBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'gate_approval_control', page.locator('#drawer'));
  }
  const closeBtn = page.locator('#drawer button', { hasText: /^Close$/ });
  if (await closeBtn.count()) await closeBtn.first().click();

  /* -- 13. Claimed Work ----------------------------------------------------- */
  await page.locator('#tabs button', { hasText: /^Claimed Work$/ }).click();
  await page.waitForTimeout(600);
  await shot(page, 'claimed_work_queue');

  /* -- 14. Input: register a project ---------------------------------------- */
  await page.locator('#tabs button', { hasText: /^Input$/ }).click();
  await page.waitForTimeout(500);
  await page.locator('#npFamId').fill('9649LP');
  await page.locator('#npClass').fill('Type E');
  await page.locator('#npClass').dispatchEvent('input');
  await page.waitForTimeout(400);
  await shot(page, 'register_new_project');

  /* -- 15. Batch evidence uploader ------------------------------------------ */
  const batchDz = page.locator('text=Drop files here — several at once is fine — or click to choose');
  if (await batchDz.count()) {
    await batchDz.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'batch_evidence_upload');
  }

  /* -- 16. Reports ----------------------------------------------------------- */
  await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
  await page.waitForTimeout(500);
  const rpt = page.locator('#dashReportSelect');
  if (await rpt.count()) {
    await rpt.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'xlsx_pdf_reports');
  }

  /* -- 17. Settings ---------------------------------------------------------- */
  await page.locator('#tabs button', { hasText: /^Settings$/ }).click();
  await page.waitForTimeout(700);
  await shot(page, 'settings_master_data');

  const ct = page.locator('.change-types-scroll');
  if (await ct.count()) {
    await ct.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'change_project_types_table', ct);
  }

  /* -- 18. Collapsed rail ----------------------------------------------------- */
  await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
  await page.waitForTimeout(400);
  await page.locator('#sidebarToggle').click();
  await page.waitForTimeout(500);
  await shot(page, 'collapsed_navigation_rail');
  await page.locator('#sidebarToggle').click();
  await page.waitForTimeout(400);

  /* -- 19. Dark theme ---------------------------------------------------------- */
  await page.locator('#themeBtn').click();
  await page.waitForTimeout(600);
  await shot(page, 'dark_theme');
  await page.locator('#themeBtn').click();
  await page.waitForTimeout(400);

  /* -- 20. Vietnamese interface -------------------------------------------------- */
  await page.locator('#langToggleBtn').click();
  await page.waitForTimeout(700);
  await shot(page, 'vietnamese_interface');
});
