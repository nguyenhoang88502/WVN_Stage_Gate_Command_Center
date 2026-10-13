// v12 end-to-end check, through the real pages, against an ISOLATED copy.
//   node tests/v12/e2e_login_vaults.js <copyRoot>
// <copyRoot> must contain app\system (a copy of system\, with NO auth folder)
// and an empty NPI_EPM_Documents_Control vault. Starts the launcher from the
// copy on port 8092, drives it with Chromium, stops it. Never touches the live
// app. Screenshots of every screen land in <copyRoot>\shots. Exit 1 on any
// failed check.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readPin, waitUp } = require('../lib/session');

const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node e2e_login_vaults.js <copyRoot>'); process.exit(2); }
const BASE = 'http://localhost:8092';
const SHOTS = path.join(ROOT, 'shots');
const ADMIN_PW = 'Admin-e2e-2026', HOANG_PW = 'hoang-e2e-2026';
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const PIN = readPin(ROOT);
  const launcher = path.join(ROOT, 'app', 'system', 'launcher.ps1');
  const srv = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-NoBrowser', '-Port', '8092', '-WriterId', 'PC_A'], { stdio: 'ignore' });
  let browser;
  try {
    await waitUp(BASE);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/401|403|404|429|400/.test(m.text())) errors.push('console: ' + m.text()); });
    page.on('dialog', d => { errors.push('unexpected dialog: ' + d.message()); d.dismiss(); });
    await page.addInitScript(() => { try { if (!localStorage.getItem('wvn_lang')) localStorage.setItem('wvn_lang', 'en'); } catch (e) { } });
    const shot = n => page.screenshot({ path: path.join(SHOTS, n + '.png') });
    const card = title => page.locator('#views .card', { has: page.locator('.card-title', { hasText: title }) });

    /* ---------------- sign in ---------------- */
    await page.goto(BASE + '/');
    await page.waitForURL('**/login.html');
    check('opening the app without a session lands on the login page', await page.locator('form[data-submit="login"] h2').innerText() === 'Sign in');
    await shot('01_login');
    await page.fill('#lgUser', 'admin'); await page.fill('#lgPw', 'definitely-wrong');
    await page.click('form[data-submit="login"] button.primary');
    await page.locator('.err-line').waitFor();
    check('a wrong password shows an error and how many tries are left', /Wrong user name or password/.test(await page.locator('.err-line').innerText()) && /4/.test(await page.locator('.err-line').innerText()), await page.locator('.err-line').innerText());
    await page.click('[data-act="lang"]');
    check('switching language keeps the typed user name', await page.inputValue('#lgUser') === 'admin' && await page.locator('form[data-submit="login"] h2').innerText() === 'Đăng nhập');
    await page.click('[data-act="lang"]');
    await page.fill('#lgPw', PIN);
    await page.click('form[data-submit="login"] button.primary');
    await page.locator('form[data-submit="setpw"]').waitFor();
    check('the first admin sign-in (old PIN) asks for a new password', true);
    await page.fill('#np1', ADMIN_PW); await page.fill('#np2', ADMIN_PW + 'x');
    await page.click('form[data-submit="setpw"] button.primary');
    check('two different passwords are refused', /different/.test(await page.locator('.err-line').innerText()));
    await page.fill('#np1', ADMIN_PW); await page.fill('#np2', ADMIN_PW);
    await page.click('form[data-submit="setpw"] button.primary');
    await page.locator('form[data-submit="enter"]').waitFor();
    const opts = page.locator('.vault-opt[data-act="pick"]');
    check('the vault chooser offers the common vault, preselected as default', await opts.count() === 1 && await opts.first().getAttribute('aria-pressed') === 'true' && /NPI_EPM_Documents_Control/.test(await opts.first().innerText()) && /Default/.test(await opts.first().innerText()), await opts.first().innerText());
    await shot('02_choose_vault');
    await page.click('form[data-submit="enter"] button.primary');
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });

    /* ---------------- common vault as admin ---------------- */
    check('the header shows the signed-in user, and the name picker is gone', /admin/.test(await page.locator('#userChip').innerText()) && await page.locator('#whoSelect').count() === 0);
    check('the side bar names the common vault', (await page.locator('#vaultSwitchName').innerText()) === 'NPI_EPM_Documents_Control');
    await page.locator('#tabs button', { hasText: /^Settings$/ }).click();
    const users = card('Users and passwords');
    await users.locator('table tbody tr').first().waitFor();
    const rowOf = name => users.locator('tbody tr', { has: page.locator('td b', { hasText: new RegExp('^' + name + '$') }) });
    check('Settings lists every user with a password status', await users.locator('tbody tr').count() >= 3 && /Set/.test(await rowOf('admin').innerText()) && /No password yet/.test(await rowOf('Hoang').innerText()));
    check('the stored value shown is a hash, not a password', /^pbkdf2-sha256\$100000\$/.test(await rowOf('admin').locator('code').innerText()));
    check('the old Admin Security PIN card is gone', await card('Admin Security PIN').count() === 0);
    await shot('03_settings_users');
    await rowOf('Hoang').locator('button', { hasText: 'Issue password' }).click();
    const tempBox = page.locator('.modal .temp-pw');
    await tempBox.waitFor();
    const hoangTemp = (await tempBox.innerText()).trim();
    check('issuing a password shows a temporary one, once', /^Temp-[a-z2-9]{6}$/.test(hoangTemp), hoangTemp.length);
    await shot('04_temp_password');
    await page.locator('.modal button', { hasText: 'Done' }).click();
    await users.locator('tbody tr').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('#views .card')].some(c => /Users and passwords/.test(c.innerText) && /Temporary, must change/.test(c.innerText)));
    check('the user now shows a temporary password that must be changed', /Temporary, must change/.test(await rowOf('Hoang').innerText()));

    // add a user: roster + temporary password in one step
    await users.locator('form.users-add input').first().fill('Trang Le');
    await users.locator('form.users-add input').nth(1).fill('QA');
    await users.locator('form.users-add button').click();
    await tempBox.waitFor();
    check('adding a user issues a temporary password straight away', /Trang Le/.test(await page.locator('.modal h2').innerText()));
    await page.locator('.modal button', { hasText: 'Done' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('#views .card tbody td b')].some(b => b.textContent === 'Trang Le'));
    check('the new user is in the list', await rowOf('Trang Le').count() === 1);

    // folder structure
    const fs1 = card('Common vault folder structure');
    check('the folder structure starts as Model > DocType > PartID', (await fs1.locator('.folder-level input').evaluateAll(els => els.map(e => e.value))).join('|') === '[Model]|[DocType]|[PartID]');
    await fs1.locator('button', { hasText: '+ [ProjectID]' }).click();
    for (let i = 0; i < 3; i++) await fs1.locator('.folder-level').nth(3 - i).locator('button', { hasText: '↑' }).click();
    check('a level can be added and moved to the top', (await fs1.locator('.folder-level input').evaluateAll(els => els.map(e => e.value))).join('|') === '[ProjectID]|[Model]|[DocType]|[PartID]');
    check('the preview follows', /NPI-9649LP[\s\S]*9649LP[\s\S]*DWG[\s\S]*Blade/.test(await fs1.locator('.folder-tree').innerText()));
    await shot('05_settings_folder_structure');
    await fs1.locator('button', { hasText: 'Save folder structure' }).click();
    await page.waitForFunction(async () => { const d = await (await fetch('/api/data')).json(); return d.folder_levels[0] === '[ProjectID]'; });
    check('the structure is saved', true);

    // optional: admin can view passwords
    await users.locator('.users-view-label input').check();
    await page.locator('.modal input[type="password"]').fill(ADMIN_PW);
    await page.locator('.modal button[type="submit"]').click();
    await page.waitForFunction(() => /^ON\./.test((document.querySelector('.users-view-toggle .note') || {}).textContent || ''));
    check('"let the admin view passwords" can be switched on with the admin password', true);
    check('a user who has not signed in since has no viewable copy yet', /after next sign-in/.test(await rowOf('Hoang').innerText()));

    check('the admin sees an "All vaults" card', await card('All vaults').locator('tbody tr').count() === 1);
    await page.locator('#userChip').click();
    await shot('06_user_menu');
    await page.locator('#userMenu button', { hasText: 'Sign out' }).click();
    await page.waitForURL('**/login.html');
    check('sign out returns to the login page', await page.locator('form[data-submit="login"]').count() === 1);
    const blocked = await page.request.get(BASE + '/api/data');
    check('after sign-out the API refuses the browser', blocked.status() === 401, blocked.status());

    /* ---------------- a user's first sign-in + a personal vault ---------------- */
    await page.fill('#lgUser', 'Hoang'); await page.fill('#lgPw', hoangTemp);
    await page.click('form[data-submit="login"] button.primary');
    await page.locator('form[data-submit="setpw"]').waitFor();
    await page.fill('#np1', HOANG_PW); await page.fill('#np2', HOANG_PW);
    await page.click('form[data-submit="setpw"] button.primary');
    await page.locator('form[data-submit="enter"]').waitFor();
    await page.click('[data-act="newVault"]');
    await page.fill('#nvName', 'Kaizen và 5S');
    check('the wizard shows where the vault will be stored', /Personal_Vaults\\Hoang\\Kaizen và 5S$/.test(await page.inputValue('#nvPath')), await page.inputValue('#nvPath'));
    await page.locator('input[name="tpl"][value="kaizen"]').check();
    check('choosing a template keeps the typed name', await page.inputValue('#nvName') === 'Kaizen và 5S');
    await shot('07_new_vault');
    await page.click('form[data-submit="createVault"] button.primary');
    await page.waitForURL('**/vault.html?id=*');
    await page.locator('.subtabs').waitFor();
    check('a new vault opens on its setup with a hint', /Vault created/.test(await page.locator('.banner.good').innerText()) && (await page.locator('.vault-switch b').innerText()) === 'Kaizen và 5S');
    check('the vault folder exists beside the common vault', fs.existsSync(path.join(ROOT, 'Personal_Vaults', 'Hoang', 'Kaizen và 5S', '_vault', 'vault.json')));
    await shot('08_vault_setup_fields');

    // setup: edit a field, add one, save
    const firstLabel = page.locator('input[data-path="fields.0.label"]');
    await firstLabel.fill('Improvement title');
    await page.locator('[data-act="addField"]').click();
    check('editing the setup shows an unsaved-changes bar, and the click right after typing is not lost', await page.locator('.dirty-bar:not(.hide)').count() === 1 && await page.locator('input[data-path^="fields."][data-path$=".label"]').count() === 6);
    await page.locator('input[data-path="fields.5.label"]').fill('Line leader');
    await page.locator('[data-act="saveSetup"]').click();
    await page.locator('.banner.good', { hasText: 'Setup saved' }).waitFor();
    check('the setup is saved', await page.locator('.dirty-bar.hide').count() === 1);
    await page.locator('[data-act="setupTab"][data-t="process"]').click();
    await shot('09_vault_setup_process');
    await page.locator('[data-act="setupTab"][data-t="folder"]').click();
    check('the folder preview is built from this vault\'s own fields', /Assembly line 1/.test(await page.locator('#folderPreview').innerText()));
    check('renaming a field renamed its token in the folder levels', (await page.locator('input[data-path="folder.1"]').inputValue()) === '[Project ID] [Improvement title]', await page.locator('input[data-path="folder.1"]').inputValue());
    await shot('10_vault_setup_folder');

    // Excel template: download, then import the same file back
    await page.locator('[data-act="setupTab"][data-t="excel"]').click();
    const dl = page.waitForEvent('download');
    await page.locator('[data-act="xlsxOut"]').click();
    const download = await dl;
    const xlsx = path.join(ROOT, 'template_out.xlsx');
    await download.saveAs(xlsx);
    const head = fs.readFileSync(xlsx).subarray(0, 4).toString('latin1');
    check('the template downloads as a real .xlsx', head === 'PK\u0003\u0004' && /^Vault_template_.*\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());
    await shot('11_vault_setup_excel');
    await page.locator('input[data-chg="xlsxIn"]').setInputFiles(xlsx);
    await page.locator('.modal h2', { hasText: 'Import this template?' }).waitFor();
    const impText = await page.locator('.modal').innerText();
    check('importing shows a summary before anything changes', /Project fields\s*6/.test(impText.replace(/\n/g, ' ')) && /No problems found/.test(impText), impText.slice(0, 200));
    await shot('12_vault_import_preview');
    await page.locator('[data-act="applyImport"]').click();
    await page.locator('.banner.good', { hasText: 'replaced from the Excel template' }).waitFor();
    check('the imported setup is applied', await page.locator('input[data-path="fields.0.label"]').inputValue() === 'Improvement title');

    // register a project
    await page.locator('[data-act="nav"][data-v="projects"]').click();
    await page.locator('[data-act="regOpen"]').click();
    await page.locator('form[data-submit="regSave"] button.primary').click();
    check('required fields are enforced on the register form', /Improvement title/.test(await page.locator('form[data-submit="regSave"] .err-line').innerText()));
    const fld = label => page.locator('form[data-submit="regSave"] label.fld', { has: page.locator('span', { hasText: new RegExp('^' + label) }) });
    await fld('Improvement title').locator('input').fill('Giảm thời gian đổi dao');
    await fld('Area').locator('select').selectOption('Assembly line 1');
    await fld('Line leader').locator('input').fill('Hoang');
    await fld('Start date').locator('input').fill('2026-10-01');
    const dues = await page.locator('form[data-submit="regSave"] input[data-chg="draftDue"]').evaluateAll(els => els.map(e => e.value));
    check('deadlines are counted from the start date', dues.join(',') === '2026-10-08,2026-10-22,2026-10-29,2026-11-03', dues);
    check('typed values survive the redraw the start date caused', await fld('Improvement title').locator('input').inputValue() === 'Giảm thời gian đổi dao');
    await shot('13_vault_register');
    await page.locator('form[data-submit="regSave"] button.primary').click();
    await page.locator('tr.detail').waitFor();
    check('the project is registered as P-001 and opens', /P-001/.test(await page.locator('tr[data-act="expand"]').first().innerText()) && /P-001 registered/.test(await page.locator('.banner.good').innerText()));
    await page.locator('tr.detail select[data-chg="stepStatus"]').first().selectOption('done');
    await page.waitForFunction(() => /1\/4/.test(document.querySelector('tr[data-act="expand"]').innerText));
    check('marking a step done updates the progress', true);
    const up = path.join(ROOT, 'A3 báo cáo.txt');
    fs.writeFileSync(up, 'A3 content ' + Date.now());
    await page.locator('tr.detail input[data-chg="upload"]').first().setInputFiles(up);
    await page.locator('tr.detail .filelist a').first().waitFor();
    const filed = path.join(ROOT, 'Personal_Vaults', 'Hoang', 'Kaizen và 5S', 'Assembly line 1', 'P-001 Giảm thời gian đổi dao', 'Plan', 'A3', 'A3 báo cáo.txt');
    check('a document is filed into the vault\'s own folder structure', fs.existsSync(filed), filed);
    const href = await page.locator('tr.detail .filelist a').first().getAttribute('href');
    const got = await page.request.get(BASE + href);
    check('the filed document opens from its link', got.status() === 200 && /A3 content/.test(await got.text()), got.status());
    await shot('14_vault_project_detail');
    await page.locator('[data-act="nav"][data-v="timeline"]').click();
    check('the timeline draws one bar per step', await page.locator('.tl-row:not(.tl-axis) .tl-bar').count() === 4 && await page.locator('.tl-bar.s-done').count() === 1);
    await shot('15_vault_timeline');
    await page.click('[data-act="lang"]');
    check('the vault page switches language', (await page.locator('.page-header h1').innerText()) === 'Bước và hạn');
    await shot('16_vault_timeline_vi');
    await page.click('[data-act="lang"]');

    /* ---------------- back to the common vault as a normal user ---------------- */
    await page.locator('.vault-switch').click();
    await page.waitForURL('**/login.html');
    await page.locator('form[data-submit="enter"]').waitFor();
    check('"Switch vault" shows both vaults, the common one still preselected', await opts.count() === 2 && await opts.first().getAttribute('aria-pressed') === 'true' && /Kaizen và 5S/.test(await opts.nth(1).innerText()));
    await shot('17_choose_vault_two');
    await page.click('form[data-submit="enter"] button.primary');
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });
    await page.locator('#tabs button', { hasText: /^Settings$/ }).click();
    check('a normal user gets no password table and cannot edit the folder structure',
      await card('Users and passwords').locator('table').count() === 0 && await card('All vaults').count() === 0 &&
      await card('Common vault folder structure').locator('.folder-level input:not([disabled])').count() === 0 &&
      (await card('Common vault folder structure').locator('.folder-level input').first().inputValue()) === '[ProjectID]');
    // change own password from the header menu
    await page.locator('#userChip').click();
    await page.locator('#userMenu button', { hasText: 'Change my password' }).click();
    await page.locator('.modal input[name="cur"]').fill(HOANG_PW);
    await page.locator('.modal input[name="new1"]').fill(HOANG_PW + '-b');
    await page.locator('.modal input[name="new2"]').fill(HOANG_PW + '-b');
    await page.locator('.modal button[type="submit"]').click();
    await page.locator('.modal-scrim').waitFor({ state: 'detached' });
    check('a user changes their own password from the header menu', true);
    await page.locator('#userChip').click();
    await page.locator('#userMenu button', { hasText: 'Sign out' }).click();
    await page.waitForURL('**/login.html');

    /* ---------------- admin again: view a password, see every vault ---------------- */
    check('the login page remembers the last user name', await page.inputValue('#lgUser') === 'Hoang');
    await page.fill('#lgUser', 'admin'); await page.fill('#lgPw', ADMIN_PW);
    await page.click('form[data-submit="login"] button.primary');
    await page.locator('form[data-submit="enter"]').waitFor();
    check('the admin sees other people\'s vaults, marked as admin access', await opts.count() === 2 && /admin access/.test(await opts.nth(1).innerText()));
    await page.click('form[data-submit="enter"] button.primary');
    await page.locator('#srvState').filter({ hasText: 'connected' }).waitFor({ timeout: 20000 });
    await page.locator('#tabs button', { hasText: /^Settings$/ }).click();
    await users.locator('table tbody tr').first().waitFor();
    await rowOf('Hoang').locator('button', { hasText: 'View' }).click();
    await page.locator('.modal input[type="password"]').fill(ADMIN_PW);
    await page.locator('.modal button[type="submit"]').click();
    await page.locator('.modal .temp-pw').waitFor();
    check('with "view" on, the admin can read a password after re-entering the admin password', (await page.locator('.modal .temp-pw').innerText()).trim() === HOANG_PW + '-b');
    await page.locator('.modal button', { hasText: 'Done' }).click();
    const av = card('All vaults');
    await av.locator('tbody tr').nth(1).waitFor();
    check('"All vaults" lists the personal vault with its owner', /Kaizen và 5S/.test(await av.locator('tbody tr').nth(1).innerText()) && /Hoang/.test(await av.locator('tbody tr').nth(1).innerText()));
    await shot('18_settings_admin_all');
    await av.locator('tbody tr').nth(1).locator('a', { hasText: 'Open' }).click();
    await page.waitForURL('**/vault.html?id=*');
    await page.locator('tr[data-act="expand"]').first().waitFor();
    check('the admin can open a user\'s personal vault', /P-001/.test(await page.locator('tr[data-act="expand"]').first().innerText()));

    check('no page errors', errors.length === 0, errors.slice(0, 5));
  } catch (e) {
    fail++; console.log('FAIL (exception) ' + (e && e.stack || e));
    try { const pg = browser && browser.contexts()[0] && browser.contexts()[0].pages()[0]; if (pg) await pg.screenshot({ path: path.join(SHOTS, 'zz_failure.png') }); } catch (e2) { }
  } finally {
    if (browser) await browser.close();
    try { await fetch(BASE + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { }
    setTimeout(() => { try { srv.kill(); } catch (e) { } }, 1500);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  setTimeout(() => process.exit(fail ? 1 : 0), 2000);
})();
