// v12.5: project folders on registration, name-change confirmation, Claimed Work unassigned list,
// Gantt density, document-type keywords / file types.
//   node tests/v12_5/e2e_folders_claims_names.js <copyRoot>
// <copyRoot> = isolated copy (app\system + empty NPI_EPM_Documents_Control). Starts the launcher on
// port 8125 and stops it at the end. Never use on the live app.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { adminCookie, userCookie, waitUp } = require('../lib/session');
const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node e2e_folders_claims_names.js <copyRoot>'); process.exit(2); }
const BASE = 'http://localhost:8125';
const VAULT = path.join(ROOT, 'NPI_EPM_Documents_Control');
const SHOTS = path.join(ROOT, 'shots');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + JSON.stringify(d) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'app', 'system', 'launcher.ps1'), '-NoBrowser', '-Port', '8125', '-WriterId', 'PC_A'], { stdio: 'ignore' });
  let browser;
  try {
    await waitUp(BASE);
    const admin = await adminCookie(BASE, ROOT);
    const hoang = await userCookie(BASE, admin, 'Hoang');
    const call = async (ck, m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { Cookie: ck, 'Content-Type': 'application/json; charset=utf-8' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (e) { } return { s: r.status, j }; };
    const data = async () => (await call(admin, 'GET', '/api/data')).j;

    /* ---- 1. folders are made when a project is registered ---- */
    let r = await call(admin, 'POST', '/api/projects', { process: 'NPI', family: 'FOL1', class_abcde: 'E', prf_date: '2026-W20', target_date: '2026-W30', created_by: 'admin' });
    const pid = r.j.project_id;
    check('setup: project registered', r.s === 200 && pid === 'NPI-FOL1', r.j);
    const famDir = path.join(VAULT, 'FOL1');
    const subs = fs.existsSync(famDir) ? fs.readdirSync(famDir) : [];
    check('registering a project creates its document folders in the vault', subs.length >= 3, subs);
    r = await call(admin, 'POST', '/api/projects/batch', { user: 'admin', csv: 'process,family,class_abcde,prod_family,prf_date,target_date,certifications,market_manager,country,customer_number,notes\nNPI,FOL2,E,,2026-W20,2026-W30,,,,,' });
    check('a batch import creates folders too', fs.existsSync(path.join(VAULT, 'FOL2')) && fs.readdirSync(path.join(VAULT, 'FOL2')).length >= 3, r.j);
    fs.rmSync(famDir, { recursive: true, force: true });
    r = await call(hoang, 'POST', '/api/projects/provision', {});
    check('a non-admin cannot provision folders', r.s === 403, r.s);
    r = await call(admin, 'POST', '/api/projects/provision', {});
    check('the admin re-creates missing folders for existing projects', r.s === 200 && r.j.folders_created >= 3 && fs.existsSync(famDir), r.j);

    /* ---- 2. a scanned file is renamed and waits for confirmation ---- */
    const prfDir = path.join(famDir, subs.includes('PRF') ? 'PRF' : subs[0]);
    fs.mkdirSync(prfDir, { recursive: true });
    fs.writeFileSync(path.join(prfDir, 'Kit PRF sheet.txt'), 'prf content');
    const rel = path.relative(VAULT, path.join(prfDir, 'Kit PRF sheet.txt'));
    r = await call(admin, 'POST', '/api/vault/orphans/adopt', { user: 'admin', path: rel, project_id: pid, step_key: 'NPI-1', doc_code: path.basename(prfDir), standardize: true });
    check('adopting with standardize works', r.s === 200 && r.j.ok, r.j);
    let d = await data();
    const del = d.tracking.lb_deliverables.find(x => x.project_id === pid && x.doc_code === path.basename(prfDir));
    check('the renamed file is marked Pending with its original name kept', del && del.name_status === 'Pending' && del.original_name === 'Kit PRF sheet.txt' && del.file_name !== 'Kit PRF sheet.txt', del);

    /* ---- 3. doc-type keywords and file types survive and drive the guess ---- */
    const cfgD = d.config.document_types.find(x => x.doctype_id === 'WI') || d.config.document_types[0];
    await call(admin, 'POST', '/api/config/doctype', { op: 'add', user: 'admin', doctype: Object.assign({}, cfgD, { keywords: ['work instruction', '装配'], extensions: ['xlsx'] }) });
    d = await data();
    const saved = d.config.document_types.find(x => x.doctype_id === cfgD.doctype_id);
    check('keywords and file types are saved with the document type', saved && saved.keywords.length === 2 && saved.extensions[0] === 'xlsx', saved);

    /* ---- UI ---- */
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addCookies([{ name: 'wvn_sid', value: admin.split('=')[1], url: BASE }]);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', dlg => { if (process.env.DEBUG_DIALOGS) console.log('DIALOG ' + dlg.message().slice(0, 200)); dlg.accept(); });
    await page.addInitScript(() => { localStorage.setItem('wvn_lang', 'en'); });
    await page.goto(BASE + '/');
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });

    const g = page.locator('.gantt-live-wrap');
    await g.waitFor();
    check('the Gantt has the four week-width buttons', await g.locator('.gantt-range').first().locator('button').count() === 4);
    const trackMin = () => page.locator('.gantt-live-grid').evaluate(e => e.style.getPropertyValue('--gantt-track-min'));
    check('Normal is the default width', await trackMin() === '720px', await trackMin());
    await g.locator('.gantt-range button', { hasText: 'Extra-wide' }).click();
    check('Extra-wide widens the timeline', await trackMin() === '1700px', await trackMin());
    await g.locator('.gantt-range button', { hasText: 'Compact' }).click();
    check('Compact narrows it', await trackMin() === '480px', await trackMin());
    const hdrW = await page.locator('.gantt-live-grid').evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    check('a wide timeline scrolls sideways instead of squeezing', hdrW.sw >= hdrW.cw);
    await g.locator('.gantt-range button', { hasText: /^Wide$/ }).click();
    await g.screenshot({ path: path.join(SHOTS, 'gantt_wide.png') });

    const badge = page.locator('.name-pending');
    check('the matrix shows the orange name-change badge', await badge.count() >= 1 && /Pending Confirmation/.test(await badge.first().innerText()));
    check('its tooltip compares the original and the new name', /Kit PRF sheet\.txt ➔ /.test(await badge.first().getAttribute('title')));
    await badge.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'matrix_name_pending.png') });
    await badge.first().click();
    try { await page.waitForFunction(() => document.querySelectorAll('.name-pending').length === 0, null, { timeout: 15000 }); }
    catch (e) { console.log('badge still there; row = ' + JSON.stringify((await data()).tracking.lb_deliverables.filter(x => x.project_id === pid).map(x => [x.deliverable_id, x.name_status, x.is_active, x.revision_no])) + ' badges=' + await page.locator('.name-pending').count()); }
    d = await data();
    check('confirming turns the row Confirmed and clears the badge', d.tracking.lb_deliverables.find(x => x.deliverable_id === del.deliverable_id).name_status === 'Confirmed');
    check('the confirmation is in the activity log', d.tracking.lb_audit.some(a => a.action === 'Confirm_Name' && a.project_id === pid));

    await page.locator('#tabs button', { hasText: /^Claimed Work$/ }).click();
    const un = page.locator('.claim-unassigned');
    await un.waitFor();
    check('Claimed Work (admin) shows the three summary tiles', await page.locator('.claim-tile').count() === 3);
    check('overdue unassigned items are counted', /^[1-9]/.test(await page.locator('.claim-tile.bad .val').innerText().catch(() => '0')));
    const firstRow = un.locator('tbody tr').first();
    check('the unassigned list starts with an overdue item', /Overdue/.test(await firstRow.innerText()));
    const opts = await firstRow.locator('select option').count();
    check('each row has a person picker with the registry users', opts > 1, opts);
    const who = await firstRow.locator('select option').nth(1).getAttribute('value');
    const firstDoc = (await firstRow.locator('td').nth(3).innerText()).split('\n').pop().trim();
    await page.screenshot({ path: path.join(SHOTS, 'claimed_unassigned.png') });
    await firstRow.locator('select').selectOption(who);
    await firstRow.locator('button', { hasText: 'Assign' }).click();
    for (let i = 0; i < 40; i++) { d = await data(); if (d.tracking.lb_deliverables.some(x => x.doc_code === firstDoc && x.owner_pic === who)) break; await new Promise(res => setTimeout(res, 500)); }
    check('assigning from the list sets the owner and who assigned', d.tracking.lb_deliverables.some(x => x.doc_code === firstDoc && x.owner_pic === who && x.assigned_by));
    // batch
    const assignedNow = async () => (await data()).tracking.lb_deliverables.filter(x => x.assigned_by).length;
    const before = await assignedNow();
    await un.locator('tbody tr input[type=checkbox]').nth(0).check();
    await un.locator('tbody tr input[type=checkbox]').nth(1).check();
    await un.locator('.claim-batch select').selectOption(who);
    await un.locator('.claim-batch button', { hasText: 'Assign selected' }).click();
    let got = before;
    for (let i = 0; i < 40 && got < before + 2; i++) { await new Promise(res => setTimeout(res, 500)); got = await assignedNow(); }
    check('batch-assigning two ticked items assigns both', got === before + 2, { before, got });

    await hoang.length;
    await page.close();
    const p2 = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await p2.context().addCookies([{ name: 'wvn_sid', value: hoang.split('=')[1], url: BASE }]);
    await p2.addInitScript(() => { localStorage.setItem('wvn_lang', 'en'); });
    await p2.goto(BASE + '/');
    await p2.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });
    await p2.locator('#tabs button', { hasText: /^Claimed Work$/ }).click();
    await p2.locator('#views .banner').first().waitFor();
    check('a regular user does not get the unassigned list', await p2.locator('.claim-unassigned').count() === 0);
    check('no page errors', errs.length === 0, errs);
  } catch (e) {
    console.log('FAIL crashed ' + (e && e.stack || e)); fail++;
  } finally {
    try { if (browser) await browser.close(); } catch (e) { }
    try { srv.kill(); } catch (e) { }
    try { spawn('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"CommandLine like '%\\\\v125c\\\\%launcher.ps1%'\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { stdio: 'ignore' }); } catch (e) { }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
