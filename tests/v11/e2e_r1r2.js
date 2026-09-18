// v11 R1 + R2 end-to-end check against an ISOLATED copy of the app.
//   node tests/v11/e2e_r1r2.js <copyRoot>
// <copyRoot> must contain app\system (a copy of system\) and an empty
// NPI_EPM_Documents_Control vault. Starts the launcher from the copy on port
// 8090 as writer PC_A, drives it with Chromium, stops it. Never touches the
// live tracking data. Exit code 1 on any failed check.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node e2e_r1r2.js <copyRoot>'); process.exit(2); }
const BASE = 'http://localhost:8090';
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}
async function waitUp() {
  for (let i = 0; i < 90; i++) { try { const r = await fetch(BASE + '/api/data'); if (r.ok) return; } catch (e) { } await new Promise(r => setTimeout(r, 500)); }
  throw new Error('server did not start');
}
async function api(p) { const r = await fetch(BASE + p); return r.json(); }

(async () => {
  const launcher = path.join(ROOT, 'app', 'system', 'launcher.ps1');
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-NoBrowser', '-Port', '8090', '-WriterId', 'PC_A'], { stdio: 'ignore' });
  let browser;
  try {
    await waitUp();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem('wvn_lang', 'en'); } catch (e) { } });
    await page.goto(BASE + '/');
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });
    await page.locator('#whoSelect').selectOption('admin');
    const pin = page.locator('.modal-scrim .modal', { hasText: 'Admin PIN required' });
    await pin.locator('input[type="password"]').fill('1234');
    await pin.locator('button', { hasText: 'Unlock' }).click();

    /* ---------------- R1: history + new revision + stale approval ------- */
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    await page.locator('#views .card.project-list-row', { hasText: 'NPI-9611' }).locator('b').first().click();
    const drawer = page.locator('#drawer');
    await drawer.waitFor();
    const heading = await drawer.locator('h2').first().innerText();
    check('R1 drawer opens on a signed NPI-9611 step', /NPI-9611/.test(heading), heading);
    const revBadges = await drawer.locator('.rev-badge').count();
    check('R1 filed documents show their active revision number', revBadges > 0, 'badges=' + revBadges);
    const firstRow = drawer.locator('tr', { has: page.locator('button', { hasText: /^History$/ }) }).first();
    const docCode = (await firstRow.locator('a.doc-link').innerText()).trim();
    await firstRow.locator('button', { hasText: /^History$/ }).click();
    const hist = page.locator('.modal.history-modal');
    await hist.locator('.history-table').waitFor({ timeout: 10000 });
    const histRows = await hist.locator('.history-table tbody tr').count();
    check('R1 history modal lists the revisions of ' + docCode, histRows >= 1, 'rows=' + histRows);
    await hist.locator('button', { hasText: /^Close$/ }).click();

    const chooserP = page.waitForEvent('filechooser');
    await firstRow.locator('button', { hasText: /^New revision$/ }).click();
    const chooser = await chooserP;
    await chooser.setFiles({ name: docCode + '_rev_test.txt', mimeType: 'text/plain', buffer: Buffer.from('new revision ' + Date.now()) });
    const reason = page.locator('.modal', { hasText: 'Change reason' });
    await reason.locator('button', { hasText: 'Upload revision' }).click();
    check('R1 a change reason is required', await reason.locator('.reason-err').isVisible());
    await reason.locator('textarea').fill('Updated after trial 2');
    await reason.locator('button', { hasText: 'Upload revision' }).click();
    await page.locator('#uploadQueue', { hasText: 'All 1 saved' }).waitFor({ timeout: 30000 });
    await page.locator('#uploadQueue .uq-clear').click();
    await page.waitForTimeout(1500);
    await drawer.locator('.stale-banner').first().waitFor({ timeout: 15000 });
    check('R1 drawer shows the stale-approval banner after revising a signed gate', true);
    const sk = heading.match(/step (\d+)/);
    const stepKey = 'NPI-' + (sk ? sk[1] : '7');
    const h = await api('/api/document-history?project_id=NPI-9611&step_key=' + stepKey + '&doc_code=' + encodeURIComponent(docCode));
    const active = h.revisions.filter(r => r.is_active === 'YES');
    check('R1 history: newest first, exactly one active, reason recorded', h.revisions.length >= 2 && active.length === 1 &&
      h.revisions[0].is_active === 'YES' && h.revisions[0].change_reason === 'Updated after trial 2' && h.stale === true,
      JSON.stringify(h.revisions.map(r => [r.revision_no, r.is_active, r.change_reason])) + ' stale=' + h.stale);
    await drawer.locator('button', { hasText: /^Close$/ }).first().click();
    await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
    await page.waitForTimeout(800);
    check('R1 dashboard matrix shows the stale badge', await page.locator('.stale-badge').count() > 0);

    /* ---------------- R2: 105-file drop with injected row failures ------ */
    const before = await api('/api/vault/orphans');
    await page.locator('#tabs button', { hasText: /^NPI ·/ }).click();
    const rows = page.locator('#views .card.project-list-row');
    const n = await rows.count();
    let target = null;
    for (let i = 0; i < n && !target; i++) {
      await rows.nth(i).locator('b').first().click();
      await drawer.waitFor();
      await page.waitForTimeout(300);
      const claim = drawer.locator('button', { hasText: /^Claim Task$/ });
      if (await claim.count()) { await claim.first().click(); await page.waitForTimeout(900); }
      const dz = drawer.locator('.dz[data-doc-code]:not(.dz-locked)');
      if (await dz.count()) target = { code: await dz.first().getAttribute('data-doc-code'), heading: await drawer.locator('h2').first().innerText() };
      else await drawer.locator('button', { hasText: /^Close$/ }).first().click();
    }
    check('R2 found an open dropzone to drop onto', !!target);
    // First two row writes fail (transient), recovered by the queue's own retries.
    let blocked = 0;
    await page.route('**/api/deliverables/batch', route => { if (blocked < 2) { blocked++; return route.abort('failed'); } return route.continue(); });
    const t0 = Date.now();
    await page.evaluate(({ code }) => {
      const dz = document.querySelector('#drawer .dz[data-doc-code="' + code + '"]');
      const dt = new DataTransfer();
      for (let i = 0; i < 105; i++) dt.items.add(new File(['bulk ' + i + ' ' + Math.random()], 'bulk_' + String(i).padStart(3, '0') + '.txt', { type: 'text/plain' }));
      dz.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, { code: target.code });
    await page.locator('#uploadQueue', { hasText: 'All 105 saved' }).waitFor({ timeout: 240000 });
    check('R2 105 files: all saved despite 2 injected row-write failures (' + Math.round((Date.now() - t0) / 1000) + ' s)', blocked === 2);
    check('R2 per-file status list shows every file', await page.locator('#uploadQueue .uq-list li').count() === 105);
    await page.locator('#uploadQueue .uq-clear').click();

    // Permanent row failure -> "Failed (row - file is saved)" -> Retry re-sends only the row.
    const pid = (target.heading.match(/^(\S+)/) || [])[1];
    const skey = 'NPI-' + ((target.heading.match(/step (\d+)/) || [])[1]);
    await page.unroute('**/api/deliverables/batch');
    await page.route('**/api/deliverables/batch', route => route.abort('failed'));
    let uploads = 0;
    page.on('request', r => { if (r.url().endsWith('/api/upload')) uploads++; });
    await page.evaluate(({ code }) => {
      const dz = document.querySelector('#drawer .dz[data-doc-code="' + code + '"]') || document.querySelector('#drawer .dz[data-doc-code]');
      const dt = new DataTransfer();
      for (let i = 0; i < 3; i++) dt.items.add(new File(['retry ' + i + ' ' + Math.random()], 'retry_' + i + '.txt', { type: 'text/plain' }));
      dz.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, { code: target.code });
    await page.locator('#uploadQueue', { hasText: '3 of 3 need attention' }).waitFor({ timeout: 120000 });
    check('R2 permanent row failure is visible per file, marked "file is saved"', await page.locator('#uploadQueue .uq-failed', { hasText: 'file is saved' }).count() === 3);
    const orphNow = await api('/api/vault/orphans');
    check('R2 the orphan report sees the 3 saved-but-unrecorded files', orphNow.orphans.length === before.orphans.length + 3, (orphNow.orphans.length - before.orphans.length) + ' new orphans');
    await page.unroute('**/api/deliverables/batch');
    const uploadsBeforeRetry = uploads;
    await page.locator('#uploadQueue .uq-retry').click();
    await page.locator('#uploadQueue', { hasText: 'All 3 saved' }).waitFor({ timeout: 60000 });
    check('R2 retry re-sent only the rows (no file re-uploaded)', uploads === uploadsBeforeRetry, (uploads - uploadsBeforeRetry) + ' re-uploads');
    const after = await api('/api/vault/orphans');
    check('R2 zero orphaned files after the whole session', after.orphans.length === before.orphans.length, (after.orphans.length - before.orphans.length) + ' new orphans');
    const dh = await api('/api/document-history?project_id=' + encodeURIComponent(pid) + '&step_key=' + skey + '&doc_code=' + encodeURIComponent(target.code));
    const shas = dh.revisions.map(r => r.sha256);
    check('R2 108 revisions recorded, no duplicate rows, one active', dh.revisions.length === 108 && new Set(shas).size === 108 && dh.revisions.filter(r => r.is_active === 'YES').length === 1,
      'revs=' + dh.revisions.length + ' unique=' + new Set(shas).size);
    check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  } catch (e) {
    fail++; console.log('FAIL exception: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    try { await fetch(BASE + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { }
    await new Promise(r => setTimeout(r, 1500));
    try { srv.kill(); } catch (e) { }
    console.log('RESULT pass=' + pass + ' fail=' + fail);
    process.exit(fail ? 1 : 0);
  }
})();
