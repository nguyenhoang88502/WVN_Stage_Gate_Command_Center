// @ts-check
/* Vendor-handover UI/UX audit capture.
   Walks every workspace, drawer and modal the app has and saves one
   descriptively-named screenshot per surface into ./handover_assets/, for
   build_handover_deck.py to assemble into the vendor PPTX.

   Run:  npx playwright test tests/audit_capture.spec.js
   Out:  handover_assets/NN_name.png   (SHOT_DIR to override)

   Capture harness, not an assertion suite: each surface is individually
   guarded so a state that is empty/absent in the current sample data
   degrades to a skipped shot instead of aborting the whole walk. */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const DIR = process.env.SHOT_DIR || 'handover_assets';

async function shot(target, name) {
  const file = path.join(DIR, name + '.png');
  await target.screenshot({ path: file });
  console.log('SHOT ' + file);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test('capture the full UI/UX audit set', async ({ page }) => {
  test.setTimeout(300000);
  fs.mkdirSync(DIR, { recursive: true });

  // English for legible vendor screenshots.
  await page.addInitScript(() => { try { localStorage.setItem('wvn_lang', 'en'); } catch (e) { } });

  await page.goto('/');
  await expect(page.locator('#srvState')).toHaveText('connected', { timeout: 15000 });
  await page.waitForTimeout(500);

  /* -- 01. Header & navigation -------------------------------------------- */
  await shot(page.locator('.topbar'), '01_topbar_nav');
  await shot(page.locator('#appSidebar'), '01c_sidebar_expanded');
  await page.locator('#sidebarToggle').click();
  await page.waitForTimeout(400);
  await shot(page.locator('#appSidebar'), '01b_sidebar_collapsed');
  await page.locator('#sidebarToggle').click();
  await page.waitForTimeout(400);

  /* -- Admin PIN modal (capture before unlocking) -------------------------- */
  await page.locator('#whoSelect').selectOption('admin');
  const pin = page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' });
  await expect(pin).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, '24_admin_pin_modal');
  await pin.locator('input[type="password"]').fill('1234');
  await pin.locator('button', { hasText: 'Unlock' }).click();
  await expect(pin).not.toBeVisible();
  await page.waitForTimeout(400);

  /* -- Tab 1: Executive Dashboard ------------------------------------------ */
  await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
  await page.waitForTimeout(700);

  const kpis = page.locator('.kpi-grid').first();
  if (await kpis.count()) await shot(kpis, '02_dashboard_kpis');

  const slicers = page.locator('.dashboard-slicers').first();
  if (await slicers.count()) {
    await slicers.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(slicers, '03_dashboard_slicers');
  }

  const stageToggle = page.locator('.section-toggle', { hasText: /Stage Completion/i }).first();
  const stageWrap = page.locator('#npiStageWrap');
  if (await stageToggle.count()) {
    await stageWrap.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(stageWrap, '04_npi_stage_completion');
    await stageToggle.click();
    await page.waitForTimeout(400);
    await shot(stageWrap, '04b_npi_stage_completion_expanded');
    await stageToggle.click();
    await page.waitForTimeout(300);
  }

  const npiMatrixCard = page.locator('.card', { has: page.locator('h3.card-title', { hasText: 'NPI — stage matrix' }) }).first();
  if (await npiMatrixCard.count()) {
    await npiMatrixCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(npiMatrixCard, '05_npi_matrix');
  }

  const ecnMatrixCard = page.locator('.card', { has: page.locator('h3.card-title', { hasText: 'ECN — stage matrix' }) }).first();
  if (await ecnMatrixCard.count()) {
    await ecnMatrixCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(ecnMatrixCard, '06_ecn_matrix');
  }

  const gantt = page.locator('.gantt-live-wrap').first();
  if (await gantt.count()) {
    await gantt.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(gantt, '07_live_gantt_chart');
  }

  /* -- Tab 2: Claimed Work -------------------------------------------------- */
  await page.locator('#tabs button', { hasText: /^Claimed Work$/ }).click();
  await page.waitForTimeout(600);
  await shot(page, '08_claimed_work_view');

  /* -- Tab 3: Data Input ----------------------------------------------------- */
  await page.locator('#tabs button', { hasText: /^Input$/ }).click();
  await page.waitForTimeout(500);
  await shot(page, '09_project_registration');

  const batchCard = page.locator('.card', { has: page.locator('h3.card-title', { hasText: 'Batch Project Registration' }) }).first();
  if (await batchCard.count()) {
    await batchCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(batchCard, '10_batch_project_csv');
  }

  const batchDz = page.locator('text=Drop files here — several at once is fine — or click to choose').first();
  if (await batchDz.count()) {
    await batchDz.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const evidenceCard = batchDz.locator('xpath=ancestor::*[contains(@class,"card")][1]');
    await shot((await evidenceCard.count()) ? evidenceCard : page, '11_evidence_filing_batch');
  }

  const citeLink = page.locator('h3', { hasText: 'Or cite a network path / link' }).first();
  if (await citeLink.count()) {
    await citeLink.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const citeWrap = citeLink.locator('xpath=ancestor::div[contains(@class,"sub")][1]');
    await shot((await citeWrap.count()) ? citeWrap : page, '12_cite_network_link');
  }

  /* -- Tab 4: NPI workflow ---------------------------------------------------- */
  await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
  await page.waitForTimeout(600);
  await shot(page, '13_npi_project_list');

  /* -- Tab 5: ECN workflow + PPAP ---------------------------------------------- */
  await page.locator('#tabs button', { hasText: /^ECN ·/ }).click();
  await page.waitForTimeout(600);
  await shot(page, '14_ecn_project_list');

  const ppapToggle = page.locator('button', { hasText: /^PPAP package$/ }).first();
  if (await ppapToggle.count()) {
    await ppapToggle.click();
    await page.waitForTimeout(500);
    await shot(page, '15_ecn_ppap_checklist');
  }

  /* -- Sidebar drawer & in-drawer surfaces -------------------------------------- */
  await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
  await page.waitForTimeout(500);
  const rowCount = await page.locator('#views .card.project-list-row').count();
  let opened = false;
  for (let i = 0; i < Math.min(rowCount, 10); i++) {
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
  if (opened) {
    await page.waitForTimeout(400);
    await shot(page.locator('#drawer'), '20_sidebar_drawer_full');

    // Claim it so the dropzone + note controls become visible and interactive.
    const claimBtn = page.locator('#drawer button', { hasText: /^Claim Task$/ }).first();
    if (await claimBtn.count()) {
      await claimBtn.click();
      await page.waitForTimeout(700);
    }
    const dz = page.locator('#drawer .dz[data-doc-code]:not(.dz-locked)').first();
    if (await dz.count()) {
      await dz.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const dzGroup = dz.locator('xpath=ancestor::*[contains(@class,"dz-note-wrap") or self::div][1]');
      await shot(dz, '21_dropzone_and_inline_notes');
    }

    // LFI form accordion
    const lfiToggle = page.locator('#drawer .lfi-expand-btn').first();
    if (await lfiToggle.count()) {
      await lfiToggle.scrollIntoViewIfNeeded();
      await lfiToggle.click();
      await page.waitForTimeout(500);
      const lfiBox = page.locator('#drawer .lfi-sidebar-container').first();
      await shot((await lfiBox.count()) ? lfiBox : page.locator('#drawer .lfi-wrap').first(), '22_lfi_form_accordion');
      await lfiToggle.click();
      await page.waitForTimeout(300);
    }

    // Issue resolution dropzone — raise an issue first so an owned, open
    // issue (and therefore its resolve dropzone) exists to capture.
    // Issue resolution dropzone needs an open, owned issue to render — raise
    // one against this step first (persists to the CSV store, same tradeoff
    // workflow-shots.spec.js makes for its claim/note captures).
    const raiseBtn = page.locator('#drawer button', { hasText: /^Raise issue…$/ }).first();
    if (await raiseBtn.count()) {
      await raiseBtn.click();
      const modal = page.locator('.modal-scrim .modal', { hasText: 'Raise Issue' });
      if (await modal.count() && await modal.isVisible()) {
        await modal.locator('textarea').fill('UI/UX audit sample issue for handover screenshot capture');
        const submitBtn = modal.locator('button', { hasText: /^Raise Issue$/ });
        if (await submitBtn.count()) {
          await submitBtn.click();
          await page.waitForTimeout(1000);
        } else {
          await modal.locator('button', { hasText: /^Cancel$/ }).click();
        }
      }
    }
    const resolveDz = page.locator('#drawer .dz-issue-resolve').first();
    if (await resolveDz.count()) {
      await resolveDz.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(resolveDz, '23_issue_resolution_dropzone');
    }

    const closeBtn = page.locator('#drawer button', { hasText: /^Close$/ });
    if (await closeBtn.count()) await closeBtn.first().click();
    await page.waitForTimeout(300);
  }

  /* -- Tab 6: Settings & administration ------------------------------------------ */
  await page.locator('#tabs button', { hasText: /^Settings$/ }).click();
  await page.waitForTimeout(700);

  const doctypesCard = page.locator('.card', { has: page.locator('h3.card-title', { hasText: 'Document types' }) }).first();
  if (await doctypesCard.count()) {
    await doctypesCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(doctypesCard, '16_settings_doctypes_grid');
  }

  const userRegistryCard = page.locator('.card', { has: page.locator('h3.card-title', { hasText: 'User Registry' }) }).first();
  if (await userRegistryCard.count()) {
    await userRegistryCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(userRegistryCard, '17_settings_user_registry');
  }

  const adminPinCard = page.locator('.admin-pin-card').first();
  if (await adminPinCard.count()) {
    await adminPinCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(adminPinCard, '18_settings_admin_pin');
  }

  const changeTypes = page.locator('.change-types-scroll').first();
  if (await changeTypes.count()) {
    await changeTypes.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(changeTypes, '19_settings_change_types');
  }
});
