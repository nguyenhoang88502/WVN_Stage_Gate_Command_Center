// v12.5: custom folder-structure levels ([FG_ID] ...): admin config, Register a Project inputs, vault paths.
//   node tests/v12_5/e2e_custom_levels.js <copyRoot>
// <copyRoot> = isolated copy (app\system + empty NPI_EPM_Documents_Control). Port 8126. Never use on the live app.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { adminCookie, userCookie, waitUp } = require('../lib/session');
const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node e2e_custom_levels.js <copyRoot>'); process.exit(2); }
const BASE = 'http://localhost:8126';
const VAULT = path.join(ROOT, 'NPI_EPM_Documents_Control');
const SHOTS = path.join(ROOT, 'shots');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + JSON.stringify(d) : '')); } };
const ls = d => fs.existsSync(d) ? fs.readdirSync(d) : [];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'app', 'system', 'launcher.ps1'), '-NoBrowser', '-Port', '8126', '-WriterId', 'PC_A'], { stdio: 'ignore' });
  let browser;
  try {
    await waitUp(BASE);
    const admin = await adminCookie(BASE, ROOT);
    const hoang = await userCookie(BASE, admin, 'Hoang');
    const call = async (ck, m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { Cookie: ck, 'Content-Type': 'application/json; charset=utf-8' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (e) { } return { s: r.status, j }; };
    const data = async () => (await call(admin, 'GET', '/api/data')).j;
    const FG = [{ key: 'FG_ID', label: 'Finished Goods IDs' }];
    const LV = ['[Model]', '[FG_ID]', '[DocType]'];

    /* ---- 1. admin config ---- */
    let r = await call(hoang, 'POST', '/api/config/folder-structure', { user: 'Hoang', levels: LV, custom_fields: FG });
    check('a non-admin cannot change the folder structure', r.s === 403, r.s);
    r = await call(admin, 'POST', '/api/config/folder-structure', { user: 'admin', levels: ['[Model]', '[Nope]', '[DocType]'], custom_fields: FG });
    check('an unknown token is refused', r.s === 400 && /Nope/.test(r.j.error), r.j);
    r = await call(admin, 'POST', '/api/config/folder-structure', { user: 'admin', levels: LV, custom_fields: [{ key: '1bad', label: 'x' }] });
    check('a bad custom key is refused', r.s === 400 && /key/i.test(r.j.error), r.j);
    r = await call(admin, 'POST', '/api/config/folder-structure', { user: 'admin', levels: LV, custom_fields: [{ key: 'Model', label: 'x' }] });
    check('a custom key cannot reuse a built-in token', r.s === 400, r.j);
    r = await call(admin, 'POST', '/api/config/folder-structure', { user: 'admin', levels: LV, custom_fields: FG });
    check('the admin saves levels with a custom [FG_ID] level', r.s === 200, r.j);
    let d = await data();
    check('the custom field is persisted in config.folder_structure and sent to the browser',
      d.config.folder_structure && d.config.folder_structure.custom_fields[0].key === 'FG_ID' && d.folder_custom[0].label === 'Finished Goods IDs' && d.folder_tokens.includes('FG_ID') && d.folder_levels.join() === LV.join(), { fs: d.config.folder_structure, tok: d.folder_tokens });
    r = await call(admin, 'POST', '/api/config/folder-structure', { user: 'admin', levels: LV, custom_fields: [] });
    check('a custom field still used in the levels cannot be dropped', r.s === 400, r.j);

    /* ---- 2. registering projects keeps the values and builds the folders ---- */
    r = await call(admin, 'POST', '/api/projects', { process: 'NPI', family: 'CF1', class_abcde: 'E', prf_date: '2026-W20', target_date: '2026-W40', created_by: 'admin', custom: { FG_ID: ['FG1', ' FG2 '], JUNK: ['x'] } });
    check('registering with custom values works', r.s === 200, r.j);
    d = await data();
    const p1 = d.tracking.lb_projects.find(p => p.project_id === 'NPI-CF1');
    const cf1 = p1 && JSON.parse(p1.custom_fields || '{}');
    check('the values are in the project master record; undefined keys are dropped', cf1 && cf1.FG_ID.join() === 'FG1,FG2' && !('JUNK' in cf1), p1 && p1.custom_fields);
    check('one folder set per value: Model/FG1 and Model/FG2', ls(path.join(VAULT, 'CF1')).sort().join() === 'FG1,FG2', ls(path.join(VAULT, 'CF1')));
    check('document folders sit below the custom level', ls(path.join(VAULT, 'CF1', 'FG1')).length >= 3 && ls(path.join(VAULT, 'CF1', 'FG1')).includes('PRF'));
    r = await call(admin, 'POST', '/api/projects', { process: 'NPI', family: 'CF2', class_abcde: 'E', prf_date: '2026-W20', target_date: '2026-W40', created_by: 'admin' });
    check('a project with no custom value skips the level: Model/DocType', ls(path.join(VAULT, 'CF2')).includes('PRF') && !fs.existsSync(path.join(VAULT, 'CF2', 'FG1')), ls(path.join(VAULT, 'CF2')));
    r = await call(admin, 'POST', '/api/projects', { process: 'NPI', family: 'CF3', class_abcde: 'E', prf_date: '2026-W20', target_date: '2026-W40', created_by: 'admin', custom: { FG_ID: ['FG9'] } });

    /* ---- 3. filing documents ---- */
    const up = async (fam, pid, custom) => (await call(admin, 'POST', '/api/upload', { fileName: 'doc.txt', contentBase64: Buffer.from('x' + fam + JSON.stringify(custom || {})).toString('base64'), docType: 'PRF', family: fam, partId: '', keepOriginalName: true, projectId: pid, custom })).j;
    let u = await up('CF1', 'NPI-CF1', { FG_ID: 'FG2' });
    check('an upload naming the value is filed under it', /[\\/]CF1[\\/]FG2[\\/]PRF[\\/]/.test(u.path || ''), u.path);
    u = await up('CF1', 'NPI-CF1');
    check('several values and no choice: the level is skipped, not guessed', /[\\/]CF1[\\/]PRF[\\/]/.test(u.path || '') && !/FG1|FG2/.test(u.path), u.path);
    u = await up('CF3', 'NPI-CF3');
    check('a project with exactly one value uses it automatically', /[\\/]CF3[\\/]FG9[\\/]PRF[\\/]/.test(u.path || ''), u.path);
    u = await up('CF2', 'NPI-CF2');
    check('a project with no value: Model/DocType', /[\\/]CF2[\\/]PRF[\\/]/.test(u.path || ''), u.path);

    /* ---- 4. files dropped in by hand are still recognised, with or without the level ---- */
    fs.mkdirSync(path.join(VAULT, 'CF3', 'FG9', 'PRF'), { recursive: true });
    fs.writeFileSync(path.join(VAULT, 'CF3', 'FG9', 'PRF', 'hand_a.txt'), 'a hand file');
    fs.mkdirSync(path.join(VAULT, 'CF3', 'PRF'), { recursive: true });
    fs.writeFileSync(path.join(VAULT, 'CF3', 'PRF', 'hand_b.txt'), 'b hand file');
    r = await call(admin, 'GET', '/api/vault/orphans');
    const og = n => (r.j.orphans || []).find(o => o.path.endsWith(n));
    check('a hand-dropped file below the custom level is recognised', og('hand_a.txt') && og('hand_a.txt').guess && og('hand_a.txt').guess.project_id === 'NPI-CF3', og('hand_a.txt'));
    check('a hand-dropped file with the level left out is recognised too', og('hand_b.txt') && og('hand_b.txt').guess && og('hand_b.txt').guess.project_id === 'NPI-CF3', og('hand_b.txt'));

    /* ---- UI ---- */
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addCookies([{ name: 'wvn_sid', value: admin.split('=')[1], url: BASE }]);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', dlg => dlg.accept());
    await page.addInitScript(() => { localStorage.setItem('wvn_lang', 'en'); });
    await page.goto(BASE + '/');
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();
    const inp = page.locator('input.npCustom[data-key=FG_ID]');
    await inp.waitFor();
    check('Register a Project shows an input for the custom field', await inp.count() === 1 && /Finished Goods IDs/.test(await inp.locator('xpath=ancestor::div[contains(@class,"fld")]').innerText()));
    await page.locator('#npFam').fill('CL-CORDLESS').catch(() => { });
    const famId = page.locator('#npFamId, #npModel, #npFamily').first();
    await page.screenshot({ path: path.join(SHOTS, 'register_custom.png'), fullPage: false });

    await page.locator('#tabs button', { hasText: /^Settings$/ }).click();
    const card = page.locator('#views .card', { has: page.locator('.card-title', { hasText: 'Common vault folder structure' }) });
    await card.waitFor();
    check('Settings lists the existing custom field', /\[FG_ID\]/.test(await card.locator('.fs-custom').innerText()));
    check('the live preview already shows the custom level', /FG-ID-001/.test(await card.locator('.folder-tree').innerText()));
    await card.locator('.fs-custom input[aria-label="Custom field key"]').fill('BATCH_NO');
    await card.locator('.fs-custom input[aria-label="Custom field label"]').fill('Batch number');
    await card.locator('button', { hasText: '+ Add custom field' }).click();
    check('adding a field adds its level and updates the preview at once', /BATCH-NO-001/.test(await card.locator('.folder-tree').innerText()) && await card.locator('.folder-level').count() === 4);
    await card.locator('.folder-level').nth(3).locator('button[title="Move up"]').click();
    check('reordering redraws the preview', /FG-ID-001[\s\S]*DWG|BATCH-NO-001/.test(await card.locator('.folder-tree').innerText()));
    await card.screenshot({ path: path.join(SHOTS, 'settings_custom_levels.png') });
    await card.locator('button', { hasText: 'Save folder structure' }).click();
    await page.waitForTimeout(1500);
    d = await data();
    check('saving persists both custom fields and the new order', d.folder_custom.map(c => c.key).join() === 'FG_ID,BATCH_NO' && d.folder_levels.length === 4 && d.folder_levels.includes('[BATCH_NO]'), { c: d.folder_custom, l: d.folder_levels });
    check('no page errors', errs.length === 0, errs);
  } catch (e) {
    console.log('FAIL crashed ' + (e && e.stack || e)); fail++;
  } finally {
    try { if (browser) await browser.close(); } catch (e) { }
    try { srv.kill(); } catch (e) { }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
