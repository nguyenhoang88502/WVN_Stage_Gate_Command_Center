// v12.4: the admin deletes / restores a project (soft delete), and the dashboard Gantt's new parts.
//   node tests/v12_4/e2e_delete_gantt.js <copyRoot>
// <copyRoot> = isolated copy (app\system + empty NPI_EPM_Documents_Control). Starts the launcher on
// port 8123 and stops it at the end. Never use on the live app.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { adminCookie, userCookie, waitUp } = require('../lib/session');
const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node e2e_delete_gantt.js <copyRoot>'); process.exit(2); }
const BASE = 'http://localhost:8123';
const SHOTS = path.join(ROOT, 'shots');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + JSON.stringify(d) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'app', 'system', 'launcher.ps1'), '-NoBrowser', '-Port', '8123', '-WriterId', 'PC_A'], { stdio: 'ignore' });
  let browser;
  try {
    await waitUp(BASE);
    const admin = await adminCookie(BASE, ROOT);
    const hoang = await userCookie(BASE, admin, 'Hoang');
    const call = async (ck, m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { Cookie: ck, 'Content-Type': 'application/json; charset=utf-8' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (e) { } return { s: r.status, j }; };

    /* ---- a project with a document, a gate and an issue ---- */
    let r = await call(admin, 'POST', '/api/projects', { process: 'NPI', family: 'DEL1', class_abcde: 'E', prf_date: '2026-W30', target_date: '2026-W52', created_by: 'admin' });
    const pid = r.j.project_id;
    check('setup: project registered', r.s === 200 && pid === 'NPI-DEL1', r.j);
    const up = (await call(admin, 'POST', '/api/upload', { fileName: 'del1.txt', contentBase64: Buffer.from('del1 doc').toString('base64'), docType: 'PRF', family: 'DEL1', partId: '', keepOriginalName: true, projectId: pid })).j;
    await call(admin, 'POST', '/api/action', { store: 'lb_deliverables', row: { project_id: pid, step_key: 'NPI-1', doc_code: 'PRF', file_name: up.fileName, file_path: up.path, sha256: up.sha256, status: 'Filed', kind: 'file', uploaded_by: 'admin', uploaded_utc: new Date().toISOString() } });
    await call(admin, 'POST', '/api/action', { store: 'lb_gates', upsertKeys: ['project_id', 'step_key'], row: { project_id: pid, process: 'NPI', step_key: 'NPI-2', step_num: '2', step_name: 'Basic Design', status: 'NotStarted', target_week: '2026-W40' } });
    await call(admin, 'POST', '/api/action', { store: 'lb_issues', row: { project_id: pid, step_key: 'NPI-1', description: 'del1 issue', status: 'Open', raised_by: 'admin' } });

    /* ---- rights and validation ---- */
    r = await call(hoang, 'GET', '/api/projects/admin'); check('a non-admin cannot list projects for deletion', r.s === 403, r.s);
    r = await call(hoang, 'POST', '/api/projects/delete', { project_id: pid, reason: 'x' }); check('a non-admin cannot delete a project', r.s === 403, r.s);
    r = await call(admin, 'GET', '/api/projects/admin');
    const row0 = (r.j.projects || []).find(p => p.project_id === pid);
    check('the admin list shows the project with its document and issue counts', row0 && row0.documents === 1 && row0.open_issues === 1 && row0.status === 'Active', row0);
    r = await call(admin, 'POST', '/api/projects/delete', { project_id: pid, reason: '' }); check('a reason is required', r.s === 400, r.j);
    r = await call(admin, 'POST', '/api/projects/delete', { project_id: 'NPI-NOPE', reason: 'x' }); check('an unknown project is a 404', r.s === 404, r.s);

    /* ---- delete ---- */
    r = await call(admin, 'POST', '/api/projects/delete', { project_id: pid, reason: 'registered by mistake' }); check('the admin deletes the project', r.s === 200, r.j);
    let d = (await call(admin, 'GET', '/api/data')).j;
    check('it disappears from the data every tab reads', !d.tracking.lb_projects.some(p => p.project_id === pid));
    check('...with its document, gate and issue rows', !d.tracking.lb_deliverables.some(x => x.project_id === pid) && !d.tracking.lb_gates.some(x => x.project_id === pid) && !d.tracking.lb_issues.some(x => x.project_id === pid));
    check('the activity log keeps the deletion and its reason', d.tracking.lb_audit.some(a => a.action === 'Delete_Project' && a.project_id === pid && a.detail === 'registered by mistake' && a.user === 'admin'));
    r = await call(admin, 'GET', '/api/vault/orphans');
    check('its document is not reported as an uncategorized file', !(r.j.orphans || []).some(o => /del1/.test(o.path)), (r.j.orphans || []).map(o => o.path));
    check('the document file itself stays in the vault', fs.existsSync(up.path));
    r = await call(admin, 'GET', '/api/vault/search?q=DEL1'); check('the Vault search no longer finds it', r.s === 200 && r.j.total === 0, r.j && r.j.total);
    r = await call(admin, 'POST', '/api/projects/delete', { project_id: pid, reason: 'again' }); check('deleting twice is refused', r.s === 409, r.s);
    r = await call(admin, 'GET', '/api/projects/admin');
    const row1 = r.j.projects.find(p => p.project_id === pid);
    check('the admin list shows it as deleted, by whom and why', row1 && row1.status === 'Deleted' && row1.deleted_by === 'admin' && row1.deleted_reason === 'registered by mistake' && !!row1.deleted_utc, row1);

    /* ---- restore ---- */
    r = await call(admin, 'POST', '/api/projects/restore', { project_id: pid }); check('the admin restores it', r.s === 200 && r.j.status === 'Active', r.j);
    d = (await call(admin, 'GET', '/api/data')).j;
    check('it is back, with its rows', d.tracking.lb_projects.some(p => p.project_id === pid && p.status === 'Active') && d.tracking.lb_deliverables.some(x => x.project_id === pid) && d.tracking.lb_gates.some(x => x.project_id === pid));
    r = await call(admin, 'POST', '/api/projects/restore', { project_id: pid }); check('restoring a live project is refused', r.s === 409, r.s);

    /* ---- the same through the Settings page, and the Gantt ---- */
    await call(admin, 'POST', '/api/projects', { process: 'NPI', family: 'NODATE', class_abcde: 'A', created_by: 'admin' });
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addCookies([{ name: 'wvn_sid', value: admin.split('=')[1], url: BASE }]);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('wvn_lang', 'en'); });
    await page.goto(BASE + '/');
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });
    const g = page.locator('.gantt-live-wrap');
    await g.waitFor();
    check('the Gantt has a legend and a time-window switch', await g.locator('.gantt-legend span').count() >= 7 && await g.locator('.gantt-range button').count() === 3);
    check('the Gantt draws the dated project with a target diamond', await g.locator('.gantt-live-row:not(.gantt-live-header)', { hasText: pid }).locator('.gantt-milestone').count() === 1);
    check('a project without dates is listed under the chart, not silently missing', await g.locator('.gantt-undated .gantt-chip', { hasText: 'NPI-NODATE' }).count() === 1);
    await g.locator('.gantt-range button', { hasText: '6 months' }).click();
    check('the time-window switch redraws the chart', await page.locator('.gantt-range button.on').innerText() === '6 months');
    await page.locator('.gantt-live-wrap').screenshot({ path: path.join(SHOTS, 'gantt_6m.png') });

    await page.locator('#tabs button', { hasText: /^Settings$/ }).click();
    const card = page.locator('#views .card', { has: page.locator('.card-title', { hasText: /^Projects$/ }) });
    await card.locator('table tbody tr').first().waitFor({ timeout: 15000 });
    const rowOf = id => card.locator('tbody tr', { has: page.locator('td b', { hasText: new RegExp('^' + id + '$') }) });
    check('Settings lists the projects for the admin', await rowOf(pid).count() === 1);
    await rowOf(pid).locator('button', { hasText: 'Delete' }).click();
    const modal = page.locator('.modal-scrim form.modal');
    await modal.waitFor();
    await modal.locator('input[name=reason]').fill('duplicate');
    await modal.locator('input[name=confirm]').fill('wrong');
    await modal.locator('button[type=submit]').click();
    check('the delete dialog insists on the typed project ID', /Type the project ID/.test(await modal.innerText()));
    await modal.locator('input[name=confirm]').fill(pid);
    await page.screenshot({ path: path.join(SHOTS, 'settings_delete_modal.png') });
    await modal.locator('button[type=submit]').click();
    await page.locator('.modal-scrim').waitFor({ state: 'detached' });
    await page.waitForFunction(id => ![...document.querySelectorAll('#views .card tbody td b')].some(b => b.textContent === id), pid, { timeout: 15000 });
    check('after deleting, the project leaves the list', await rowOf(pid).count() === 0);
    await card.locator('#projAdminShowDel').check();
    check('"show deleted" brings it back, marked deleted with a Restore button', /Deleted/.test(await rowOf(pid).innerText()) && await rowOf(pid).locator('button', { hasText: 'Restore' }).count() === 1);
    await card.screenshot({ path: path.join(SHOTS, 'settings_projects_deleted.png') });
    await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
    await page.locator('.gantt-live-wrap').waitFor();
    check('the deleted project is gone from the dashboard Gantt', await page.locator('.gantt-live-wrap', { hasText: pid }).count() === 0);
    check('no page errors', errs.length === 0, errs);
  } catch (e) {
    console.log('FAIL crashed ' + (e && e.stack || e)); fail++;
  } finally {
    if (browser) await browser.close();
    try { await fetch(BASE + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { }
    try { srv.kill(); } catch (e) { }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
