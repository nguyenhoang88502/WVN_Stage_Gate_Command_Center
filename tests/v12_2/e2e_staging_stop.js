// v12.2 end-to-end check through the real pages, against an ISOLATED copy:
//   - Input tab, "Uncategorized files": choices are staged (nothing is posted,
//     the list does not reload) and saved by "Save changes" or by leaving the tab
//   - Settings: the "Project data in the vault" card
//   - the Stop server button
//   node tests/v12_2/e2e_staging_stop.js <copyRoot>
// <copyRoot> = app\system + an empty NPI_EPM_Documents_Control (tests/v12_2/
// run_vault_data.sh shows how mkcopy builds one). Starts the launcher on port
// 8100 and, at the end, stops it THROUGH THE UI. Never use on the live app.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { adminCookie, waitUp } = require('../lib/session');

const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node e2e_staging_stop.js <copyRoot>'); process.exit(2); }
const BASE = 'http://localhost:8100';
const VAULT = path.join(ROOT, 'NPI_EPM_Documents_Control');
const SHOTS = path.join(ROOT, 'shots');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d !== undefined ? '  ' + JSON.stringify(d) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const launcher = path.join(ROOT, 'app', 'system', 'launcher.ps1');
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-NoBrowser', '-Port', '8100', '-WriterId', 'PC_A'], { stdio: 'ignore' });
  let browser;
  try {
    await waitUp(BASE);
    const cookie = await adminCookie(BASE, ROOT);
    const api = async (method, p, body) => {
      const r = await fetch(BASE + p, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json; charset=utf-8' }, body: body ? JSON.stringify(body) : undefined });
      return r.json();
    };
    const proj = await api('POST', '/api/projects', { process: 'NPI', family: 'ST1', class_abcde: 'E', prf_date: '2026-01-05', created_by: 'admin' });
    const pid = proj.project_id;
    check('setup: project registered', !!pid, proj);
    // stray files: one that sits where the app would have put it, three loose ones
    const mk = (rel, txt) => { const f = path.join(VAULT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };
    mk('ST1/DWG/guessed.txt', 'guessed one');
    mk('Loose/b1.txt', 'loose 1'); mk('Loose/b2.txt', 'loose 2'); mk('Loose/b3.txt', 'loose 3');

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'wvn_sid', value: cookie.split('=')[1], url: BASE }]);
    const page = await context.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/401|403|404|409|429|400|ERR_CONNECTION|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    let promptAnswer = 'test reason';
    page.on('dialog', d => { dialogs.push(d.type()); if (d.type() === 'prompt') d.accept(promptAnswer); else d.accept(); });
    await page.addInitScript(() => { try { if (!localStorage.getItem('wvn_lang')) localStorage.setItem('wvn_lang', 'en'); } catch (e) { } });
    const reqs = [];
    page.on('request', r => { const u = new URL(r.url()); reqs.push(r.method() + ' ' + u.pathname); });
    const count = pat => reqs.filter(x => pat.test(x)).length;
    const shot = n => page.screenshot({ path: path.join(SHOTS, n + '.png') });

    await page.goto(BASE + '/');
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });
    check('the header has a Stop server button', await page.locator('#stopBtn').count() === 1 && /Stop the server/i.test(await page.locator('#stopBtn').getAttribute('title')));

    /* ---------------- Settings: project data card ---------------- */
    await page.locator('#tabs button', { hasText: /^Settings$/ }).click();
    const dataCard = page.locator('#views .card', { has: page.locator('.card-title', { hasText: 'Project data in the vault' }) });
    await dataCard.locator('b', { hasText: 'Project_Information.xlsx' }).waitFor({ timeout: 15000 });
    check('Settings shows the project-data card with the Excel file', await dataCard.locator('button', { hasText: 'Open in Excel' }).count() === 1 && await dataCard.locator('button', { hasText: 'Update now' }).count() === 1);
    check('the card lists the row counts and this PC as a writer', /Projects: \d+/.test(await dataCard.innerText()) && /PC_A/.test(await dataCard.innerText()), (await dataCard.innerText()).slice(0, 300));
    await dataCard.locator('button', { hasText: 'Update now' }).click();
    await page.waitForFunction(() => { const c = [...document.querySelectorAll('#views .card')].find(x => /Project data in the vault/.test(x.innerText)); return c && /updated/.test(c.innerText); }, null, { timeout: 15000 });
    check('"Update now" writes the workbook', fs.existsSync(path.join(VAULT, 'Project_Information.xlsx')));
    await shot('10_settings_vault_data');

    /* ---------------- Input: staged categorization ---------------- */
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();
    const orph = page.locator('#views .card', { has: page.locator('.card-title', { hasText: 'Uncategorized files in the vault' }) });
    await orph.locator('tbody tr').first().waitFor({ timeout: 20000 });
    const rows = orph.locator('tbody tr');
    check('the stray files are listed', await rows.count() === 4, await rows.count());
    const rowOf = name => orph.locator('tbody tr', { hasText: name });
    check('the file sitting in the right folder is recognised and offered as Confirm', await rowOf('guessed.txt').locator('button', { hasText: 'Confirm' }).count() === 1);
    await shot('11_orphans_before');
    const orphGets = count(/^GET \/api\/vault\/orphans$/), dataGets = count(/^GET \/api\/data$/);

    await rowOf('guessed.txt').locator('button', { hasText: 'Confirm' }).click();
    check('Confirm only stages: nothing is posted', count(/^POST \/api\/vault\/orphans\/adopt$/) === 0);
    check('...and the list is not reloaded', count(/^GET \/api\/vault\/orphans$/) === orphGets && count(/^GET \/api\/data$/) === dataGets, [count(/^GET \/api\/vault\/orphans$/), orphGets]);
    check('...the row stays, marked as pending', await rows.count() === 4 && /will be filed as/.test(await rowOf('guessed.txt').innerText()) && await rowOf('guessed.txt').locator('button', { hasText: 'Undo' }).count() === 1);
    const bar = orph.locator('.stage-bar');
    check('a bar counts the unsaved changes', await bar.isVisible() && /1 change not saved yet/.test(await bar.innerText()), await bar.innerText());

    await rowOf('b1.txt').locator('button', { hasText: 'Not a deliverable' }).click();
    check('"Not a deliverable" stages too (reason asked, nothing posted)', dialogs.includes('prompt') && count(/^POST \/api\/(action|vault\/orphans)/) === 0 && /2 changes not saved yet/.test(await bar.innerText()), [dialogs, await bar.innerText()]);

    await rowOf('b2.txt').locator('button', { hasText: 'Categorize' }).click();
    await page.locator('#ocProj').fill(pid); await page.locator('#ocProj').press('Tab');
    await page.locator('#ocDoc').fill('DWG'); await page.locator('#ocDoc').press('Tab');
    check('the modal still guesses the step', /\S/.test(await page.locator('#ocStep').inputValue()), await page.locator('#ocStep').inputValue());
    await page.locator('#ocGo').click();
    await page.locator('.modal-scrim').waitFor({ state: 'detached' });
    check('"File it" in the modal stages too: still nothing posted, three changes pending', count(/^POST \/api\/(action|vault\/orphans)/) === 0 && /3 changes not saved yet/.test(await bar.innerText()) && /will be filed as/.test(await rowOf('b2.txt').innerText()), await bar.innerText());
    check('...and the list was still not reloaded', count(/^GET \/api\/vault\/orphans$/) === orphGets && count(/^GET \/api\/data$/) === dataGets);
    await shot('12_orphans_staged');

    await rowOf('b1.txt').locator('button', { hasText: 'Undo' }).click();
    check('Undo takes a choice back', /2 changes not saved yet/.test(await bar.innerText()) && await rowOf('b1.txt').locator('button', { hasText: 'Not a deliverable' }).count() === 1);

    // a page refresh keeps the choices (sessionStorage)
    await page.reload();
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();
    await orph.locator('tbody tr').first().waitFor({ timeout: 20000 });
    check('staged choices survive a page refresh', await rowOf('guessed.txt').locator('button', { hasText: 'Undo' }).count() === 1 && /2 changes not saved yet/.test(await orph.locator('.stage-bar').innerText()));

    // Save changes -> the two adopt posts, then ONE reload of the list
    const adoptBefore = count(/^POST \/api\/vault\/orphans\/adopt$/), orphBefore = count(/^GET \/api\/vault\/orphans$/);
    await orph.locator('.stage-bar button', { hasText: 'Save changes' }).click();
    await page.waitForFunction(() => { const c = [...document.querySelectorAll('#views .card')].find(x => /Uncategorized files/.test(x.innerText)); return c && c.querySelectorAll('tbody tr').length === 2; }, null, { timeout: 20000 });
    check('Save changes posts every staged choice', count(/^POST \/api\/vault\/orphans\/adopt$/) === adoptBefore + 2, count(/^POST \/api\/vault\/orphans\/adopt$/) - adoptBefore);
    check('...and reloads the list once', count(/^GET \/api\/vault\/orphans$/) === orphBefore + 1, count(/^GET \/api\/vault\/orphans$/) - orphBefore);
    check('the saved files left the list; the other two remain', await rows.count() === 2 && await orph.locator('.stage-bar').isHidden());
    let data = await api('GET', '/api/data');
    const mine = data.tracking.lb_deliverables.filter(d => d.project_id === pid);
    check('both are now deliverables of the project', mine.length === 2 && mine.every(d => d.kind === 'file'), mine.map(d => d.file_name));
    await shot('13_orphans_saved');

    // leaving the tab saves what is staged
    await rowOf('b1.txt').locator('button', { hasText: 'Not a deliverable' }).click();
    check('one more choice is pending', /1 change not saved yet/.test(await orph.locator('.stage-bar').innerText()));
    const ignoredBefore = (await api('GET', '/api/data')).tracking.lb_vault_ignored.length;
    await page.locator('#tabs button', { hasText: /^Dashboard$/ }).click();
    let ignored = ignoredBefore;
    for (let i = 0; i < 30 && ignored === ignoredBefore; i++) { await sleep(500); ignored = (await api('GET', '/api/data')).tracking.lb_vault_ignored.length; }
    check('switching tab saves the pending choice', ignored === ignoredBefore + 1);
    await page.locator('#tabs button', { hasText: /^Input$/ }).click();
    await orph.locator('tbody tr').first().waitFor({ timeout: 20000 });
    check('...and it is gone from the list when you come back', await rows.count() === 1 && await orph.locator('.stage-bar').isHidden());

    // a pending choice makes the server stop save it first
    await rowOf('b3.txt').locator('button', { hasText: 'Not a deliverable' }).click();

    /* ---------------- Stop server ---------------- */
    await page.locator('#stopBtn').click();
    const dlg = page.locator('.modal-scrim .modal');
    await dlg.waitFor();
    check('the stop button asks first', /Stop the server\?/.test(await dlg.innerText()) && /desktop/.test(await dlg.innerText()), await dlg.innerText());
    await shot('14_stop_confirm');
    await dlg.locator('button', { hasText: 'Cancel' }).click();
    await page.locator('.modal-scrim').waitFor({ state: 'detached' });
    check('Cancel keeps the server running', (await fetch(BASE + '/api/auth/status')).ok);
    await page.locator('#stopBtn').click();
    await dlg.waitFor();
    const ign2 = (await api('GET', '/api/data')).tracking.lb_vault_ignored.length;
    await dlg.locator('button.danger').click();
    await page.locator('.stopped .big').waitFor({ timeout: 20000 });
    check('after confirming the page says the server stopped', /Server stopped/.test(await page.locator('.stopped').innerText()));
    await shot('15_stopped');
    let down = false;
    for (let i = 0; i < 20 && !down; i++) { try { await fetch(BASE + '/api/auth/status', { signal: AbortSignal.timeout(1500) }); await sleep(500); } catch (e) { down = true; } }
    check('the server process really stopped', down);
    // the pending choice was saved on the way out: read it from the vault journal
    const ignCsv = fs.readFileSync(path.join(VAULT, '_vault', 'journal', 'PC_A', 'lb_vault_ignored.csv'), 'utf8');
    check('...and the choice pending at that moment was saved first', /b3\.txt/.test(ignCsv) && ignCsv.split(/\r?\n/).filter(Boolean).length - 1 >= ign2 + 1, ignCsv.split(/\r?\n/).length);
    check('stopping left the Excel copy current', fs.existsSync(path.join(VAULT, 'Project_Information.xlsx')));
    check('no page errors', errors.length === 0, errors);
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
